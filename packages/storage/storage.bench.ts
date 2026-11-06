import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
/** In-memory conditional snapshots include detached copies; no persistence or database throughput is implied. */
import { memory } from './state/mod.ts';
import { SnapshotSchema } from '@okikio/context/state';
for (const count of [1, 100, 10000]) {
	const payload = Array.from({ length: count }, (_, index) => index);
	const initial = SnapshotSchema.parse({ format: 1, contract: 'bench.v1', version: 'one', value: payload });
	const second = SnapshotSchema.parse({ ...initial, version: 'two' });
	const cycle = async function (verify = false): Promise<number> {
		const slot = memory();
		strictEqual(await slot.save(initial, { expectedVersion: undefined }), true);
		strictEqual(await slot.save(second, { expectedVersion: 'one' }), true);
		strictEqual(await slot.save({ ...initial, version: 'stale' }, { expectedVersion: 'one' }), false);
		const loaded = (await slot.load())!;
		strictEqual(loaded.version, 'two');
		if (verify) {
			deepStrictEqual(loaded.value, payload);
			notStrictEqual(loaded.value, initial.value);
		}
		return (loaded.value as number[]).length;
	};
	strictEqual(await cycle(true), count);
	group(`snapshot ${count} values, create/replace/stale reject/read`, () => {
		bench('atomic memory slot with validated detached envelopes', async () => do_not_optimize(await cycle()));
		bench('structuredClone cost reference: no validation or version arbitration', () => {
			do_not_optimize(structuredClone(initial));
			do_not_optimize(structuredClone(second));
			do_not_optimize(structuredClone(second));
		});
	});
}
await run();
