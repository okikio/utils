/**
 * Real PostgreSQL and fresh execution processes. The default lane owns a pinned container;
 * UTILS_WORKFLOW_TEST_DATABASE_URL explicitly borrows a disposable database for process-crash test.
 * @module
 */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { after, before, describe, it } from 'node:test';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { expect } from '@std/expect';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgresjs from 'postgres';
import type { Sql } from 'postgres';
import { ownSchema } from './fixtures/database.ts';
import * as workflow from '@okikio/workflow';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as postgres from '@okikio/storage/workflow/postgres';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import { fingerprint, identity } from '@okikio/workflow/execution';
import { CoreEngine, CorePolicy, Parse, Resolution, ResolutionLive, Resolve, Verify } from './scenarios/core.ts';
import { Acquire, Expire, IntelligencePolicy } from './scenarios/intelligence.ts';
import { BatchResultSchema, digest, IdentitySchema } from './scenarios/contracts.ts';

const image = 'postgres:18.3@sha256:7e32e9833a6fb1c92c32552794cb6ed569d51b445a54907d35fc112ef39684db';
const root = fileURLToPath(new URL('../../', import.meta.url));
const processes = new Set<ChildProcess>();
const exits = new Set<Promise<unknown>>();
const cleanup = new AsyncDisposableStack();
let container: StartedPostgreSqlContainer | undefined;
let sql: Sql;
let url: string;
let provider: Child;

