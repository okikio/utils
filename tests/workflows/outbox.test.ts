/** Real SQL transactions prove acceptance and fencing; a separate sink transaction deduplicates redelivery. */
import { after, before, describe, it } from 'node:test';
import { expect } from '@std/expect';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
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

describe('outbox operator recovery', () => {
	it('pages metadata without payloads, filters states, and bounds traversal', async () => {
		await using owned = partition();
		const box = outbox.open({ database, namespace: owned.namespace });
		await database.begin(async (tx) => {
			for (const key of ['c', 'a', 'b']) await box.append(tx, { id: 'list', key, value: { secret: key } });
		});
		const first = await box.list({ limit: 2 });
		expect(first.entries.map((entry) => entry.key)).toEqual(['a', 'b']);
		expect(Object.keys(first.entries[0]!)).not.toContain('value');
		expect(Object.keys(first.entries[0]!)).not.toContain('token');
		const second = await box.list({ limit: 2, after: first.next! });
		expect(second.entries.map((entry) => entry.key)).toEqual(['c']);
		expect(second.next).toBeUndefined();
		expect((await box.list({ state: 'failed' })).entries).toEqual([]);
		await expect(box.list({ limit: 1001 })).rejects.toBeInstanceOf(RangeError);
	});

	it('audits one competing redrive, preserves attempts and identity, and fences old claims', async () => {
		await using owned = partition();
		const box = outbox.open({ database, namespace: owned.namespace, maximumAttempts: 1 });
		await database.begin((tx) => box.append(tx, { id: 'repair', key: 'one', value: 'unchanged' }));
		const first = (await box.claim())[0]!;
		await box.retry(first, 0);
		const decision = {
			id: first.id,
			key: first.key,
			attempt: first.attempt,
			actor: 'operator',
			reason: 'Sink reconciled; decoder deployed.',
		};
		const outcomes = await Promise.allSettled([box.redrive(decision), box.redrive(decision)]);
		expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
		expect((await box.list()).entries[0]).toMatchObject({ state: 'pending', attempt: 1, budget: 1 });
		expect(await database`select actor,reason,attempt from utils_outbox.repairs where namespace=${owned.namespace}`)
			.toEqual([{ actor: decision.actor, reason: decision.reason, attempt: 1 }]);
		await expect(box.complete(first)).rejects.toMatchObject({ code: 'stale' });
		const second = (await box.claim())[0]!;
		expect(second).toMatchObject({ attempt: 2, key: 'one', value: 'unchanged' });
		expect(second.token).not.toBe(first.token);
		await box.complete(second);
		await expect(box.redrive({ ...decision, attempt: 2 })).rejects.toMatchObject({ code: 'stale' });
		expect(await box.prune(Number.MAX_SAFE_INTEGER)).toBe(1);
		expect(await database`select * from utils_outbox.repairs where namespace=${owned.namespace}`).toHaveLength(0);
	});

	it('keeps each new budget finite and rejects a recovery decision based on an older failure', async () => {
		await using owned = partition();
		const box = outbox.open({ database, namespace: owned.namespace, maximumAttempts: 1 });
		await database.begin((tx) => box.append(tx, { id: 'budget', key: 'one', value: null }));
		const first = (await box.claim())[0]!;
		await box.retry(first, 0);
		const decision = {
			id: first.id,
			key: first.key,
			attempt: 1,
			actor: 'operator',
			reason: 'Reconciled first failure.',
		};
		await box.redrive(decision);
		const next = (await box.claim())[0]!;
		await box.retry(next, 0);
		expect(await box.claim()).toHaveLength(0);
		await expect(box.redrive(decision)).rejects.toMatchObject({ code: 'stale' });
		await box.redrive({ ...decision, attempt: 2 });
		expect((await box.claim())[0]!.attempt).toBe(3);
		const history = await box.history('budget', 'one', { limit: 1 });
		expect(history).toHaveLength(1);
		expect(history[0]).toMatchObject({ attempt: 1, actor: 'operator', reason: decision.reason });
		expect((await box.history('budget', 'one', { after: history[0]!.attempt })).map((entry) => entry.attempt)).toEqual([
			2,
		]);
		await expect(box.history('budget', 'one', { after: -1 })).rejects.toBeInstanceOf(RangeError);
	});

	it('renews only an unexpired current token and retains an explicit safe failure reason', async () => {
		await using owned = partition();
		const box = outbox.open({ database, namespace: owned.namespace });
		await database.begin((tx) => box.append(tx, { id: 'renew', key: 'one', value: null }));
		const claim = (await box.claim({ leaseMs: 1000 }))[0]!;
		const previousDeadline = (await box.list()).entries[0]!.expires!;
		await box.renew(claim, 2000);
		// Compare two authority-clock deadlines, rather than assuming the SQL
		// container and this test process have identical wall clocks.
		expect((await box.list()).entries[0]!.expires).toBeGreaterThan(previousDeadline + 500);
		await expect(box.renew({ ...claim, token: crypto.randomUUID() })).rejects.toMatchObject({ code: 'stale' });
		await box.retry(claim, { delayMs: 0, reason: 'sink_unavailable' });
		expect((await box.list()).entries[0]!.failure).toBe('sink_unavailable');
		await expect(box.renew(claim)).rejects.toMatchObject({ code: 'stale' });
		const expired = (await box.claim({ leaseMs: 20 }))[0]!;
		await database`select pg_sleep(0.04)`;
		await expect(box.renew(expired)).rejects.toMatchObject({ code: 'stale' });
		const recovered = (await box.claim())[0]!;
		await box.complete(recovered);
		expect((await box.list()).entries[0]!.failure).toBeNull();
	});
});

