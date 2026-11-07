/** Measure an in-memory conditional snapshot cycle, including validation and detached copies. */
import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import { memory } from './state/mod.ts';
import { SnapshotSchema } from '@okikio/context/state';
for (const count of [1, 100, 10000]) {
	const payload = Array.from({ length: count }, (_, index) => index);
	const initial = SnapshotSchema.parse({ format: 1, contract: 'bench.v1', version: 'one', value: payload });
	const second = SnapshotSchema.parse({ ...initial, version: 'two' });
	const stale = { ...initial, version: 'stale' };
	/** A fresh slot makes every trial exercise first write, replacement, conflict and read. */
	const cycle = async function (verify = false) {
		const slot = memory();
		const created = await slot.save(initial, { expectedVersion: undefined });
		const replaced = await slot.save(second, { expectedVersion: 'one' });
		const conflict = await slot.save(stale, { expectedVersion: 'one' });
		const loaded = await slot.load();
		if (verify) {
			strictEqual(created, true);
			strictEqual(replaced, true);
			strictEqual(conflict, false);
			deepStrictEqual(loaded, second);
			notStrictEqual(loaded?.value, second.value);
		}
		return loaded;
	};
	await cycle(true);
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