/** Bound condition waits by a deadline and report the last observed error instead of sleeping for assumed progress. */
async function until<Value>(read: () => Promise<Value | undefined | false>, timeout = 15_000): Promise<Value> {
	const signal = AbortSignal.timeout(timeout);
	let last: unknown;
	while (!signal.aborted) {
		try {
			const value = await read();
			if (value !== false && value !== undefined) return value;
		} catch (error) {
			last = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error('Condition did not become true before its deadline.', { cause: last });
}

/** Child output is only a test barrier. Durable state remains in PostgreSQL. Each replacement starts with no JS state. */
class Child {
	readonly child: ChildProcess;
	readonly events: Record<string, unknown>[] = [];
	readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
	#stderr = '';
	constructor(name: 'host' | 'provider', environment: Record<string, string>, runtime = 'node') {
		const file = `tests/workflows/scenarios/${name}.ts`;
		const command = runtime === 'deno' ? process.env.DENO_BIN ?? 'deno' : process.execPath;
		const args = runtime === 'deno' ? ['run', '-A', file] : [file];
		this.child = spawn(command, args, {
			cwd: root,
			env: { ...process.env, ...environment },
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		processes.add(this.child);
		let pending = '';
		this.child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
			pending += chunk;
			for (;;) {
				const end = pending.indexOf('\n');
				if (end < 0) break;
				const line = pending.slice(0, end);
				pending = pending.slice(end + 1);
				try {
					this.events.push(JSON.parse(line));
				} catch { /* Runtime diagnostics are not barriers. */ }
			}
		});
		this.child.stderr!.setEncoding('utf8').on('data', (chunk: string) => {
			this.#stderr = (this.#stderr + chunk).slice(-16_384);
		});
		this.exited = new Promise((resolve, reject) => {
			this.child.once('error', reject);
			this.child.once('exit', (code, signal) => {
				processes.delete(this.child);
				resolve({ code, signal });
			});
		});
		exits.add(this.exited);
		void this.exited.finally(() => exits.delete(this.exited)).catch(() => {});
	}
	async event(name: string): Promise<Record<string, unknown>> {
		return await until(async () => {
			const event = this.events.find((entry) => entry.event === name || entry.name === name);
			if (event) return event;
			if (this.child.exitCode !== null || this.child.signalCode !== null) {
				throw new Error(`Child exited: ${this.#stderr}`);
			}
			return undefined;
		});
	}
	async ready(): Promise<string> {
		const event = await this.event('listening');
		const origin = `http://127.0.0.1:${event.port}`;
		await until(async () => {
			const response = await fetch(`${origin}/ready`, { signal: AbortSignal.timeout(1000) });
			await response.body?.cancel();
			return response.ok && origin;
		});
		return origin;
	}
	async kill(): Promise<void> {
		this.child.kill('SIGCONT');
		this.child.kill('SIGKILL');
		await this.exited;
	}
	async close(): Promise<void> {
		if (!processes.has(this.child)) return;
		this.child.kill('SIGCONT');
		this.child.kill('SIGTERM');
		const done = await Promise.race([
			this.exited.then(() => true),
			new Promise<false>((resolve) => setTimeout(() => resolve(false), 2000)),
		]);
		if (!done) await this.kill();
	}
}

function host(namespace: string, pause = '', runtime = 'node', environment: Record<string, string> = {}): Child {
	return new Child('host', {
		DATABASE_URL: url,
		WORKFLOW_NAMESPACE: namespace,
		PROVIDER_URL: `http://127.0.0.1:${provider.events.find((entry) => entry.event === 'listening')!.port}`,
		PAUSE_AT: pause,
		...environment,
	}, runtime);
}

/** One request transaction admits the import with its immutable source. No executor is necessary to accept work. */
async function source(client: workflow.ClientType, body = 'name\nAda\nGrace') {
	const scope = crypto.randomUUID();
	const source = crypto.randomUUID();
	const input = { scope, source, revision: 1, digest: await digest(body) };
	const ref = await postgres.begin(sql, async (tx) => {
		await tx`insert into sources(scope,id,revision,digest,body) values (${scope},${source},1,${input.digest},${body})`;
		return await client.in(tx).submit(Parse, input, { scope, key: `source:${source}` });
	});
	return { input, ref };
}

/** Commit a fresh research grant and its first durable job in the same transaction so no accepted job can precede its domain authority. */
async function research(client: workflow.ClientType, expires = 10_000) {
	const input = {
		scope: crypto.randomUUID(),
		research: crypto.randomUUID(),
		grant: crypto.randomUUID(),
		url: 'https://fixture.invalid/evidence',
		expiresAt: new Date(Date.now() + expires).toISOString(),
	};
	const ref = await postgres.begin(sql, async (tx) => {
		await tx`insert into research(scope,id,grant_id,expires_at) values (${input.scope},${input.research},${input.grant},${input.expiresAt})`;
		return await client.in(tx).submit(Acquire, input, { scope: input.scope, key: `research:${input.research}` });
	});
	return { input, ref };
}

describe('PostgreSQL process-crash recovery', { timeout: 240_000, concurrency: false }, () => {
	before(async (test) => {
		const supplied = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
		if (supplied !== undefined) {
			const parsed = new URL(supplied);
			const database = decodeURIComponent(parsed.pathname.slice(1)).toLowerCase();
			if (
				!['postgres:', 'postgresql:'].includes(parsed.protocol) || database.trim() === '' ||
				database === 'postgres' || database.startsWith('template') ||
				parsed.searchParams.has('database') || parsed.searchParams.has('dbname')
			) {
				throw new Error(
					'Recovery tests require a named disposable PostgreSQL database, never postgres or template databases.',
				);
			}
			url = supplied;
			test.diagnostic(
				'Process-crash checks against the supplied real PostgreSQL database; no container test.',
			);
		} else {
			container = await new PostgreSqlContainer(image).withDatabase('workflows').withUsername('fixture').withPassword(
				'fixture',
			).start();
			cleanup.defer(async () => {
				await container!.stop();
			});
			url = container.getConnectionUri();
			test.diagnostic('Process-crash checks against the pinned PostgreSQL container.');
		}
		const owned = cleanup.use(await ownSchema(url, 12));
		url = owned.url;
		sql = owned.database;
		await postgres.migrate({ database: sql });
		await sql.unsafe(await readFile(new URL('./scenarios/schema.sql', import.meta.url), 'utf8'));
		cleanup.defer(async () => {
			for (const child of processes) child.kill('SIGKILL');
			await Promise.allSettled([...exits]);
		});
		provider = new Child('provider', { DATABASE_URL: url });
		await provider.ready();
	});
	after(async () => {
		await cleanup.disposeAsync();
	});

	it('repeats schema setup safely and accepts work with no worker', async () => {
		await postgres.migrate({ database: sql });
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		await store.check();
		const client = workflow.client({ store, policy: CorePolicy });
		const { ref } = await source(client);
		expect((await client.get(Parse, ref)).state).toBe('waiting');
		expect(await sql`select id from utils_workflow.hosts where namespace=${store.namespace}`).toHaveLength(0);
	});

	it('rolls back source and job together and rejects foreign or finished transactions', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		const client = workflow.client({ store, policy: CorePolicy });
		const input = {
			scope: crypto.randomUUID(),
			source: crypto.randomUUID(),
			revision: 1,
			digest: await digest('name\nAda'),
		};
		await expect(postgres.begin(sql, async (tx) => {
			await tx`insert into sources(scope,id,revision,digest,body) values (${input.scope},${input.source},1,${input.digest},'name\nAda')`;
			await client.in(tx).submit(Parse, input, { scope: input.scope, key: 'rollback' });
			throw new Error('rollback');
		})).rejects.toThrow('rollback');
		expect(await sql`select id from sources where scope=${input.scope}`).toHaveLength(0);
		expect(await sql`select id from utils_workflow.runs where namespace=${store.namespace}`).toHaveLength(0);
		let ended: unknown;
		await postgres.begin(sql, async (tx) => {
			ended = tx;
		});
		await expect(client.in(ended).submit(Parse, input, { scope: input.scope, key: 'ended' })).rejects.toMatchObject({
			code: 'transaction_binding',
		});
		await expect(client.in(sql).submit(Parse, input, { scope: input.scope, key: 'pool' })).rejects.toMatchObject({
			code: 'transaction_binding',
		});
		const other = postgresjs(url);
		try {
			await expect(
				postgres.begin(
					other,
					async (tx) => await client.in(tx).submit(Parse, input, { scope: input.scope, key: 'foreign' }),
				),
			).rejects.toMatchObject({ code: 'transaction_binding' });
		} finally {
			await other.end();
		}
	});

	it('accepts one matching command and rejects changed input, policy, scope, or definition', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		const client = workflow.client({ store, policy: CorePolicy });
		const { input, ref } = await source(client);
		const refs = await Promise.all(
			Array.from(
				{ length: 8 },
				() => client.submit(Parse, input, { scope: input.scope, key: `source:${input.source}` }),
			),
		);
		expect(refs.every((value) => value.id === ref.id)).toBe(true);
		await expect(client.submit(Parse, { ...input, revision: 2 }, { scope: input.scope, key: `source:${input.source}` }))
			.rejects.toMatchObject({ code: 'admission_conflict' });
		const changed = workflow.client({ store, policy: { ...CorePolicy, version: '2' } });
		await expect(changed.submit(Parse, input, { scope: input.scope, key: `source:${input.source}` })).rejects
			.toMatchObject({ code: 'admission_conflict' });
		await expect(client.get(Resolution, ref)).rejects.toMatchObject({ code: 'reference_conflict' });
		await expect(client.get(Parse, { ...ref, scope: crypto.randomUUID() })).rejects.toMatchObject({
			code: 'reference_conflict',
		});
	});

	for (const boundary of ['core.rows.committed', 'core.source.committed', 'core.batch.committed']) {
		it(`Core resumes after SIGKILL at ${boundary}, preserving rows, corrections, and batch receipts`, async () => {
			const namespace = crypto.randomUUID();
			await using store = postgres.open({ database: sql, namespace });
			const client = workflow.client({ store, policy: CorePolicy });
			const first = host(namespace, boundary);
			let replacement: Child | undefined;
			try {
				await first.ready();
				const { input, ref } = await source(
					client,
					'name\n' + Array.from({ length: 1005 }, (_, index) => `name-${index}`).join('\n'),
				);
				await first.event(boundary);
				await first.kill();
				await sql`update source_rows set correction='customer correction' where scope=${input.scope} and source=${input.source} and position=1`;
				replacement = host(namespace);
				await replacement.ready();
				const imported = await client.wait(Parse, ref, { signal: AbortSignal.timeout(20_000), intervalMs: 25 });
				expect(imported.status).toBe('verified');
				expect(imported.rows).toBe(1005);
				await client.wait(Resolution, imported.next!, { signal: AbortSignal.timeout(20_000), intervalMs: 25 });
				const rows = await sql`select * from source_rows where scope=${input.scope} order by position`;
				const accounts = await sql`select * from accounts where scope=${input.scope} order by position`;
				expect(rows).toHaveLength(1005);
				expect(accounts).toHaveLength(1005);
				expect(rows[0]!.original).toEqual(['name-0']);
				expect(rows[0]!.correction).toBe('customer correction');
				if (boundary !== 'core.batch.committed') expect(accounts[0]!.value).toBe('customer correction');
				const runs = await sql`select * from utils_workflow.runs where namespace=${namespace}`;
				expect(runs).toHaveLength(2);
				expect(runs.every((run) => run.state === 'completed')).toBe(true);
				const abandoned =
					await sql`select * from utils_workflow.attempts where namespace=${namespace} and state='abandoned'`;
				expect(abandoned.length).toBeGreaterThan(0);
				const receipts =
					await sql`select r.value from utils_workflow.receipts r join utils_workflow.jobs j on j.namespace=r.namespace and j.id=r.job where r.namespace=${namespace} and r.key='batch-v1' order by j.path`;
				expect(receipts).toHaveLength(2);
				expect(BatchResultSchema.parse((receipts[0]!.value as { value: unknown }).value).count).toBe(1000);
			} finally {
				await first.close();
				await replacement?.close();
			}
		});
	}

	it('malformed CSV retains rejection and independently verifies original bytes', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: CorePolicy });
		const execution = host(namespace, 'core.source.committed');
		let replacement: Child | undefined;
		try {
			await execution.ready();
			const { input, ref } = await source(client, 'name\n"unterminated');
			await execution.event('core.source.committed');
			await execution.kill();
			replacement = host(namespace);
			await replacement.ready();
			const result = await client.wait(Parse, ref, { signal: AbortSignal.timeout(15_000) });
			expect(result.status).toBe('rejected');
			await client.wait(Verify, result.next!, { signal: AbortSignal.timeout(15_000) });
			expect(await sql`select * from accounts where scope=${input.scope}`).toHaveLength(0);
			expect((await sql`select * from sources where scope=${input.scope}`)[0]!.verified).toBe(true);
		} finally {
			await execution.close();
			await replacement?.close();
		}
	});

	it('Core rejects late writes from the old worker after its replacement finishes', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: CorePolicy });
		const old = host(namespace, 'core.batch.before-write');
		let replacement: Child | undefined;
		try {
			await old.ready();
			const { input, ref } = await source(client);
			await old.event('core.batch.before-write');
			old.child.kill('SIGSTOP');
			replacement = host(namespace);
			await replacement.ready();
			const imported = await client.wait(Parse, ref, { signal: AbortSignal.timeout(15_000) });
			await client.wait(Resolution, imported.next!, { signal: AbortSignal.timeout(15_000) });
			old.child.kill('SIGCONT');
			old.child.kill('SIGUSR1');
			await until(async () => {
				const rows =
					await sql`select * from utils_workflow.attempts where namespace=${namespace} and state='abandoned'`;
				return rows.length > 0;
			});
			expect(await sql`select * from accounts where scope=${input.scope}`).toHaveLength(2);
		} finally {
			await old.close();
			await replacement?.close();
		}
	});

	for (
		const boundary of [
			'intelligence.remote.committed',
			'intelligence.stage.before-write',
			'intelligence.publication.committed',
		]
	) {
		it(`Intelligence recovers ${boundary} with one capture and one contribution`, async () => {
			const namespace = crypto.randomUUID();
			await using store = postgres.open({ database: sql, namespace });
			const client = workflow.client({ store, policy: IntelligencePolicy });
			const first = host(namespace, boundary);
			let replacement: Child | undefined;
			try {
				await first.ready();
				const { input, ref } = await research(client);
				const event = await first.event(boundary);
				await first.kill();
				replacement = host(namespace);
				await replacement.ready();
				const value = await client.wait(Acquire, ref, { signal: AbortSignal.timeout(15_000), intervalMs: 25 });
				expect(await sql`select * from captures where scope=${input.scope}`).toHaveLength(1);
				const contributions = await sql`select * from contributions where scope=${input.scope}`;
				expect(contributions).toHaveLength(1);
				expect(contributions[0]!.commit).toBe(value.commit);
				if (boundary === 'intelligence.publication.committed') expect(value.commit).toBe(event.commit);
				const captures =
					await sql`select * from utils_workflow.jobs where namespace=${namespace} and definition->>'id'='fixture.intelligence.capture'`;
				expect(captures).toHaveLength(1);
			} finally {
				await first.close();
				await replacement?.close();
			}
		});
	}

	it('Intelligence reconstructs a durable timer with no retained process or activity slot', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: IntelligencePolicy });
		const first = host(namespace);
		let replacement: Child | undefined;
		try {
			await first.ready();
			// Leave startup and publication separate from the due time, including on a busy Docker host.
			const { input, ref } = await research(client, 20_000);
			await client.wait(Acquire, ref, { signal: AbortSignal.timeout(15_000), intervalMs: 25 });
			const timers =
				await sql`select * from utils_workflow.instructions where namespace=${namespace} and type='sleep-until' and outcome is null`;
			expect(timers).toHaveLength(1);
			await first.kill();
			replacement = host(namespace);
			await replacement.ready();
			await until(async () => (await sql`select closed from research where scope=${input.scope}`)[0]!.closed, 30_000);
			const captures = await sql`select * from captures where scope=${input.scope}`;
			expect(captures).toHaveLength(1);
			expect(captures[0]!.body).toBeNull();
			const duplicate = await fetch(
				`http://127.0.0.1:${provider.events.find((entry) => entry.event === 'listening')!.port}/capture`,
				{
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						'idempotency-key': `capture-v1:${input.scope}:${input.research}`,
					},
					body: JSON.stringify(input),
				},
			);
			expect(duplicate.status).toBe(200);
			expect((await duplicate.json()).version).toBe(captures[0]!.version);
			expect((await sql`select body from captures where scope=${input.scope}`)[0]!.body).toBeNull();
			const expiry =
				(await sql`select * from utils_workflow.runs where namespace=${namespace} and definition=${Expire.id}`)[0]!;
			await client.wait(Expire, { id: expiry.id, namespace, scope: input.scope, definition: identity(Expire) }, {
				signal: AbortSignal.timeout(15_000),
			});
		} finally {
			await first.close();
			await replacement?.close();
		}
	});

	it('stopping a status wait leaves work accepted; cancellation before a worker starts stays saved', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: CorePolicy });
		const { ref } = await source(client);
		const signal = AbortSignal.abort(new Error('observer ended'));
		await expect(client.wait(Parse, ref, { signal })).rejects.toThrow('observer ended');
		expect((await client.get(Parse, ref)).state).toBe('waiting');
		expect(await client.cancel(ref, 'customer cancelled')).toBe('requested');
		const execution = host(namespace);
		try {
			await execution.ready();
			await until(async () => (await client.get(Parse, ref)).state === 'cancelled');
		} finally {
			await execution.close();
		}
		expect(await client.cancel(ref, 'repeat')).toBe('too_late');
	});

	it('rolls back a write without a valid receipt and returns a prior saved receipt', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		const client = workflow.client({ store, policy: CorePolicy });
		const { input } = await source(client);
		const registration = await store.register('direct', [identity(Parse)], CoreEngine.id, {
			activities: 1,
			activations: 1,
		}, 5000);
		const job = (await store.take(registration, [identity(Parse)]))!;
		const write = { key: 'test-v1', input, result: IdentitySchema };
		await expect(store.transaction(job.claim, write, async (tx) => {
			await tx`update sources set verified=true where scope=${input.scope}`;
			return { value: input };
		})).rejects.toMatchObject({ code: 'receipt_return' });
		expect((await sql`select verified from sources where scope=${input.scope}`)[0]!.verified).toBe(false);
		let callbacks = 0;
		for (let pass = 0; pass < 2; pass++) {
			await store.transaction(job.claim, write, async (tx, receipt) => {
				callbacks++;
				const saved = await receipt.get();
				if (saved) return saved;
				await tx`update sources set verified=true where scope=${input.scope}`;
				return await receipt.save(input);
			});
		}
		expect(callbacks).toBe(2);
		expect((await store.getReceipt(job.claim, write))!.value).toEqual(input);
		await expect(store.getReceipt(job.claim, { ...write, input: { ...input, revision: 2 } })).rejects.toMatchObject({
			code: 'receipt_conflict',
		});
		await expect(store.getReceipt(undefined, write)).rejects.toMatchObject({ code: 'claim_binding' });
		await expect(store.getReceipt({ ...job.claim }, write)).rejects.toMatchObject({ code: 'claim_binding' });
	});

	it('restores receipt application values through an explicit codec after reopening the store', async () => {
		const namespace = crypto.randomUUID();
		await using original = postgres.open({ database: sql, namespace });
		const { input } = await source(workflow.client({ store: original, policy: CorePolicy }));
		const registration = await original.register('date-original', [identity(Parse)], CoreEngine.id, {
			activities: 1,
			activations: 1,
		}, 5000);
		const job = (await original.take(registration, [identity(Parse)]))!;
		let encodes = 0, decodes = 0;
		const dates = codec.define({
			decode: schema.transform(schema.string(), (value) => {
				decodes++;
				return new Date(value);
			}),
			encode: schema.transform(schema.date(), (value) => {
				encodes++;
				return value.toISOString();
			}),
		});
		const date = new Date('2026-10-31T12:34:56Z');
		const options = { key: 'date-v1', input, result: dates };
		const saved = await original.transaction(job.claim, options, async (tx, receipt) => {
			await tx`update sources set verified=true where scope=${input.scope}`;
			return await receipt.save(date);
		});
		expect(saved.value).toEqual(date);
		expect(encodes).toBeGreaterThan(0);
		const persisted =
			(await sql`select value from utils_workflow.receipts where namespace=${namespace} and job=${job.claim.jobId} and key='date-v1'`)[
				0
			]!;
		expect(persisted.value).toEqual({ kind: 'value', value: date.toISOString() });
		await original[Symbol.asyncDispose]();
		// A replacement obtains a fresh claim; the old adapter's opaque permission never transfers.
		await sql`update utils_workflow.jobs set expires=clock_timestamp()-interval '1 second' where namespace=${namespace} and id=${job.claim.jobId}`;
		await using replacement = postgres.open({ database: sql, namespace });
		await replacement.recover(10);
		const current = await replacement.register('date-replacement', [identity(Parse)], CoreEngine.id, {
			activities: 1,
			activations: 1,
		}, 5000);
		const next = await until(async () => await replacement.take(current, [identity(Parse)]));
		const before = decodes;
		const restored = await replacement.getReceipt(next.claim, options);
		expect(restored?.value).toBeInstanceOf(Date);
		expect(restored?.value).toEqual(date);
		expect(decodes).toBeGreaterThan(before);
		const repeated = await replacement.transaction(
			next.claim,
			options,
			async (_tx, receipt) => await receipt.save(date),
		);
		expect(repeated.value).toEqual(date);
		let called = false;
		await expect(
			replacement.transaction(next.claim, {
				...options,
				key: 'one-way',
				result: schema.transform(schema.string(), (value) => new Date(value)),
			}, async (_tx, receipt) => {
				called = true;
				return await receipt.save(date);
			}),
		).rejects.toBeInstanceOf(TypeError);
		expect(called).toBe(false);
	});

	it('a full root queue leaves room for promised follow-up work and exit recording', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const limited = workflow.PolicySchema.parse({ ...CorePolicy, limits: { ...CorePolicy.limits, pendingRoots: 1 } });
		const client = workflow.client({ store, policy: limited });
		const { ref } = await source(client);
		await expect(source(client)).rejects.toMatchObject({ code: 'admission_capacity' });
		const execution = host(namespace, '', 'node', { CORE_POLICY: JSON.stringify(limited) });
		try {
			await execution.ready();
			const value = await client.wait(Parse, ref, { signal: AbortSignal.timeout(15_000) });
			await client.wait(Resolution, value.next!, { signal: AbortSignal.timeout(15_000) });
			expect((await client.get(Parse, ref)).state).toBe('completed');
		} finally {
			await execution.close();
		}
	});

	it('runs the same worker source in a fresh Deno process', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: CorePolicy });
		const execution = host(namespace, '', 'deno');
		try {
			await execution.ready();
			const { ref } = await source(client);
			const value = await client.wait(Parse, ref, { signal: AbortSignal.timeout(20_000) });
			await client.wait(Resolution, value.next!, { signal: AbortSignal.timeout(20_000) });
		} finally {
			await execution.close();
		}
	});

	it('a replacement invalidates the old worker and concurrent workers cannot take the same job', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		const client = workflow.client({ store, policy: CorePolicy });
		const { input } = await source(client);
		const a = await store.register('a', [identity(Parse)], CoreEngine.id, { activities: 1, activations: 1 }, 5000);
		const b = await store.register('b', [identity(Parse)], CoreEngine.id, { activities: 1, activations: 1 }, 5000);
		const claims = await Promise.all([store.take(a, [identity(Parse)]), store.take(b, [identity(Parse)])]);
		const claimed = claims.filter((entry) => entry !== undefined);
		expect(claimed).toHaveLength(1);
		const job = claimed[0]!;
		await store.register(job.claim.hostId, [identity(Parse)], CoreEngine.id, { activities: 1, activations: 1 }, 5000);
		await expect(store.getReceipt(job.claim, { key: 'fenced', input, result: IdentitySchema })).rejects.toMatchObject({
			code: 'stale_claim',
		});
		await expect(store.complete(job, { type: 'success', value: { kind: 'undefined' } }, 'permanent')).rejects
			.toMatchObject({ code: 'stale_claim' });
	});

	it('a write that locks permission first can commit before cancellation even after its permission expires', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		const client = workflow.client({ store, policy: CorePolicy });
		const { input, ref } = await source(client);
		const registration = await store.register('guard', [identity(Parse)], CoreEngine.id, {
			activities: 1,
			activations: 1,
		}, 5000);
		const job = (await store.take(registration, [identity(Parse)]))!;
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const writing = store.transaction(
			job.claim,
			{ key: 'guard', input, result: IdentitySchema },
			async (tx, receipt) => {
				entered.resolve();
				await release.promise;
				await tx`update sources set verified=true where scope=${input.scope}`;
				return await receipt.save(input);
			},
		);
		await entered.promise;
		try {
			await until(async () =>
				(await sql`select expires<=clock_timestamp() as expired from utils_workflow.jobs where namespace=${store.namespace} and id=${job.claim.jobId}`)[
					0
				]!.expired
			);
			const cancellation = client.cancel(ref, 'after guard');
			await until(async () =>
				(await sql`select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%utils_workflow.runs%'`)
					.length > 0
			);
			release.resolve();
			await writing;
			expect(await cancellation).toBe('requested');
			expect((await sql`select verified from sources where scope=${input.scope}`)[0]!.verified).toBe(true);
			await expect(store.getReceipt(job.claim, { key: 'guard', input, result: IdentitySchema })).rejects.toMatchObject({
				code: 'stale_claim',
			});
		} finally {
			release.resolve();
			await writing;
		}
	});

	it('cancellation that commits first prevents a later domain write', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		const client = workflow.client({ store, policy: CorePolicy });
		const { input, ref } = await source(client);
		const registration = await store.register('cancel-first', [identity(Parse)], CoreEngine.id, {
			activities: 1,
			activations: 1,
		}, 5000);
		const job = (await store.take(registration, [identity(Parse)]))!;
		await client.cancel(ref, 'first');
		const cancelled =
			await sql`select * from utils_workflow.attempts where namespace=${store.namespace} and job=${job.claim.jobId}`;
		expect(cancelled[0]!.state).toBe('cancelled');
		expect(cancelled[0]!.ended).not.toBeNull();
		await expect(
			store.transaction(job.claim, { key: 'cancelled', input, result: IdentitySchema }, async (tx, receipt) => {
				await tx`update sources set verified=true where scope=${input.scope}`;
				return await receipt.save(input);
			}),
		).rejects.toMatchObject({ code: 'stale_claim' });
		expect((await sql`select verified from sources where scope=${input.scope}`)[0]!.verified).toBe(false);
	});

	it('receipt validators and callback lifetime reject invalid results without committing writes', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		const client = workflow.client({ store, policy: CorePolicy });
		const { input } = await source(client);
		const registration = await store.register('receipt', [identity(Parse)], CoreEngine.id, {
			activities: 1,
			activations: 1,
		}, 5000);
		const job = (await store.take(registration, [identity(Parse)]))!;
		let escaped: postgres.Receipt<import('./scenarios/contracts.ts').IdentityType> | undefined;
		await expect(
			store.transaction(job.claim, { key: 'validation', input, result: IdentitySchema }, async (tx, receipt) => {
				escaped = receipt;
				await tx`update sources set verified=true where scope=${input.scope}`;
				return await receipt.save({ ...input, revision: -1 });
			}),
		).rejects.toThrow();
		expect((await sql`select verified from sources where scope=${input.scope}`)[0]!.verified).toBe(false);
		await expect(escaped!.save(input)).rejects.toMatchObject({ code: 'receipt_closed' });
	});

	it('retries a declared transient fault without repeating committed row writes', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: CorePolicy });
		const execution = host(namespace, '', 'node', { RETRY_AT: 'core.rows.committed' });
		try {
			await execution.ready();
			const { ref, input } = await source(client);
			const value = await client.wait(Parse, ref, { signal: AbortSignal.timeout(15_000) });
			await client.wait(Resolution, value.next!, { signal: AbortSignal.timeout(15_000) });
			expect(await sql`select * from source_rows where scope=${input.scope}`).toHaveLength(2);
			const attempts =
				await sql`select a.* from utils_workflow.attempts a join utils_workflow.jobs j on j.namespace=a.namespace and j.id=a.job where a.namespace=${namespace} and j.definition->>'id'=${Parse.id} order by sequence`;
			expect(attempts).toHaveLength(2);
			expect(attempts[0]!.state).toBe('fault');
			expect(attempts[1]!.state).toBe('success');
		} finally {
			await execution.close();
		}
	});

	it('crashed attempts count toward the saved attempt limit', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const policy = workflow.PolicySchema.parse({
			...CorePolicy,
			activities: CorePolicy.activities.map((entry) => ({ ...entry, maxAttempts: 1 })),
		});
		const client = workflow.client({ store, policy });
		const environment = { CORE_POLICY: JSON.stringify(policy) };
		const first = host(namespace, 'core.rows.committed', 'node', environment);
		let replacement: Child | undefined;
		try {
			await first.ready();
			const { ref } = await source(client);
			await first.event('core.rows.committed');
			await first.kill();
			replacement = host(namespace, '', 'node', environment);
			await replacement.ready();
			await until(async () => (await client.get(Parse, ref)).state === 'failed');
			const jobs =
				await sql`select * from utils_workflow.jobs where namespace=${namespace} and definition->>'id'=${Parse.id}`;
			expect(jobs[0]!.sequence).toBe(1);
			expect(jobs[0]!.outcome.code).toBe('abandoned');
		} finally {
			await first.close();
			await replacement?.close();
		}
	});

	it('an uncertain crash result waits for inspection; a recorded retry keeps the same job ID', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const policy = workflow.PolicySchema.parse({
			...CorePolicy,
			activities: CorePolicy.activities.map((entry) => ({ ...entry, recovery: 'reconcile' })),
		});
		const client = workflow.client({ store, policy });
		const environment = { CORE_POLICY: JSON.stringify(policy) };
		const first = host(namespace, 'core.rows.committed', 'node', environment);
		let replacement: Child | undefined;
		try {
			await first.ready();
			const { ref } = await source(client);
			const barrier = await first.event('core.rows.committed');
			await first.kill();
			replacement = host(namespace, '', 'node', environment);
			await replacement.ready();
			const state = await until(async () => {
				const state = await client.get(Parse, ref);
				return state.state === 'blocked' && state;
			});
			expect(state.reason).toBe('reconciliation');
			await expect(
				client.repair(ref, {
					actor: 'test',
					reason: 'checked committed row receipt',
					epoch: state.epoch - 1,
					attempts: 1,
				}),
			).rejects.toMatchObject({ code: 'repair_conflict' });
			await client.repair(ref, {
				actor: 'test',
				reason: 'checked committed row receipt',
				epoch: state.epoch,
				attempts: 1,
			});
			const value = await client.wait(Parse, ref, { signal: AbortSignal.timeout(15_000) });
			expect(value.status).toBe('verified');
			const job =
				(await sql`select * from utils_workflow.jobs where namespace=${namespace} and id=${barrier.job as string}`)[0]!;
			expect(job.sequence).toBe(2);
			expect(job.generation).toBeGreaterThan(1);
			expect(await sql`select * from utils_workflow.audit where namespace=${namespace} and action='repair'`)
				.toHaveLength(1);
		} finally {
			await first.close();
			await replacement?.close();
		}
	});

	it('crashing after finalizer receipt commit retries finalization without reparsing', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: CorePolicy });
		const first = host(namespace, 'exit.committed');
		let replacement: Child | undefined;
		try {
			await first.ready();
			const { ref } = await source(client);
			await first.event('exit.committed');
			await first.kill();
			replacement = host(namespace);
			await replacement.ready();
			await client.wait(Parse, ref, { signal: AbortSignal.timeout(15_000) });
			expect(await sql`select * from exits where run=${ref.id}`).toHaveLength(1);
			const job =
				(await sql`select * from utils_workflow.jobs where namespace=${namespace} and run=${ref.id} and path='root'`)[
					0
				]!;
			expect(job.sequence).toBe(1);
		} finally {
			await first.close();
			await replacement?.close();
		}
	});

	it('finalizer failure retains the intended success and repair targets finalization only', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: CorePolicy });
		const first = host(namespace, '', 'node', { FAIL_AT: 'exit.before-write' });
		let replacement: Child | undefined;
		try {
			await first.ready();
			const { ref } = await source(client);
			const blocked = await until(async () => {
				const state = await client.get(Parse, ref);
				return state.state === 'blocked' && state;
			});
			expect(blocked.reason).toBe('finalizer_exhausted');
			expect(blocked.exit!.type).toBe('success');
			await first.close();
			await client.repair(ref, { actor: 'test', reason: 'restored exit sink', epoch: blocked.epoch, attempts: 1 });
			replacement = host(namespace);
			await replacement.ready();
			await client.wait(Parse, ref, { signal: AbortSignal.timeout(15_000) });
			const jobs = await sql`select * from utils_workflow.jobs where namespace=${namespace} and run=${ref.id}`;
			expect(jobs.find((entry) => entry.path === 'root')!.sequence).toBe(1);
			expect(jobs.find((entry) => entry.finalizer)!.sequence).toBe(2);
		} finally {
			await first.close();
			await replacement?.close();
		}
	});

	it('an incompatible worker leaves the accepted version available to a live compatible worker', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		const client = workflow.client({ store, policy: CorePolicy });
		const input = { scope: crypto.randomUUID(), source: crypto.randomUUID(), revision: 1, digest: await digest('x') };
		const ref = await client.submit(Resolution, input, { scope: input.scope, key: 'rolling-versions' });
		const current = await store.register('current', [identity(Resolution)], CoreEngine.id, {
			activities: 1,
			activations: 1,
		}, 5000);
		const next = { ...identity(Resolution), version: '2' };
		const newer = await store.register('newer', [next], CoreEngine.id, { activities: 1, activations: 1 }, 5000);
		expect(await store.activate(newer, [next])).toBeUndefined();
		expect((await client.get(Resolution, ref)).state).toBe('ready');
		expect((await store.activate(current, [identity(Resolution)]))!.ref.id).toBe(ref.id);
	});

	it('missing accepted workflow code blocks the run instead of running a newer version', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		const client = workflow.client({ store, policy: CorePolicy });
		const input = { scope: crypto.randomUUID(), source: crypto.randomUUID(), revision: 1, digest: await digest('x') };
		const ref = await client.submit(Resolution, input, { scope: input.scope, key: 'pinned' });
		const registration = await store.register('new-build', [{ ...identity(Resolution), version: '2' }], CoreEngine.id, {
			activities: 1,
			activations: 1,
		}, 5000);
		expect(await store.activate(registration, [{ ...identity(Resolution), version: '2' }])).toBeUndefined();
		expect((await client.get(Resolution, ref)).reason).toBe('missing_version');
		expect(await sql`select * from utils_workflow.jobs where namespace=${store.namespace}`).toHaveLength(0);
	});

	it('a step that exceeds saved-data limits blocks before its activity runs', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const policy = workflow.PolicySchema.parse({ ...CorePolicy, limits: { ...CorePolicy.limits, historyBytes: 1 } });
		const client = workflow.client({ store, policy });
		const input = { scope: crypto.randomUUID(), source: crypto.randomUUID(), revision: 1, digest: await digest('x') };
		const ref = await client.submit(Resolution, input, { scope: input.scope, key: 'history' });
		const execution = host(namespace, '', 'node', { CORE_POLICY: JSON.stringify(policy) });
		try {
			await execution.ready();
			await until(async () => (await client.get(Resolution, ref)).reason === 'history_limit');
		} finally {
			await execution.close();
		}
		expect(await sql`select * from utils_workflow.jobs where namespace=${namespace}`).toHaveLength(0);
		const bounded = workflow.client({
			store,
			policy: { ...CorePolicy, limits: { ...CorePolicy.limits, inputBytes: 1 } },
		});
		await expect(bounded.submit(Parse, input, { scope: input.scope, key: 'payload' })).rejects.toMatchObject({
			code: 'payload_limit',
		});
	});

	it('completed results count toward saved-data limits without erasing accepted job evidence', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		const input = { scope: crypto.randomUUID(), source: crypto.randomUUID(), revision: 1, digest: await digest('x') };
		const intent = {
			path: '0:batch:0',
			fingerprint: 'bounded-outcome',
			type: 'activity' as const,
			definition: identity(Resolve),
			input: { kind: 'value' as const, value: { ...input, after: 0 } },
		};
		const limit = new TextEncoder().encode(JSON.stringify(intent)).byteLength;
		const policy = workflow.PolicySchema.parse({
			...CorePolicy,
			limits: { ...CorePolicy.limits, historyBytes: limit },
		});
		const client = workflow.client({ store, policy });
		const ref = await client.submit(Resolution, input, { scope: input.scope, key: 'outcome-limit' });
		const registration = await store.register('bounded', [identity(Resolution), identity(Resolve)], CoreEngine.id, {
			activities: 1,
			activations: 1,
		}, 5000);
		const activation = (await store.activate(registration, [identity(Resolution)]))!;
		await store.instruction(activation, intent);
		const job = (await store.take(registration, [identity(Resolve)]))!;
		await store.complete(job, {
			type: 'success',
			value: { kind: 'value', value: { status: 'current', after: 0, count: 0, complete: true } },
		}, 'permanent');
		const state = await client.get(Resolution, ref);
		expect(state.reason).toBe('history_limit');
		const instructions = await sql`select * from utils_workflow.instructions where namespace=${store.namespace}`;
		expect(instructions[0]!.bytes).toBe(limit);
		expect(instructions[0]!.outcome).toBeNull();
		const jobs = await sql`select * from utils_workflow.jobs where namespace=${store.namespace}`;
		expect(jobs[0]!.state).toBe('completed');
		expect(jobs[0]!.outcome.type).toBe('success');
		await expect(
			client.repair(ref, { actor: 'test', reason: 'cannot enlarge pinned budget', epoch: state.epoch, attempts: 1 }),
		).rejects.toMatchObject({ code: 'repair_policy' });
	});

	it('namespace and scope isolation apply to inspection, cancellation, and repair', async () => {
		await using a = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		await using b = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		const client = workflow.client({ store: a, policy: CorePolicy });
		const { ref } = await source(client);
		await expect(b.get(ref)).rejects.toMatchObject({ code: 'reference_conflict' });
		await expect(a.cancel({ ...ref, scope: 'another' }, 'forged')).rejects.toMatchObject({
			code: 'reference_conflict',
		});
		await expect(a.repair({ ...ref, scope: 'another' }, { actor: 'test', reason: 'forged', epoch: 1, attempts: 1 }))
			.rejects.toMatchObject({ code: 'reference_conflict' });
	});

	it('readiness requires database access and the receiver; shutdown waits for active cleanup', async () => {
		const namespace = crypto.randomUUID();
		const execution = host(namespace);
		try {
			const origin = await execution.ready();
			expect((await fetch(`${origin}/live`)).status).toBe(200);
			const response = await fetch(`${origin}/ready`);
			const ready = await response.json();
			expect(ready.host.ready).toBe(true);
			expect(ready.providerReady).toBe(true);
		} finally {
			await execution.close();
		}
	});

	it('SIGKILL inside a domain transaction rolls back rows and its unsaved receipt', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: CorePolicy });
		const first = host(namespace, 'core.rows.before-commit');
		let replacement: Child | undefined;
		try {
			await first.ready();
			const { input, ref } = await source(client);
			await first.event('core.rows.before-commit');
			await first.kill();
			await until(async () =>
				(await sql`select * from pg_stat_activity where datname=current_database() and state='idle in transaction'`)
					.length === 0
			);
			expect(await sql`select * from source_rows where scope=${input.scope}`).toHaveLength(0);
			expect(await sql`select * from utils_workflow.receipts where namespace=${namespace}`).toHaveLength(0);
			replacement = host(namespace);
			await replacement.ready();
			const result = await client.wait(Parse, ref, { signal: AbortSignal.timeout(15_000) });
			expect(result.rows).toBe(2);
		} finally {
			await first.close();
			await replacement?.close();
		}
	});

	it('a saved workflow step creates one job and rejects changed or missing steps during replay', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		// This test drives the store directly, without a worker renewal loop. Keep its permission valid through replay.
		const policy = workflow.PolicySchema.parse({ ...CorePolicy, claims: { ...CorePolicy.claims, leaseMs: 30_000 } });
		const client = workflow.client({ store, policy });
		const input = { scope: crypto.randomUUID(), source: crypto.randomUUID(), revision: 1, digest: await digest('x') };
		const ref = await client.submit(Resolution, input, { scope: input.scope, key: 'intent' });
		const registration = await store.register('activation', [identity(Resolution), identity(Resolve)], CoreEngine.id, {
			activities: 1,
			activations: 1,
		}, 30_000);
		const activation = (await store.activate(registration, [identity(Resolution)]))!;
		const intent = {
			path: '0:batch:0',
			fingerprint: await fingerprint({ input, after: 0 }),
			type: 'activity' as const,
			definition: identity(Resolve),
			input: { kind: 'value' as const, value: { ...input, after: 0 } },
		};
		expect(await store.instruction(activation, intent)).toBeUndefined();
		const first = (await store.take(registration, [identity(Resolve)]))!;
		await store.complete(first, {
			type: 'success',
			value: { kind: 'value', value: { status: 'current', after: 0, count: 0, complete: true } },
		}, 'permanent');
		const replay = (await store.activate(registration, [identity(Resolution)]))!;
		expect((await store.instruction(replay, intent))!.type).toBe('success');
		await expect(store.instruction(replay, { ...intent, fingerprint: 'changed' })).rejects.toMatchObject({
			code: 'replay_conflict',
		});
		await expect(store.finish(replay, { type: 'success', value: { kind: 'undefined' } }, 0)).rejects.toMatchObject({
			code: 'replay_conflict',
		});
		expect(await sql`select * from utils_workflow.jobs where namespace=${store.namespace} and run=${ref.id}`)
			.toHaveLength(1);
	});

	it('SIGTERM drains active cleanup before releasing borrowed clients', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: CorePolicy });
		const first = host(namespace, 'core.cleanup');
		let replacement: Child | undefined;
		try {
			const origin = await first.ready();
			const { ref } = await source(client);
			await first.event('core.cleanup');
			first.child.kill('SIGTERM');
			await until(async () => {
				const response = await fetch(`${origin}/ready`);
				await response.body?.cancel();
				return response.status === 503;
			});
			expect(first.child.exitCode).toBeNull();
			expect((await client.get(Parse, ref)).state).toBe('waiting');
			first.child.kill('SIGUSR1');
			const exit = await first.exited;
			expect(exit.code).toBe(0);
			replacement = host(namespace);
			await replacement.ready();
			await client.wait(Parse, ref, { signal: AbortSignal.timeout(15_000) });
		} finally {
			await first.close();
			await replacement?.close();
		}
	});

	it('readiness fails and recovers when schema compatibility or the required receiver is unavailable', async () => {
		const installed = (await sql`select version from utils_workflow.version where id`)[0]!.version as number;
		const execution = host(crypto.randomUUID());
		try {
			const origin = await execution.ready();
			await sql`update utils_workflow.version set version=${installed + 1} where id`;
			const incompatible = await fetch(`${origin}/ready`);
			await incompatible.body?.cancel();
			expect(incompatible.status).toBe(503);
			await sql`update utils_workflow.version set version=${installed} where id`;
			const port = provider.events.find((entry) => entry.event === 'listening')!.port;
			await provider.kill();
			const absent = await fetch(`${origin}/ready`);
			await absent.body?.cancel();
			expect(absent.status).toBe(503);
			cleanup.defer(async () => {
				for (const child of processes) child.kill('SIGKILL');
				await Promise.allSettled([...exits]);
			});
			provider = new Child('provider', { DATABASE_URL: url, PORT: String(port) });
			await provider.ready();
			await until(async () => {
				const response = await fetch(`${origin}/ready`);
				await response.body?.cancel();
				return response.status === 200;
			});
		} finally {
			await sql`update utils_workflow.version set version=${installed} where id`;
			await execution.close();
		}
	});

	it('Core rejects changed source bytes before creating rows or accounts', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: CorePolicy });
		const { input, ref } = await source(client);
		await sql`update sources set body='name\nChanged' where scope=${input.scope}`;
		const execution = host(namespace);
		try {
			await execution.ready();
			await expect(client.wait(Parse, ref, { signal: AbortSignal.timeout(15_000) })).rejects.toMatchObject({
				code: 'failed',
			});
			expect(await sql`select * from source_rows where scope=${input.scope}`).toHaveLength(0);
			expect(await sql`select * from accounts where scope=${input.scope}`).toHaveLength(0);
		} finally {
			await execution.close();
		}
	});

	it('Core checks mapping revision inside the guarded batch transaction', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: CorePolicy });
		const execution = host(namespace, 'core.batch.before-write');
		try {
			await execution.ready();
			const { input, ref } = await source(client);
			await execution.event('core.batch.before-write');
			await sql`update sources set revision=2 where scope=${input.scope}`;
			execution.child.kill('SIGUSR1');
			const parsed = await client.wait(Parse, ref, { signal: AbortSignal.timeout(15_000) });
			const resolved = await client.wait(Resolution, parsed.next!, { signal: AbortSignal.timeout(15_000) });
			expect(resolved.status).toBe('superseded');
			expect(await sql`select * from accounts where scope=${input.scope}`).toHaveLength(0);
			expect(await sql`select * from source_rows where scope=${input.scope}`).toHaveLength(2);
		} finally {
			await execution.close();
		}
	});

	it('a new Intelligence command retains recipient and contribution identity for the same research', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: IntelligencePolicy });
		const execution = host(namespace);
		try {
			await execution.ready();
			const { input, ref } = await research(client);
			const first = await client.wait(Acquire, ref, { signal: AbortSignal.timeout(15_000) });
			const again = await client.submit(Acquire, input, { scope: input.scope, key: 'explicit-new-command' });
			const second = await client.wait(Acquire, again, { signal: AbortSignal.timeout(15_000) });
			expect(again.id).not.toBe(ref.id);
			expect(second.commit).toBe(first.commit);
			expect(await sql`select * from captures where scope=${input.scope}`).toHaveLength(1);
			expect(await sql`select * from contributions where scope=${input.scope}`).toHaveLength(1);
		} finally {
			await execution.close();
		}
	});

	it('accepted independent expiry survives a crash before capture and parent cancellation', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: IntelligencePolicy });
		const first = host(namespace, 'intelligence.capture.before-call');
		let replacement: Child | undefined;
		try {
			await first.ready();
			const { input, ref } = await research(client, 3000);
			await first.event('intelligence.capture.before-call');
			expect(await sql`select * from utils_workflow.runs where namespace=${namespace} and definition=${Expire.id}`)
				.toHaveLength(1);
			await first.kill();
			await client.cancel(ref, 'request withdrawn');
			replacement = host(namespace);
			await replacement.ready();
			await until(async () => (await sql`select closed from research where scope=${input.scope}`)[0]!.closed);
			expect(await sql`select * from captures where scope=${input.scope}`).toHaveLength(0);
			expect((await client.get(Acquire, ref)).state).toBe('cancelled');
		} finally {
			await first.close();
			await replacement?.close();
		}
	});

	for (const boundary of ['intelligence.capture.before-call', 'intelligence.stage.before-write']) {
		it(`grant revocation at ${boundary} prevents subsequent publication`, async () => {
			const namespace = crypto.randomUUID();
			await using store = postgres.open({ database: sql, namespace });
			const client = workflow.client({ store, policy: IntelligencePolicy });
			const execution = host(namespace, boundary);
			try {
				await execution.ready();
				const { input, ref } = await research(client);
				await execution.event(boundary);
				await sql`update research set closed=true where scope=${input.scope}`;
				execution.child.kill('SIGUSR1');
				await expect(client.wait(Acquire, ref, { signal: AbortSignal.timeout(15_000) })).rejects.toMatchObject({
					code: 'failed',
				});
				expect(await sql`select * from contributions where scope=${input.scope}`).toHaveLength(0);
				if (boundary === 'intelligence.capture.before-call') {
					expect(await sql`select * from captures where scope=${input.scope}`).toHaveLength(0);
				}
			} finally {
				await execution.close();
			}
		});
	}

	it('missing raw bytes fail extraction without recapturing expired evidence', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: IntelligencePolicy });
		const execution = host(namespace, 'intelligence.extract.before-read');
		try {
			await execution.ready();
			const { input, ref } = await research(client);
			await execution.event('intelligence.extract.before-read');
			await sql`update captures set body=null where scope=${input.scope}`;
			execution.child.kill('SIGUSR1');
			await expect(client.wait(Acquire, ref, { signal: AbortSignal.timeout(15_000) })).rejects.toMatchObject({
				code: 'failed',
			});
			const captures = await sql`select * from captures where scope=${input.scope}`;
			expect(captures).toHaveLength(1);
			expect(captures[0]!.body).toBeNull();
			expect(await sql`select * from contributions where scope=${input.scope}`).toHaveLength(0);
		} finally {
			await execution.close();
		}
	});

	it('readiness stays false during assembly while liveness answers', async () => {
		const execution = host(crypto.randomUUID(), 'host.before-serve');
		try {
			const event = await execution.event('listening');
			await execution.event('host.before-serve');
			const origin = `http://127.0.0.1:${event.port}`;
			for (const [path, expected] of [['ready', 503], ['live', 200]] as const) {
				const response = await fetch(`${origin}/${path}`);
				await response.body?.cancel();
				expect(response.status).toBe(expected);
			}
			execution.child.kill('SIGUSR1');
			await execution.ready();
		} finally {
			await execution.close();
		}
	});

	it('a drain deadline reports active cleanup truthfully until hard process death', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: CorePolicy });
		const first = host(namespace, 'core.cleanup', 'node', { DRAIN_MS: '100' });
		let replacement: Child | undefined;
		try {
			const origin = await first.ready();
			const { ref } = await source(client);
			await first.event('core.cleanup');
			first.child.kill('SIGTERM');
			const event = await first.event('drain');
			expect(event.code).toBe('drain_timeout');
			expect(event.state).toMatchObject({ phase: 'draining', active: 1 });
			const response = await fetch(`${origin}/ready`);
			await response.body?.cancel();
			expect(response.status).toBe(503);
			expect(first.child.exitCode).toBeNull();
			await first.kill();
			replacement = host(namespace);
			await replacement.ready();
			await client.wait(Parse, ref, { signal: AbortSignal.timeout(15_000) });
		} finally {
			await first.close();
			await replacement?.close();
		}
	});

	it('split workers still reject a wrong engine, missing local resources, and a different local definition', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		await using ctx = context.create({ id: 'local-bindings' });
		await using resources = resource.create(resource.implementations(), { ctx, host: {} });
		const options: workflow.ServeOptions = {
			store,
			policies: [CorePolicy],
			engine: CoreEngine,
			workflows: [],
			activities: [{ definition: Resolve, async invoke() {} }],
			resources,
			capacity: { activations: 1, activities: 1, control: 1, finalizers: 1 },
			hostId: 'invalid-local',
			shutdown: new AbortController().signal,
		};
		await expect(workflow.serve({ ...options, engine: { ...CoreEngine, id: 'wrong' } }))
			.rejects.toMatchObject({ code: 'engine_binding' });
		await expect(workflow.serve(options)).rejects.toMatchObject({ code: 'resource_binding' });
		await expect(workflow.serve({
			...options,
			workflows: [ResolutionLive],
			activities: [{ definition: { ...Resolve, resources: [] }, async invoke() {} }],
		})).rejects.toMatchObject({ code: 'activity_binding' });
		expect(await sql`select id from utils_workflow.hosts where namespace=${store.namespace}`).toHaveLength(0);
	});

	it('a worker rejects conflicting retry rules before registering', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		await using ctx = context.create({ id: 'compatibility' });
		await using resources = resource.create(resource.implementations(), { ctx, host: {} });
		const definition = {
			...Parse,
			resources: [],
			resilience: [{ kind: 'resilience' as const, type: 'timeout' as const, duration: Temporal.Duration.from('PT1S') }],
		};
		const policy = workflow.PolicySchema.parse({
			...CorePolicy,
			activities: [CorePolicy.activities.find((entry) => entry.definition.id === Parse.id)!],
			workflows: [],
			successors: [],
			finalizers: [],
		});
		await expect(
			workflow.serve({
				store,
				policies: [policy],
				engine: CoreEngine,
				workflows: [],
				activities: [{ definition, async invoke() {} }],
				resources,
				capacity: { activations: 1, activities: 1, control: 1, finalizers: 1 },
				hostId: 'incompatible',
				shutdown: new AbortController().signal,
			}),
		).rejects.toMatchObject({ code: 'resilience_binding' });
		expect(await sql`select * from utils_workflow.hosts where namespace=${store.namespace}`).toHaveLength(0);
	});

	it('a worker blocks an unconfigured saved policy before application code runs', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const policy = workflow.PolicySchema.parse({ ...CorePolicy, version: 'unregistered' });
		const client = workflow.client({ store, policy });
		const { input, ref } = await source(client);
		const execution = host(namespace);
		try {
			await execution.ready();
			await until(async () => (await client.get(Parse, ref)).state === 'blocked');
			expect(await sql`select * from source_rows where scope=${input.scope}`).toHaveLength(0);
		} finally {
			await execution.close();
		}
	});

	it('a deferred raw deletion receipt survives process loss and reconstructs its next timer', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: IntelligencePolicy });
		const first = host(namespace, 'intelligence.expiry.committed');
		let replacement: Child | undefined;
		try {
			await first.ready();
			const { input, ref } = await research(client, 20_000);
			await client.wait(Acquire, ref, { signal: AbortSignal.timeout(15_000) });
			// A raw owner holds the same row as Delete and records a last accepted write just before expiry.
			await sql.begin(async (tx) => {
				await tx`select id from research where scope=${input.scope} for update`;
				await until(
					async () =>
						(await tx`select clock_timestamp() >= ${input.expiresAt}::timestamptz - interval '20 milliseconds' as due`)[
							0
						]!.due,
					30_000,
				);
				await tx`update research set latest_at=clock_timestamp() where scope=${input.scope}`;
			});
			const event = await first.event('intelligence.expiry.committed');
			expect(event.deleted).toBe(0);
			expect((await sql`select body from captures where scope=${input.scope}`)[0]!.body).not.toBeNull();
			await first.kill();
			replacement = host(namespace);
			await replacement.ready();
			await until(async () => (await sql`select closed from research where scope=${input.scope}`)[0]!.closed);
			expect((await sql`select body from captures where scope=${input.scope}`)[0]!.body).toBeNull();
			expect(await sql`select * from utils_workflow.instructions where namespace=${namespace} and type='sleep-until'`)
				.toHaveLength(2);
			expect(await sql`select * from contributions where scope=${input.scope} and commit is not null`).toHaveLength(1);
		} finally {
			await first.close();
			await replacement?.close();
		}
	});

	it('reserved finalizer capacity progresses while both ordinary activity slots are held in cleanup', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const client = workflow.client({ store, policy: CorePolicy });
		const execution = host(namespace, 'core.cleanup', 'node', { PAUSE_ALL: '1' });
		try {
			await execution.ready();
			const first = await source(client);
			const second = await source(client);
			await until(async () => execution.events.filter((entry) => entry.name === 'core.cleanup').length === 2);
			const third = await source(client);
			await client.cancel(third.ref, 'withdraw pending import');
			await until(async () => (await client.get(Parse, third.ref)).state === 'cancelled');
			expect(await sql`select * from exits where run=${third.ref.id}`).toHaveLength(1);
			expect((await client.get(Parse, first.ref)).state).toBe('waiting');
			expect((await client.get(Parse, second.ref)).state).toBe('waiting');
			execution.child.kill('SIGUSR1');
			await client.wait(Parse, first.ref, { signal: AbortSignal.timeout(15_000) });
			await client.wait(Parse, second.ref, { signal: AbortSignal.timeout(15_000) });
		} finally {
			execution.child.kill('SIGUSR1');
			await execution.close();
		}
	});

	it('readiness requires a successful recovery scan after database access returns', async () => {
		const execution = host(crypto.randomUUID());
		try {
			const origin = await execution.ready();
			await sql`alter schema utils_workflow rename to utils_workflow_outage`;
			await until(async () => {
				const response = await fetch(`${origin}/ready`);
				const snapshot = await response.json();
				return response.status === 503 && snapshot.host.reasons.includes('loop_fault');
			});
			await sql`alter schema utils_workflow_outage rename to utils_workflow`;
			await execution.ready();
		} finally {
			const missing = await sql`select 1 from pg_namespace where nspname='utils_workflow_outage'`;
			if (missing.length) await sql`alter schema utils_workflow_outage rename to utils_workflow`;
			await execution.close();
		}
	});

	it('readiness ends at its deadline while a registration renewal is still blocked on a database lock', async () => {
		const namespace = crypto.randomUUID();
		const execution = host(namespace, '', 'node', { LOCK_MS: '3000' });
		try {
			const origin = await execution.ready();
			await sql.begin(async (tx) => {
				await tx`select id from utils_workflow.hosts where namespace=${namespace} for update`;
				const response = await fetch(`${origin}/ready`, { signal: AbortSignal.timeout(1800) });
				const snapshot = await response.json();
				expect(response.status).toBe(503);
				expect(snapshot.host.reasons).toContain('authority_unavailable');
				expect(
					await tx`select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%utils_workflow.hosts%'`,
				).not.toHaveLength(0);
			});
			await execution.ready();
		} finally {
			await execution.close();
		}
	});

	it('rejects an incomplete current schema without silently repairing it during migration', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		await sql`alter table utils_workflow.runs drop column trace`;
		try {
			await expect(store.check()).rejects.toMatchObject({ code: 'schema_version' });
			await postgres.migrate({ database: sql });
			await expect(store.check()).rejects.toMatchObject({ code: 'schema_version' });
		} finally {
			// Current-version migrate deliberately performs no DDL. The test owns
			// this artificial corruption and must repair it before other checks.
			await sql`alter table utils_workflow.runs add column trace jsonb`;
		}
		await store.check();
	});

	it('encoding normalizes object order and negative zero and rejects live or cyclic values', async () => {
		expect(await fingerprint({ b: 1, a: -0 })).toBe(await fingerprint({ a: 0, b: 1 }));
		await expect(fingerprint(new Date())).rejects.toThrow();
		await expect(fingerprint({
			get value() {
				throw new Error('must not read');
			},
		})).rejects.toThrow();
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		await expect(fingerprint(cyclic)).rejects.toThrow();
	});
});
