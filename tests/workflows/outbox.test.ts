/** Real SQL transactions prove acceptance and fencing; a separate sink transaction deduplicates redelivery. */
import { after, before, describe, it } from 'node:test';
import { expect } from '@std/expect';
import postgres from 'postgres';
import * as outbox from '@okikio/storage/outbox/postgres';
import * as delivery from '@okikio/storage/outbox/effect';
import * as effects from '@okikio/capability/effect';
import * as schema from '@okikio/schema';
import * as context from '@okikio/context';

const url = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
if (!url) throw new Error('Outbox checks requires a disposable PostgreSQL database.');
const database = postgres(url, { max: 6, onnotice() {} });
before(async () => {
	await outbox.migrate({ database });
	await database`create table if not exists public.outbox_fixture (namespace text, value text)`;
	// The receipt and consequence have separate tables. Only the receipt has a
	// unique key, so an accidental second business write cannot hide behind upsert.
	await database`create table if not exists public.outbox_inbox (
		namespace text, id text, key text, primary key(namespace,id,key))`;
});
after(async () => {
	await database.end({ timeout: 2 });
});

/** One test owns its SQL rows while borrowing the suite's connection pool. */
interface PartitionType extends AsyncDisposable {
	/** Isolate scenario data without clearing another test's partition. */
	readonly namespace: string;
}

/**
 * Delete only this scenario's business, inbox and outbox rows on scope exit.
 * Lexical disposal finishes before the case returns, including on assertion failure;
 * it does not depend on runtime support for TestContext.after().
 */
function partition(): PartitionType {
	const namespace = crypto.randomUUID();
	return {
		namespace,
		/** Remove dependent data before its admission policy, retaining transaction atomicity. */
		async [Symbol.asyncDispose]() {
			await database.begin(async (tx) => {
				await tx`delete from outbox_fixture where namespace=${namespace}`;
				await tx`delete from outbox_inbox where namespace=${namespace}`;
				await tx`delete from utils_outbox.messages where namespace=${namespace}`;
				await tx`delete from utils_outbox.policies where namespace=${namespace}`;
			});
		},
	};
}

describe('outbox transactional acceptance', () => {
	it('rolls back business state and message acceptance together', async () => {
		await using owned = partition();
		const namespace = owned.namespace;
		const box = outbox.open({ database, namespace, maximum: 2 });
		const message = { id: 'note.saved', key: 'one', value: { note: 'one' } };
		await expect(database.begin(async (tx) => {
			await tx`insert into outbox_fixture values (${namespace},'rolled back')`;
			await box.append(tx, message);
			throw new Error('abort transaction');
		})).rejects.toThrow('abort transaction');
		expect(await box.inspect(message.id, message.key)).toBeUndefined();
		expect(await database`select * from outbox_fixture where namespace=${namespace}`).toHaveLength(0);
	});

	it('commits business state and message acceptance together', async () => {
		await using owned = partition();
		const namespace = owned.namespace;
		const box = outbox.open({ database, namespace, maximum: 2 });
		const message = { id: 'note.saved', key: 'one', value: { note: 'one' } };
		await database.begin(async (tx) => {
			await tx`insert into outbox_fixture values (${namespace},'committed')`;
			await box.append(tx, message);
		});
		expect(await box.inspect(message.id, message.key)).toBe('pending');
		expect(await database`select * from outbox_fixture where namespace=${namespace}`).toHaveLength(1);
	});

	it('deduplicates competing acceptance and rejects changed payloads', async () => {
		await using owned = partition();
		const box = outbox.open({ database, namespace: owned.namespace, maximum: 2 });
		const message = { id: 'note.saved', key: 'one', value: { note: 'one' } };
		await Promise.all(Array.from({ length: 4 }, () => database.begin((tx) => box.append(tx, message))));
		await expect(database.begin((tx) => box.append(tx, { ...message, value: { note: 'different' } })))
			.rejects.toMatchObject({ code: 'conflict' });
		expect(await box.claim({ limit: 2 })).toHaveLength(1);
	});

	it('grants one competing claim and accepts its acknowledgement idempotently', async () => {
		await using owned = partition();
		const box = outbox.open({ database, namespace: owned.namespace, maximum: 2 });
		const message = { id: 'note.saved', key: 'one', value: { note: 'one' } };
		await database.begin((tx) => box.append(tx, message));
		// Competing dispatchers must reserve one distinct token, not both receive the same message.
		const claims = (await Promise.all([box.claim(), box.claim()])).flat();
		expect(claims).toHaveLength(1);
		await box.complete(claims[0]!);
		await box.complete(claims[0]!);
		expect(await box.inspect(message.id, message.key)).toBe('complete');
	});
});

