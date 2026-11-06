import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { SnapshotSchema } from '@okikio/context/state';
import * as state from '@okikio/context/state';
import * as schema from '@okikio/schema';
import { memory } from './mod.ts';

/** Give each attempted replacement a distinct token while preserving a small recognizable payload. */
function snapshot(version: string, count: number) {
	return SnapshotSchema.parse({ format: 1, contract: 'count.v1', version, value: { count } });
}

describe('memory state slots', () => {
	it('detaches saved and loaded envelopes and retains only the latest accepted replacement', async () => {
		const slot = memory(), other = memory();
		expect(slot.concurrency).toBe('atomic');
		const initial = snapshot('first', 1);
		expect(await slot.save(initial, { expectedVersion: undefined })).toBe(true);
		initial.value = { count: 99 };
		const loaded = (await slot.load())!;
		loaded.value = { count: 88 };
		expect(await slot.load()).toEqual(snapshot('first', 1));
		expect(await other.load()).toBe(undefined);
		expect(await slot.save(snapshot('second', 2), { expectedVersion: 'first' })).toBe(true);
		expect(await slot.save(snapshot('stale', 3), { expectedVersion: 'first' })).toBe(false);
		expect(await slot.save(snapshot('initial-loser', 4), { expectedVersion: undefined })).toBe(false);
		expect(await slot.load()).toEqual(snapshot('second', 2));
		await expect(slot.save(snapshot('second', 5), { expectedVersion: 'second' })).rejects.toBeInstanceOf(TypeError);
	});

	it('makes exactly one concurrent conditional replacement and does no work for pre-aborted calls', async () => {
		const slot = memory();
		await slot.save(snapshot('first', 0), { expectedVersion: undefined });
		const results = await Promise.all(Array.from({ length: 20 }, (_, index) => {
			return slot.save(snapshot('candidate-' + index, index), { expectedVersion: 'first' });
		}));
		expect(results.filter(Boolean)).toHaveLength(1);
		const before = await slot.load();
		const signal = AbortSignal.abort(null);
		await expect(slot.load({ signal })).rejects.toBe(null);
		await expect(slot.save(snapshot('canceled', 21), { expectedVersion: before!.version, signal })).rejects.toBe(null);
		expect(await slot.load()).toEqual(before);
	});

	it('uses the shared Unicode representation contract when opening and reading snapshots', async () => {
		const slot = memory();
		const contract = '🧭'.repeat(256);
		await using _first = await state.open({ store: slot, contract, value: schema.number(), initial: () => 1 });
		await using second = await state.open({ store: slot, contract, value: schema.number() });
		expect(second.reader.get()).toBe(1);
		await expect(state.open({ store: memory(), contract: contract + 'x', value: schema.number(), initial: () => 0 }))
			.rejects.toBeInstanceOf(Error);
		await expect(state.open({ store: memory(), contract: '  ', value: schema.number(), initial: () => 0 }))
			.rejects.toBeInstanceOf(Error);
	});
});
