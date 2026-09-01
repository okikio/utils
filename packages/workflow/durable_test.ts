import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as durable from './durable.ts';

describe('workflow durable snapshots', () => {
	it('normalizes the numeric representation JSON persistence can reproduce', () => {
		const value = durable.snapshot(-0, 'value');
		assert.equal(value, 0);
		assert.equal(Object.is(value, -0), false);
		assert.throws(() => durable.snapshot(Number.POSITIVE_INFINITY, 'value'), /non-finite number/);
	});

	it('rejects sparse and extra enumerable array state instead of silently dropping it', () => {
		const sparse = new Array<unknown>(1);
		assert.throws(() => durable.snapshot(sparse, 'value'), /sparse array element/);

		const extended: unknown[] = ['kept'];
		Object.defineProperty(extended, 'note', { value: 'would be dropped', enumerable: true });
		assert.throws(() => durable.snapshot(extended, 'value'), /extra enumerable array property/);
	});

	it('rejects enumerable symbols and accessors without executing caller code', () => {
		const symbol = Symbol('hidden-state');
		const withSymbol = Object.create(null) as Record<string | symbol, unknown>;
		Object.defineProperty(withSymbol, symbol, { value: 'would be dropped', enumerable: true });
		assert.throws(() => durable.snapshot(withSymbol, 'value'), /enumerable symbol property/);

		let reads = 0;
		const accessor = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(accessor, 'unsafe', {
			enumerable: true,
			get() {
				reads += 1;
				return 'executed';
			},
		});
		assert.throws(() => durable.snapshot(accessor, 'value'), /enumerable data property/);
		assert.equal(reads, 0);

		let arrayReads = 0;
		const accessorArray: unknown[] = ['safe'];
		Object.defineProperty(accessorArray, '0', {
			enumerable: true,
			get() {
				arrayReads += 1;
				return 'executed';
			},
		});
		assert.throws(() => durable.snapshot(accessorArray, 'value'), /enumerable data property/);
		assert.equal(arrayReads, 0);
	});

	it('preserves the existing plain-object, cycle, and immutable snapshot contract', () => {
		assert.throws(() => durable.snapshot(new Date(), 'value'), /non-plain object/);
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		assert.throws(() => durable.snapshot(cyclic, 'value'), /cycle/);

		const nested = durable.snapshot({ b: [2], a: 1 }, 'value') as Readonly<Record<string, unknown>>;
		assert.deepEqual(Object.keys(nested), ['a', 'b']);
		assert.equal(Object.isFrozen(nested), true);
		assert.equal(Object.isFrozen(nested.b), true);
	});
});
