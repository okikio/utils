import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as state from '@okikio/context/state';
import * as schema from '@okikio/schema';
import * as web from './web.ts';

/** Retain exact host text so each test can emulate restart and deliberate external corruption. */
function storage() {
	const values = new Map<string, string>();
	return {
		values,
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
	};
}

describe('Web Storage state slots', () => {
	it('reopens supplied storage without globals, keeps keys isolated and reports stale versions', async () => {
		const host = storage();
		const first = web.open({ storage: host, key: 'draft', mode: 'single-writer' });
		expect(first.concurrency).toBe('single-writer');
		await using owner = await state.open({
			store: first,
			contract: 'draft.v1',
			value: schema.string(),
			initial: () => '',
		});
		await owner.set('saved');
		await using next = await state.open({
			store: web.open({ storage: host, key: 'draft', mode: 'single-writer' }),
			contract: 'draft.v1',
			value: schema.string(),
		});
		expect(next.reader.get()).toBe('saved');
		expect(await web.open({ storage: host, key: 'other', mode: 'single-writer' }).load()).toBe(undefined);
		await owner.set('newer');
		await expect(next.set('stale')).rejects.toBeInstanceOf(state.ConflictError);
		await next.reload();
		expect(next.reader.get()).toBe('newer');
		expect(host.values.size).toBe(1);
	});

	it('rejects malformed or future data without overwriting it and propagates host failures', async () => {
		const host = storage();
		const store = web.open({ storage: host, key: 'draft', mode: 'single-writer' });
		for (const invalid of ['{', '{"format":2,"contract":"draft.v1","version":"v1","value":"old"}']) {
			host.values.set('draft', invalid);
			await expect(state.open({ store, contract: 'draft.v1', value: schema.string(), initial: () => 'overwrite' }))
				.rejects.toBeInstanceOf(Error);
			expect(host.values.get('draft')).toBe(invalid);
		}
		host.values.clear();
		await using cell = await state.open({
			store,
			contract: 'draft.v1',
			value: schema.string(),
			initial: () => 'first',
		});
		const previous = host.values.get('draft');
		const failure = new DOMException('Storage is full.', 'QuotaExceededError');
		host.setItem = () => {
			throw failure;
		};
		const error: unknown = await cell.set('second').catch((error: unknown) => error);
		expect(error).toBeInstanceOf(state.CommitError);
		expect((error as state.CommitError).cause).toBe(failure);
		expect(cell.reader.get()).toBe('first');
		expect(cell.needsReload).toBe(true);
		expect(host.values.get('draft')).toBe(previous);
		await cell.reload();
		expect(cell.needsReload).toBe(false);
	});

	it('never treats an asynchronous setItem mock as a committed synchronous write', async () => {
		const host: web.WebStorage = {
			getItem: () => null,
			setItem: async () => {
				throw new Error('late mock failure');
			},
		};
		const store = web.open({ storage: host, key: 'draft', mode: 'single-writer' });
		const pending = state.open({ store, contract: 'draft.v1', value: schema.string(), initial: () => 'first' });
		const error: unknown = await pending.catch((error: unknown) => error);
		expect(error).toBeInstanceOf(state.CommitError);
		expect((error as state.CommitError).outcome).toBe('unknown');
		expect((error as state.CommitError).cause).toBeInstanceOf(TypeError);
		await Promise.resolve();
	});

	it('keeps the synchronous check and replacement inside the supplied exclusive lock', async () => {
		const host = storage();
		let held = false, calls = 0;
		const names: string[] = [];
		const locks: web.Locks = {
			async request(name, options, callback) {
				expect(held).toBe(false);
				expect(options.mode).toBe('exclusive');
				names.push(name);
				held = true;
				try {
					return await callback();
				} finally {
					held = false;
				}
			},
		};
		const checked: web.WebStorage = {
			getItem(key) {
				expect(held).toBe(true);
				calls++;
				return host.getItem(key);
			},
			setItem(key, value) {
				expect(held).toBe(true);
				calls++;
				host.setItem(key, value);
			},
		};
		const store = web.open({ storage: checked, key: 'draft', mode: 'locked', locks, lockName: 'shared-draft' });
		expect(store.concurrency).toBe('atomic');
		await using cell = await state.open({ store, contract: 'draft.v1', value: schema.number(), initial: () => 1 });
		await cell.set(2);
		expect(names).toEqual(['shared-draft', 'shared-draft', 'shared-draft']);
		expect(calls).toBe(5);
		const before = calls;
		await expect(store.load({ signal: AbortSignal.abort('stop') })).rejects.toBe('stop');
		expect(calls).toBe(before);
	});

	it('captures a candidate and its expected version before waiting for a supplied lock', async () => {
		const host = storage();
		const slot = web.open({ storage: host, key: 'draft', mode: 'single-writer' });
		const first = state.SnapshotSchema.parse({ format: 1, contract: 'draft.v1', version: 'first', value: 1 });
		await slot.save(first, { expectedVersion: undefined });
		const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
		const locks: web.Locks = {
			request: async (_name, _options, callback) => {
				entered.resolve();
				await release.promise;
				return await callback();
			},
		};
		const store = web.open({ storage: host, key: 'draft', mode: 'locked', locks });
		const candidate = state.SnapshotSchema.parse({ ...first, version: 'second', value: 2 });
		const options = { expectedVersion: 'first', signal: new AbortController().signal };
		const pending = store.save(candidate, options);
		await entered.promise;
		candidate.version = 'mutated';
		candidate.value = 99;
		options.expectedVersion = 'missing';
		options.signal = AbortSignal.abort('replaced option');
		release.resolve();
		expect(await pending).toBe(true);
		expect(await slot.load()).toEqual({ ...first, version: 'second', value: 2 });
	});

	it('bounds Unicode identity text and requires an explicit coordination mode before host access', () => {
		const host = storage();
		expect(() => web.open({ storage: host, key: '🧭'.repeat(512), mode: 'single-writer' })).not.toThrow();
		expect(() => web.open({ storage: host, key: '🧭'.repeat(513), mode: 'single-writer' })).toThrow(TypeError);
		expect(() => web.open({ storage: host, key: ' ', mode: 'single-writer' })).toThrow(TypeError);
		// Untyped JavaScript must make the same explicit coordination choice as typed callers.
		expect(() => web.open({ storage: host, key: 'draft' } as unknown as web.Options)).toThrow(TypeError);
		expect(() => web.open({ storage: host, key: 'draft', mode: 'locked' } as unknown as web.Options)).toThrow(
			TypeError,
		);
		expect(() =>
			web.open({
				storage: host,
				key: 'draft',
				mode: 'locked',
				lockName: '-reserved',
				locks: { request: async (_name, _options, callback) => await callback() },
			})
		).toThrow(TypeError);
		expect(host.values.size).toBe(0);
	});
});
