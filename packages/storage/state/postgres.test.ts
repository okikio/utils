import { after, before, describe, it } from 'node:test';
import { expect } from '@std/expect';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import postgresjs from 'postgres';
import type { ReservedSql, Sql } from 'postgres';
import { AsyncDisposableStack, asyncDispose } from '@okikio/dispose';
import * as state from '@okikio/context/state';
import * as schema from '@okikio/schema';
import * as adapter from './postgres.ts';

const url = process.env.UTILS_TEST_DATABASE_URL;
let database: Sql;
const namespaces: string[] = [];

/** Each case owns its namespace while borrowing the disposable suite database and selected driver pool. */
function fixture(selected: Sql = database) {
	const namespace = 'state-test-' + crypto.randomUUID();
	namespaces.push(namespace);
	const configuration = { database: selected, namespace, key: 'cursor' };
	return { namespace, configuration, store: adapter.open(configuration) };
}

/** Pause after real driver acknowledgements without replacing SQL, transaction commands or physical session ownership. */
function sessions(
	database: Sql,
	visit: (statement: string) => void | Promise<void>,
	onRelease: () => void = () => {},
): Sql {
	return new Proxy(database, {
		get(target, key, receiver) {
			if (key !== 'reserve') return Reflect.get(target, key, receiver);
			return async (): Promise<ReservedSql> => {
				const connection = await target.reserve();
				return new Proxy(connection, {
					get(target, key, receiver) {
						if (key === 'unsafe') {
							return async (...arguments_: unknown[]) => {
								const result: unknown = await Reflect.apply(target.unsafe, target, arguments_);
								await visit(String(arguments_[0]));
								return result;
							};
						}
						if (key === 'release') {
							return () => {
								onRelease();
								return target.release();
							};
						}
						return Reflect.get(target, key, receiver);
					},
				});
			};
		},
	});
}

