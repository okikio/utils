/**
 * Measure trusted record mapping and bounded sorted-key JSON as key count grows.
 * The native map overlaps only the trusted-input domain: it omits safe-key and
 * immutable-result guarantees. JSON encoding has its own group and no map ratio.
 * Corpus creation and full output comparison are outside timing.
 * @module
 */
import { deepStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as record from '@okikio/collection/record';
import * as json from '@okikio/collection/record/json';

const counts = [10, 1_000, 100_000];
const maximumBytes = 4_000_000;
const fixtures = new Map<number, Record<string, number>>();

/** Registered numeric dimensions are read only while Mitata prepares a trial. */
interface ParametersType {
	/** Return the selected own-key count; fixture allocation is outside timing. */
	get(name: string): number;
}

/** Native cost reference for the same keys and doubled values on trusted data. */
function native(input: Readonly<Record<string, number>>): Record<string, number> {
	return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value * 2]));
}

// A sum alone misses values assigned to the wrong keys. Verify every mapping,
// then decode JSON and independently check both values and lexical key order.
for (const count of counts) {
	const input = Object.fromEntries(Array.from({ length: count }, (_, index) => [`key${index}`, index]));
	fixtures.set(count, input);
	const mapped = record.map(input, (value) => Number(value) * 2);
	deepStrictEqual(Object.entries(mapped), Object.entries(native(input)));
	strictEqual(Object.getPrototypeOf(mapped), null);
	strictEqual(Object.isFrozen(mapped), true);
	const decoded: Record<string, number> = JSON.parse(json.stringify(input, { maximumBytes }));
	deepStrictEqual(decoded, input);
	deepStrictEqual(Object.keys(decoded), Object.keys(input).sort());
}

group('record map; trusted own string keys', () => {
	bench('safe immutable map, $keys keys', function* (state: ParametersType) {
		const input = fixtures.get(state.get('keys'))!;
		yield () => do_not_optimize(record.map(input, (value) => Number(value) * 2));
	}).args('keys', counts);

	bench('native mutable map cost reference, $keys keys', function* (state: ParametersType) {
		const input = fixtures.get(state.get('keys'))!;
		yield () => do_not_optimize(native(input));
	}).args('keys', counts);
});

group('deterministic bounded JSON; sorting and encoding included', () => {
	bench('sorted-key encoding, $keys keys', function* (state: ParametersType) {
		const input = fixtures.get(state.get('keys'))!;
		yield () => do_not_optimize(json.stringify(input, { maximumBytes }));
	}).args('keys', counts);
});

await run();