describe('outbox dispatcher process loss', () => {
	for (const phase of ['staged', 'claimed', 'accepted'] as const) {
		it(
			`recovers after SIGKILL following ${phase}, without repeating the sink consequence`,
			{ timeout: 15000 },
			async () => {
				await using owned = partition();
				const namespace = owned.namespace;
				const box = outbox.open({ database, namespace });
				if (phase !== 'staged') await database.begin((tx) => box.append(tx, { id: 'crash', key: 'one', value: 'one' }));
				const child = fork(fileURLToPath(new URL('./scenarios/outbox.ts', import.meta.url)), [], {
					execArgv: [],
					stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
					env: { ...process.env, OUTBOX_DATABASE_URL: url, OUTBOX_NAMESPACE: namespace, OUTBOX_PHASE: phase },
				});
				await using cleanup = new AsyncDisposableStack();
				// Register ownership before waiting for readiness so startup failure cannot
				// strand a dispatcher. close joins both the process and its IPC channel.
				const closed = once(child, 'close');
				cleanup.defer(async () => {
					if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
					await closed;
				});
				const ready = AbortSignal.timeout(10000);
				const [receipt] = await once(child, 'message', { signal: ready });
				expect(receipt).toMatchObject({ phase });
				child.kill('SIGKILL');
				const [, signal] = await closed;
				expect(signal).toBe('SIGKILL');
				await database`select pg_sleep(0.2)`;
				if (phase === 'staged') {
					expect(await box.inspect('crash', 'one')).toBeUndefined();
					expect(await database`select * from outbox_fixture where namespace=${namespace}`).toHaveLength(0);
					return;
				}

				const recovered = (await box.claim())[0]!;
				expect(recovered.attempt).toBe(2);
				await database.begin(async (tx) => {
					const receipt =
						await tx`insert into outbox_inbox values (${namespace},${recovered.id},${recovered.key}) on conflict do nothing returning key`;
					if (receipt.length) await tx`insert into outbox_fixture values (${namespace},'one')`;
				});
				await box.complete(recovered);
				expect(await database`select value from outbox_fixture where namespace=${namespace}`).toEqual([{
					value: 'one',
				}]);
				expect(await box.inspect('crash', 'one')).toBe('complete');
			},
		);
	}
});
