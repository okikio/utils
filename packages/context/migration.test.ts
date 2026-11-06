import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as stores from '@okikio/storage/state';
import * as schema from '@okikio/schema';
import * as state from './state.ts';
const OldSchema = schema.object({ count: schema.number() });
const CurrentSchema = schema.object({ total: schema.number() });
/** Seed through the actual selected memory adapter, not a second imitation of its CAS semantics. */
async function legacy(): Promise<state.Store> {
	const store = stores.memory();
	await using _cell = await state.open({ store, contract: 'v1', value: OldSchema, initial: () => ({ count: 2 }) });
	return store;
}
describe('save-before-publication state migration', () => {
	it('validates old state and commits a current envelope before returning a reader', async () => {
		const store = await legacy();
		const before = await store.load();
		let calls = 0;
		const convert = state.migration('v1', OldSchema, (old) => {
			calls++;
			return { total: old.count + 1 };
		});
		await using cell = await state.open({ store, contract: 'v2', value: CurrentSchema, migrations: [convert] });
		expect(cell.reader.get()).toEqual({ total: 3 });
		expect(calls).toBe(1);
		const saved = await store.load();
		expect(saved?.contract).toBe('v2');
		expect(saved?.version).toBe(cell.version);
		expect(saved?.version).not.toBe(before?.version);
		await using reopened = await state.open({ store, contract: 'v2', value: CurrentSchema });
		expect(reopened.reader.get()).toEqual({ total: 3 });
	});
	it('leaves old storage unchanged when conversion or current validation fails', async () => {
		const store = await legacy();
		const before = await store.load();
		const defect = new Error('conversion');
		await expect(
			state.open({
				store,
				contract: 'v2',
				value: CurrentSchema,
				migrations: [state.migration('v1', OldSchema, () => {
					throw defect;
				})],
			}),
		).rejects.toBe(defect);
		expect(await store.load()).toEqual(before);
		await expect(
			state.open({
				store,
				contract: 'v2',
				value: CurrentSchema,
				migrations: [state.migration('v1', OldSchema, () => ({ total: NaN }))],
			}),
		).rejects.toThrow();
		expect(await store.load()).toEqual(before);
	});
	it('fences concurrent migrations without replaying either conversion', async () => {
		const store = await legacy();
		let calls = 0;
		const ready = Promise.withResolvers<void>();
		const convert = state.migration('v1', OldSchema, async (old) => {
			if (++calls === 2) ready.resolve();
			await ready.promise;
			return { total: old.count };
		});
		const options = { store, contract: 'v2', value: CurrentSchema, migrations: [convert] };
		const results = await Promise.allSettled([state.open(options), state.open(options)]);
		expect(calls).toBe(2);
		expect(results.filter((result) => result.status === 'fulfilled').length).toBe(1);
		for (const result of results) {
			if (result.status === 'fulfilled') await result.value[Symbol.asyncDispose]();
			else expect(result.reason).toBeInstanceOf(state.ConflictError);
		}
	});
	it('holds uncertain migration results until explicit reload reconciles the acknowledged version', async () => {
		const backing = await legacy();
		let saves = 0;
		const store: state.Store = {
			concurrency: 'atomic',
			load: (options) => backing.load(options),
			async save(snapshot, options) {
				const accepted = await backing.save(snapshot, options);
				if (++saves === 1) throw new Error('acknowledgement lost');
				return accepted;
			},
		};
		const options = {
			store,
			contract: 'v2',
			value: CurrentSchema,
			migrations: [state.migration('v1', OldSchema, (old) => ({ total: old.count }))],
		};
		await expect(state.open(options)).rejects.toBeInstanceOf(state.CommitError);
		await using restored = await state.open(options);
		expect(restored.reader.get()).toEqual({ total: 2 });
		expect(saves).toBe(1);
		// Another writer restores an old representation; reload uses the same migration path without updater replay.
		const current = await backing.load();
		await backing.save({ format: 1, contract: 'v1', version: 'external-version', value: { count: 5 } }, {
			expectedVersion: current?.version,
		});
		await restored.reload();
		expect(restored.reader.get()).toEqual({ total: 5 });
		expect((await backing.load())?.contract).toBe('v2');
	});
});