describe('outbox admission and retention', () => {
	it('retains capacity until terminal history is pruned and leaves pending work intact', async () => {
		await using owned = partition();
		const namespace = owned.namespace;
		const box = outbox.open({ database, namespace, maximum: 1, maximumBytes: 64 });
		const append = (key: string) => database.begin((tx) => box.append(tx, { id: 'bounded', key, value: 'value' }));
		await append('one');
		await expect(append('two')).rejects.toMatchObject({ code: 'capacity' });
		expect(await box.prune(Date.now() + 10000)).toBe(0);
		const claim = (await box.claim())[0]!;
		await box.complete(claim);
		await expect(append('two')).rejects.toMatchObject({ code: 'capacity' });
		expect(await box.prune(Date.now() + 10000)).toBe(1);
		await append('two');
	});

	it('rejects policy drift between views of the same namespace', async () => {
		await using owned = partition();
		const namespace = owned.namespace;
		const box = outbox.open({ database, namespace, maximum: 1, maximumBytes: 64 });
		await database.begin((tx) => box.append(tx, { id: 'bounded', key: 'one', value: 'value' }));
		await expect(outbox.open({ database, namespace, maximum: 2 }).claim()).rejects.toMatchObject({ code: 'policy' });
	});

	it('rejects an oversized value before consuming namespace capacity', async () => {
		await using owned = partition();
		const box = outbox.open({ database, namespace: owned.namespace, maximum: 1, maximumBytes: 64 });
		await expect(database.begin((tx) => box.append(tx, { id: 'bounded', key: 'long', value: 'x'.repeat(100) })))
			.rejects.toBeInstanceOf(RangeError);
		expect(await box.inspect('bounded', 'long')).toBeUndefined();
		await database.begin((tx) => box.append(tx, { id: 'bounded', key: 'one', value: 'value' }));
	});
});

describe('outbox JSON payloads', () => {
	for (
		const [name, value] of [
			['null', null],
			['boolean', false],
			['number', 0],
			['string', 'value'],
			['array', [null, 0]],
			['object', { note: 'value' }],
		] as const
	) {
		it(`round-trips a JSON ${name} through SQL and claiming`, async () => {
			await using owned = partition();
			const box = outbox.open({ database, namespace: owned.namespace });
			await database.begin((tx) => box.append(tx, { id: 'json', key: 'one', value }));

			// Inspect the consumer's value, not the driver's encoded SQL parameter.
			const claims = await box.claim();
			expect(claims).toHaveLength(1);
			expect(claims[0]!.value).toEqual(value);
			await box.complete(claims[0]!);
		});
	}
});

