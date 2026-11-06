/** Receipt concurrency and transaction lifetime against real PostgreSQL. @module */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { after, before, describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Sql } from 'postgres';
import { ownSchema } from './fixtures/database.ts';
import { expect } from '@std/expect';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import * as storage from '@okikio/storage/workflow/postgres';
import type { Receipt } from '@okikio/storage/workflow/postgres';
import * as workflow from '@okikio/workflow';
import { identity } from '@okikio/workflow/execution';
import { Engine } from './scenarios/events.ts';
import { Policy, Work } from './scenarios/execution.ts';

const cleanup = new AsyncDisposableStack();
let container: StartedPostgreSqlContainer | undefined;
let sql: Sql;

/** Admit and claim one real database job; each test owns its host/store and controls receipt behavior after the claim. */
async function fixture(test: TestContext) {
	const namespace = crypto.randomUUID();
	const store = storage.open({ database: sql, namespace, notifications: false });
	const policy = workflow.PolicySchema.parse({ ...Policy, claims: { ...Policy.claims, leaseMs: 60_000 } });
	const client = workflow.client({ store, policy });
	await client.trigger(Work, { value: 7 }, { scope: 'receipts', key: namespace });
	const host = await store.register('receipt-test', [identity(Work)], Engine.id, {
		activations: 1,
		activities: 1,
	}, 60_000);
	test.after(async () => {
		await store.leave(host);
		await store[Symbol.asyncDispose]();
	});
	const job = (await store.take(host, [identity(Work)]))!;
	expect(job).toBeDefined();
	const options = { key: 'receipt', input: 7, result: schema.string() };
	return { namespace, store, job, options };
}

/** Pause the second transform to expose a callback that returns with admitted work still running. */
function delayed(direction: 'encode' | 'decode', rejection?: Error) {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let calls = 0;
	const transform = schema.defineAsync(async (value: unknown) => {
		if (++calls === 2) {
			entered.resolve();
			await release.promise;
			if (rejection !== undefined) throw rejection;
		}
		return schema.string().parse(value);
	});
	const contract = codec.define<unknown, string, string, string>({
		encode: direction === 'encode' ? codec.identity(transform).encode : schema.string(),
		decode: direction === 'decode' ? transform : schema.string(),
	});
	return { contract, entered, release };
}