/** A fresh process owns its pool and exits after one explicit write or reopen, proving no module memory supplies state. */
async function child(action: 'write' | 'read', namespace: string): Promise<unknown> {
	const process_ = spawn(process.execPath, [
		'--import',
		fileURLToPath(import.meta.resolve('@okikio/duration/polyfill')),
		'--import',
		fileURLToPath(import.meta.resolve('@okikio/dispose/polyfill')),
		fileURLToPath(new URL('./fixtures/reopen.ts', import.meta.url)),
		action,
		namespace,
	], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
	let output = '', error = '';
	process_.stdout.setEncoding('utf8').on('data', (value: string) => {
		output += value;
	});
	process_.stderr.setEncoding('utf8').on('data', (value: string) => {
		error += value;
	});
	const code = await new Promise<number | null>((resolve, reject) => {
		process_.once('error', reject);
		process_.once('close', resolve);
	});
	if (code !== 0) throw new Error(`State restart fixture failed (${code}): ${error}`);
	return JSON.parse(output);
}

describe('PostgreSQL state slots', { skip: url === undefined, concurrency: false }, () => {
	before(async () => {
		database = postgresjs(url!, { max: 12, onnotice() {} });
		await adapter.migrate({ database });
	});

	after(async () => {
		if (database === undefined) return;
		try {
			for (const namespace of namespaces) {
				await database.unsafe('delete from utils_state.snapshots where namespace=$1', [namespace]);
			}
		} finally {
			await database.end({ timeout: 2 });
		}
	});

	it('commits a contract migration before publishing and reopens it through an independent borrowed connection', async () => {
		const first = fixture();
		const peer = postgresjs(url!, { max: 2, onnotice() {} });
		try {
			const OldSchema = schema.object({ count: schema.number() });
			const CurrentSchema = schema.object({ total: schema.number() });
			{
				await using _seeded = await state.open({
					store: first.store,
					contract: 'v1',
					value: OldSchema,
					initial: () => ({ count: 2 }),
				});
			}
			let conversions = 0;
			const migration = state.migration('v1', OldSchema, (old) => {
				conversions++;
				return { total: old.count + 1 };
			});
			await using migrated = await state.open({
				store: first.store,
				contract: 'v2',
				value: CurrentSchema,
				migrations: [migration],
			});
			expect(migrated.reader.get()).toEqual({ total: 3 });
			expect(conversions).toBe(1);
			const second = adapter.open({ ...first.configuration, database: peer });
			expect((await second.load())?.contract).toBe('v2');
			await using reopened = await state.open({ store: second, contract: 'v2', value: CurrentSchema });
			expect(reopened.reader.get()).toEqual({ total: 3 });
			expect(reopened.version).toBe(migrated.version);
			expect((await peer`select 1 as alive`)[0]!.alive).toBe(1);
		} finally {
			await peer.end({ timeout: 2 });
		}
	});

	it('migrates concurrently, rejects unknown revisions and diagnoses a missing snapshot table', async () => {
		await Promise.all([adapter.migrate({ database }), adapter.migrate({ database })]);
		await database.unsafe('update utils_state.version set revision=999 where id');
		try {
			await expect(adapter.migrate({ database })).rejects.toThrow('Unsupported');
		} finally {
			await database.unsafe('update utils_state.version set revision=1 where id');
		}
		await database.unsafe('alter table utils_state.snapshots rename to snapshots_fixture_hidden');
		try {
			await expect(adapter.migrate({ database })).rejects.toThrow('snapshots table is missing');
		} finally {
			await database.unsafe('alter table utils_state.snapshots_fixture_hidden rename to snapshots');
		}
		await adapter.migrate({ database });
	});

	it('arbitrates competing initial creation and version-checked updates across independent cells', async () => {
		const { store, configuration, namespace } = fixture();
		await using owners = new AsyncDisposableStack();
		let initial = 0;
		const opened = await Promise.all(Array.from({ length: 12 }, () =>
			state.open({
				store: adapter.open(configuration),
				contract: 'count.v1',
				value: schema.number(),
				initial: () => ++initial,
			})));
		for (const cell of opened) owners.use(cell);
		expect(new Set(opened.map((cell) => cell.version)).size).toBe(1);
		expect(new Set(opened.map((cell) => cell.reader.get())).size).toBe(1);
		const results = await Promise.allSettled(opened.map((cell) => cell.update((value) => value + 1)));
		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		for (const result of results) {
			if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(state.ConflictError);
		}
		const saved = await store.load();
		for (const cell of opened) {
			await cell.reload();
			expect(cell.version).toBe(saved!.version);
			expect(cell.reader.get()).toBe(saved!.value);
		}
		const rows = await database.unsafe(
			'select count(*)::integer as count from utils_state.snapshots where namespace=$1',
			[namespace],
		);
		expect(rows[0]?.count).toBe(1);
	});

	it('reopens the encoded Date and cursor in a fresh native process', async () => {
		const { namespace } = fixture();
		const created = await child('write', namespace);
		const restored = await child('read', namespace);
		expect(restored).toEqual(created);
		expect(restored).toMatchObject({ cursor: 'page-2', at: '2026-11-01T00:00:00.000Z', date: true });
	});

	it('captures the candidate and expected version before an awaited database transaction begins', async () => {
		const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
		let armed = false;
		const observed = sessions(database, async (statement) => {
			if (armed && statement.startsWith('begin')) {
				entered.resolve();
				await release.promise;
			}
		});
		const { store, configuration } = fixture(observed);
		const first = state.SnapshotSchema.parse({ format: 1, contract: 'count.v1', version: 'first', value: 1 });
		await store.save(first, { expectedVersion: undefined });
		const candidate = state.SnapshotSchema.parse({ ...first, version: 'second', value: 2 });
		const options = { expectedVersion: 'first', signal: new AbortController().signal };
		armed = true;
		const pending = store.save(candidate, options);
		try {
			await entered.promise;
			candidate.version = 'mutated';
			candidate.value = 99;
			options.expectedVersion = 'missing';
			options.signal = AbortSignal.abort('replaced option');
		} finally {
			release.resolve();
		}
		expect(await pending).toBe(true);
		expect(await adapter.open({ ...configuration, database }).load()).toEqual({
			...first,
			version: 'second',
			value: 2,
		});
	});

	it('rolls back a cancellation observed after UPDATE and leaves the borrowed pool usable', async () => {
		const controller = new AbortController();
		let armed = false, releases = 0;
		const observed = sessions(database, (statement) => {
			if (armed && statement.startsWith('update utils_state.snapshots')) controller.abort('stop before commit');
		}, () => {
			releases++;
		});
		const { store } = fixture(observed);
		await using cell = await state.open({ store, contract: 'count.v1', value: schema.number(), initial: () => 1 });
		const original = cell.version;
		armed = true;
		const error: unknown = await cell.set(2, { signal: controller.signal }).catch((error: unknown) => error);
		expect(error).toBeInstanceOf(state.CommitError);
		expect((error as state.CommitError).cause).toBe('stop before commit');
		expect(cell.reader.get()).toBe(1);
		expect((await store.load())?.version).toBe(original);
		await cell.reload();
		expect(cell.needsReload).toBe(false);
		expect(releases).toBe(5);
		expect((await database.unsafe('select 1 as value'))[0]?.value).toBe(1);
	});

	it('joins a database commit that outlives disposal and does not publish its late acknowledgement', async () => {
		const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
		let armed = false, releases = 0;
		const observed = sessions(database, async (statement) => {
			if (armed && statement === 'commit') {
				entered.resolve();
				await release.promise;
			}
		}, () => {
			releases++;
		});
		const { store, configuration } = fixture(observed);
		const cell = await state.open({ store, contract: 'count.v1', value: schema.number(), initial: () => 1 });
		const changes: number[] = [];
		using observedChanges = cell.reader.subscribe(({ value }) => changes.push(value));
		armed = true;
		const pending = cell.set(2);
		const failed = pending.catch((error: unknown) => error);
		await entered.promise;
		try {
			let closed = false;
			const closing = cell[asyncDispose]();
			void closing.then(() => {
				closed = true;
			});
			expect(cell[asyncDispose]()).toBe(closing);
			expect(observedChanges.closed).toBe(true);
			expect(closed).toBe(false);
			// A separate real session can already read the commit while its local acknowledgement is held.
			const independent = adapter.open({ ...configuration, database });
			expect((await independent.load())?.value).toBe(2);
			release.resolve();
			const error = await failed;
			await closing;
			expect(error).toBeInstanceOf(state.CommitError);
			expect((error as state.CommitError).outcome).toBe('committed');
			expect(changes).toEqual([]);
			expect(cell.reader.get()).toBe(1);
			expect(releases).toBe(3);
			expect((await database.unsafe('select 1 as value'))[0]?.value).toBe(1);
		} finally {
			release.resolve();
			await failed;
			await cell[asyncDispose]();
		}
	});

	it('times out an owned statement, preserves state and releases its reserved session after rollback', async () => {
		const { store, configuration } = fixture();
		await using cell = await state.open({
			store: adapter.open({ ...configuration, statementTimeoutMilliseconds: 25 }),
			contract: 'count.v1',
			value: schema.number(),
			initial: () => 1,
		});
		const locker = await database.reserve();
		try {
			await locker.unsafe('begin');
			await locker.unsafe('select key from utils_state.snapshots where namespace=$1 and key=$2 for update', [
				configuration.namespace,
				configuration.key,
			]);
			const error: unknown = await cell.set(2).catch((error: unknown) => error);
			expect(error).toBeInstanceOf(state.CommitError);
			expect((error as state.CommitError).cause).toMatchObject({ code: '57014' });
			expect(cell.reader.get()).toBe(1);
		} finally {
			await locker.unsafe('rollback');
			locker.release();
		}
		expect((await store.load())?.value).toBe(1);
		await cell.reload();
		await cell.set(3);
		expect((await store.load())?.value).toBe(3);
	});

	it('isolates keys and partitions, rejects incompatible data and validates Unicode identities before reserving', async () => {
		const { store, configuration, namespace } = fixture();
		await using cell = await state.open({ store, contract: 'count.v1', value: schema.number(), initial: () => 1 });
		expect(await adapter.open({ ...configuration, key: 'other' }).load()).toBe(undefined);
		expect(await adapter.open({ ...configuration, namespace: namespace + '-other' }).load()).toBe(undefined);
		await expect(state.open({ store, contract: 'count.v2', value: schema.number(), initial: () => 2 })).rejects.toThrow(
			'contract',
		);
		const invalid = state.SnapshotSchema.parse({
			format: 1,
			contract: 'count.v1',
			version: 'external',
			value: 'not a number',
		});
		await database.unsafe('update utils_state.snapshots set snapshot=$2::jsonb where namespace=$1', [
			namespace,
			database.json(invalid),
		]);
		await expect(cell.reload()).rejects.toBeInstanceOf(Error);
		expect(cell.reader.get()).toBe(1);
		expect(() => adapter.open({ ...configuration, namespace: '🧭'.repeat(128), key: '🧭'.repeat(512) })).not.toThrow();
		expect(() => adapter.open({ ...configuration, namespace: '🧭'.repeat(129) })).toThrow(TypeError);
		expect(() => adapter.open({ ...configuration, key: ' ' })).toThrow(TypeError);
	});
});