describe('outbox delivery ownership', () => {
	it('rejects late acknowledgement, replaces the token, and stops redelivery after the attempt budget', async () => {
		await using owned = partition();
		const box = outbox.open({ database, namespace: owned.namespace, maximumAttempts: 2 });
		await database.begin((tx) => box.append(tx, { id: 'retry', key: 'one', value: null }));
		const first = (await box.claim({ leaseMs: 30 }))[0]!;
		// Authority time, rather than a client clock edit, advances past this real dispatch lease.
		await database`select pg_sleep(0.05)`;
		await expect(box.complete(first)).rejects.toMatchObject({ code: 'stale' });
		const second = (await box.claim())[0]!;
		expect(second.token).not.toBe(first.token);
		expect(second.attempt).toBe(2);
		await expect(box.complete(first)).rejects.toMatchObject({ code: 'stale' });
		await box.retry(second, 0);
		expect(await box.inspect(second.id, second.key)).toBe('failed');
		expect(await box.claim()).toHaveLength(0);
	});

	it('binds effect emission to the transaction and redelivers safely after sink acceptance without acknowledgement', async () => {
		await using ctx = context.create({ id: 'outbox-effect' });
		await using owned = partition();
		const namespace = owned.namespace;
		const box = outbox.open({ database, namespace });
		const Saved = effects.define({ id: 'fixture.saved', value: schema.object({ note: schema.string() }) });
		const occurrence = await effects.create(Saved, { note: 'one' }, { key: 'stable' });
		await database.begin(async (tx) => {
			await delivery.emitter(box, tx).emit(ctx, occurrence);
		});
		const handler = effects.implement(Saved, async (_ctx, value) => {
			// The receiving application owns this transaction. Committing the receipt
			// with the consequence makes a repeated delivery safe after lost acknowledgement.
			await database.begin(async (tx) => {
				const inserted = await tx`insert into outbox_inbox values (${namespace},${Saved.id},${value.key})
				on conflict do nothing returning key`;
				if (inserted.length) await tx`insert into outbox_fixture values (${namespace},${value.value.note})`;
			});
		});
		const lost = (await box.claim({ leaseMs: 30 }))[0]!;
		await handler.accept(ctx, await effects.decode(lost, [Saved]));
		await database`select pg_sleep(0.05)`;
		const result = await delivery.dispatch(ctx, box, [handler]);
		expect(result.accepted).toBe(1);
		expect(await database`select value from outbox_fixture where namespace=${namespace}`).toEqual([{ value: 'one' }]);
		expect(await database`select key from outbox_inbox where namespace=${namespace}`).toEqual([{ key: 'stable' }]);
		expect(await box.inspect(Saved.id, 'stable')).toBe('complete');
		await expect(box.complete(lost)).rejects.toMatchObject({ code: 'stale' });
	});

	it('retains a missing-handler delivery as failed after the explicit attempt budget', async () => {
		await using ctx = context.create({ id: 'outbox-missing-handler' });
		await using owned = partition();
		const box = outbox.open({ database, namespace: owned.namespace, maximumAttempts: 1 });
		await database.begin((tx) => box.append(tx, { id: 'unknown.v1', key: 'one', value: null }));

		// Dispatch reports application of retry policy, not successful redelivery.
		// A missing decoder must never acknowledge a message it cannot interpret.
		expect(await delivery.dispatch(ctx, box, [], { delayMs: 0 })).toEqual({ accepted: 0, retried: 1 });
		expect(await box.inspect('unknown.v1', 'one')).toBe('failed');
		expect(await box.claim()).toHaveLength(0);
	});

	it('does not acknowledge acceptance when cancellation arrives before sink completion', async () => {
		const abort = new AbortController();
		await using ctx = context.create({ id: 'outbox-cancel', signal: abort.signal });
		await using owned = partition();
		const box = outbox.open({ database, namespace: owned.namespace });
		const Saved = effects.define({ id: 'cancel.saved', value: schema.string() });
		await database.begin(async (tx) => {
			await delivery.emitter(box, tx).emit(ctx, await effects.create(Saved, 'one', { key: 'one' }));
		});
		const handler = effects.implement(Saved, () => {
			// The sink may already have committed when cancellation is observed.
			// Leave the reservation leased; no second worker is admitted immediately.
			abort.abort(new Error('stop after acceptance'));
		});
		await expect(delivery.dispatch(ctx, box, [handler])).rejects.toBeInstanceOf(Error);
		expect(await box.inspect(Saved.id, 'one')).toBe('leased');
		expect(await box.claim()).toHaveLength(0);
	});
});