describe('PostgreSQL receipt transaction ownership', { concurrency: false, timeout: 30_000 }, () => {
	before(async (test) => {
		let url = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
		if (url === undefined) {
			container = await new PostgreSqlContainer(
				'postgres:18.3@sha256:7e32e9833a6fb1c92c32552794cb6ed569d51b445a54907d35fc112ef39684db',
			).withDatabase('receipts').start();
			cleanup.defer(async () => {
				await container!.stop();
			});
			url = container.getConnectionUri();
		} else {
			const parsed = new URL(url);
			const database = decodeURIComponent(parsed.pathname.slice(1)).toLowerCase();
			if (
				!['postgres:', 'postgresql:'].includes(parsed.protocol) || database.trim() === '' ||
				database === 'postgres' || database.startsWith('template') ||
				parsed.searchParams.has('database') || parsed.searchParams.has('dbname')
			) throw new Error('Receipt tests require a named disposable PostgreSQL database.');
			test.diagnostic('Supplied real PostgreSQL checks; no container test.');
		}
		const owned = cleanup.use(await ownSchema(url, 6));
		url = owned.url;
		sql = owned.database;
		await storage.migrate({ database: sql });
		await sql`create table receipt_lifecycle (id text primary key, value text not null)`;
	});
	after(async () => {
		await cleanup.disposeAsync();
	});

	it('serializes equal concurrent saves and observes them in invocation order', async (test) => {
		const { namespace, store, job, options } = await fixture(test);
		const saved = await store.transaction(job.claim, options, async (_tx, receipt) => {
			const [first, observed, second, third] = await Promise.all([
				receipt.save('same'),
				receipt.get(),
				receipt.save('same'),
				receipt.save('same'),
			]);
			expect([observed?.value, second.value, third.value]).toEqual(['same', 'same', 'same']);
			return first;
		});
		expect(saved.value).toBe('same');
		expect(await sql`select key from utils_workflow.receipts where namespace=${namespace}`).toHaveLength(1);
	});

	it('rolls back domain writes for conflicting concurrent saves, even if the callback catches the conflict', async (test) => {
		const { namespace, store, job, options } = await fixture(test);
		await expect(store.transaction(job.claim, options, async (tx, receipt) => {
			await tx`insert into receipt_lifecycle values (${namespace},'provisional')`;
			const first = receipt.save('first');
			await receipt.save('different').catch(() => {});
			return await first;
		})).rejects.toMatchObject({ code: 'receipt_conflict' });
		expect(await sql`select * from receipt_lifecycle where id=${namespace}`).toHaveLength(0);
		expect(await sql`select key from utils_workflow.receipts where namespace=${namespace}`).toHaveLength(0);
	});

	for (const direction of ['encode', 'decode'] as const) {
		it(`joins an unawaited ${direction} before committing the native transaction`, async (test) => {
			const { namespace, store, job, options } = await fixture(test);
			const gate = delayed(direction);
			const returned = Promise.withResolvers<void>();
			let retained!: Receipt<string>;
			let settled = false;
			const transaction = store.transaction(job.claim, { ...options, result: gate.contract }, async (tx, receipt) => {
				retained = receipt;
				await tx`insert into receipt_lifecycle values (${namespace},'committed')`;
				const first = await receipt.save('same');
				if (direction === 'encode') void receipt.save('same');
				else void receipt.get();
				await gate.entered.promise;
				returned.resolve();
				return first;
			});
			const observed = transaction.finally(() => {
				settled = true;
			});
			try {
				await returned.promise;
				await setImmediate();
				expect(settled).toBe(false);
				await expect(retained.save('too late')).rejects.toMatchObject({ code: 'receipt_closed' });
				await expect(retained.get()).rejects.toMatchObject({ code: 'receipt_closed' });
				expect(await sql`select * from receipt_lifecycle where id=${namespace}`).toHaveLength(0);
			} finally {
				gate.release.resolve();
			}
			expect((await observed).value).toBe('same');
			expect((await sql`select value from receipt_lifecycle where id=${namespace}`)[0]!.value).toBe('committed');
		});
	}

	it('rolls back a dropped save that rejects after its callback has returned', async (test) => {
		const { namespace, store, job, options } = await fixture(test);
		const failure = new Error('encoder rejected');
		const gate = delayed('encode', failure);
		const returned = Promise.withResolvers<void>();
		const transaction = store.transaction(job.claim, { ...options, result: gate.contract }, async (tx, receipt) => {
			await tx`insert into receipt_lifecycle values (${namespace},'provisional')`;
			const first = await receipt.save('same');
			void receipt.save('same');
			await gate.entered.promise;
			returned.resolve();
			return first;
		});
		const rejected = expect(transaction).rejects.toBe(failure);
		await returned.promise;
		gate.release.resolve();
		await rejected;
		expect(await sql`select * from receipt_lifecycle where id=${namespace}`).toHaveLength(0);
		expect(await sql`select key from utils_workflow.receipts where namespace=${namespace}`).toHaveLength(0);
	});

	it('joins admitted work before rollback and preserves the callback failure', async (test) => {
		const { namespace, store, job, options } = await fixture(test);
		const gate = delayed('encode');
		const failure = new Error('callback rejected');
		const returned = Promise.withResolvers<void>();
		let settled = false;
		const transaction = store.transaction(job.claim, { ...options, result: gate.contract }, async (tx, receipt) => {
			await tx`insert into receipt_lifecycle values (${namespace},'provisional')`;
			await receipt.save('same');
			void receipt.save('same');
			await gate.entered.promise;
			returned.resolve();
			throw failure;
		}).finally(() => {
			settled = true;
		});
		const rejected = expect(transaction).rejects.toBe(failure);
		try {
			await returned.promise;
			await setImmediate();
			expect(settled).toBe(false);
		} finally {
			gate.release.resolve();
		}
		await rejected;
		expect(await sql`select * from receipt_lifecycle where id=${namespace}`).toHaveLength(0);
		expect(await sql`select key from utils_workflow.receipts where namespace=${namespace}`).toHaveLength(0);
	});

	it('rejects new receipt operations after completion without invoking their encoder', async (test) => {
		const { store, job, options } = await fixture(test);
		let retained!: Receipt<string>;
		let encodes = 0;
		const contract = codec.define({
			decode: schema.string(),
			encode: schema.transform(schema.string(), (value) => {
				encodes++;
				return value;
			}),
		});
		await store.transaction(job.claim, { ...options, result: contract }, async (_tx, receipt) => {
			retained = receipt;
			return await receipt.save('same');
		});
		await expect(retained.save('late')).rejects.toMatchObject({ code: 'receipt_closed' });
		await expect(retained.get()).rejects.toMatchObject({ code: 'receipt_closed' });
		expect(encodes).toBe(1);
	});
});
