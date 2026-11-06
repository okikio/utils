/** Compare exact catalog lookup with Map for the same IDs; Map omits definition conflict guards. */
import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as catalog from './catalog/mod.ts';
for (const count of [10, 1000, 100000]) {
	const definitions = Object.fromEntries(
		Array.from({ length: count }, (_, index) => ['key' + index, Object.freeze({ id: 'key' + index, kind: 'asset' })]),
	);
	const selected = catalog.create('bench', definitions);
	const map = new Map(Object.entries(definitions));
	const key = 'key' + (count - 1);
	strictEqual(catalog.get(selected, key), map.get(key));
	group(`catalog ${count} definitions, warm exact-ID lookup`, () => {
		bench('catalog lookup', () => do_not_optimize(catalog.get(selected, key)));
		bench('Map lookup only, no definition guards', () => do_not_optimize(map.get(key)));
	});
}
await run();
