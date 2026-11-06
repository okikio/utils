import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import fc from 'fast-check';
import * as change from './change.ts';
import * as json from './json.ts';

describe('JSON values and explicit changes', () => {
	it('preserves nested changes, removals, array shifts and root replacement', () => {
		for (
			const [before, after] of [
				[{ a: { b: 1 } }, { a: { b: 2 } }],
				[{ a: 1 }, {}],
				[[1, 2, 3], [1]],
				[[1], [0, 1, 2]],
				[1, { replacement: true }],
				[{ a: [1, { b: 2 }] }, { a: [{ b: 3 }] }],
			]
		) expect(change.patch(before, change.diff(before, after))).toEqual(after);
		expect(change.diff({ a: 1 }, {})).toEqual([{ type: 'remove', path: ['a'] }]);
	});

	it('round trips generated JSON with reproducible seeds and shrinking counterexamples', () => {
		// All JSON data keys participate, including Unicode and prototype-shaped names.
		const document = fc.jsonValue({ maxDepth: 4, stringUnit: 'grapheme' });
		fc.assert(
			fc.property(document, document, (before, after) => {
				const originalBefore = JSON.stringify(before);
				const originalAfter = JSON.stringify(after);
				const changes = change.diff(before, after);
				const originalChanges = JSON.stringify(changes);
				const patched = change.patch(before, changes);
				// Native JSON normalization is independent of both diff and patch.
				expect(patched).toEqual(JSON.parse(originalAfter));
				expect(JSON.stringify(before)).toBe(originalBefore);
				expect(JSON.stringify(after)).toBe(originalAfter);
				expect(JSON.stringify(changes)).toBe(originalChanges);
				expect(change.diff(patched, after)).toEqual([]);
			}),
			{ seed: 39029, numRuns: 500 },
		);
	});

	it('does not borrow inserted values or preserve accidental alias identity', () => {
		const shared = { value: 1 };
		const before = { left: shared, right: shared };
		const after = { left: { value: 2 }, right: { value: 3 } };
		const patched = change.patch(before, change.diff(before, after));
		expect(patched).toEqual(after);
		expect(before.left.value).toBe(1);
		const insertion = { nested: [1] };
		const added = change.patch({}, [{ type: 'add', path: ['new'], value: insertion }]);
		insertion.nested.push(2);
		expect(added).toEqual({ new: { nested: [1] } });
	});

	it('rejects unsupported values and never evaluates ordinary getters', () => {
		let reads = 0;
		const getter = Object.defineProperty({}, 'value', {
			enumerable: true,
			get() {
				reads++;
				return 1;
			},
		});
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		const sparse = [1, , 3];
		for (
			const value of [undefined, NaN, Infinity, 1n, Symbol(), new Date(), new Map(), new Set(), sparse, getter, cycle]
		) {
			expect(() => json.copy(value)).toThrow();
		}
		expect(reads).toBe(0);
	});

	it('preserves prototype-shaped own data while rejecting inherited traversal', () => {
		const source = JSON.parse('{"__proto__":{"polluted":true},"constructor":"data"}');
		const copied = json.copy(source);
		expect(Object.getPrototypeOf(copied)).toBe(null);
		expect(Object.hasOwn(copied as object, '__proto__')).toBe(true);
		expect(() => change.patch({}, [{ type: 'add', path: ['__proto__', 'polluted'], value: true }])).toThrow();
		const patched = change.patch({}, change.diff({}, source));
		expect(patched).toEqual(source);
		expect(Object.getPrototypeOf(patched)).toBe(null);
		const edited = change.patch(patched, [{ type: 'replace', path: ['__proto__', 'polluted'], value: false }]);
		expect(edited).toEqual(JSON.parse('{"__proto__":{"polluted":false},"constructor":"data"}'));
		expect(() => change.patch({}, [{ type: 'add', path: ['constructor', 'prototype', 'polluted'], value: true }]))
			.toThrow();
		expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
	});

	it('checks own path existence and distinct array-index types', () => {
		expect(() => change.patch({}, [{ type: 'replace', path: ['missing', 'value'], value: 1 }])).toThrow();
		expect(() => change.patch([1], [{ type: 'replace', path: ['0'], value: 2 }])).toThrow();
		expect(() => change.patch({ value: 1 }, [{ type: 'add', path: ['value'], value: 2 }])).toThrow();
		expect(() => change.patch(null, [{ type: 'remove', path: [] }])).toThrow();
	});

	it('enforces nesting, expanded node and operation budgets', () => {
		expect(() => json.copy({ a: {} }, { maximumDepth: 1 })).toThrow('maximumDepth');
		const shared = { a: 1 };
		expect(() => json.copy([shared, shared], { maximumNodes: 4 })).toThrow('maximumNodes');
		expect(() => change.diff({}, { a: 1, b: 2 }, { maximumChanges: 1 })).toThrow('maximumChanges');
		expect(change.equal({ number: 0 }, { number: -0 })).toBe(true);
	});

	it('uses one JSON budget through direct and family imports without allocating equality changes', () => {
		expect(() => change.diff({}, { a: [1, 2] }, { maximumNodes: 3 })).toThrow('maximumNodes');
		expect(() => change.patch({}, [{ type: 'add', path: ['a'], value: [1, 2] }], { maximumNodes: 3 })).toThrow(
			'maximumNodes',
		);
		expect(() => json.copy({ a: '💡' }, { maximumStringCodeUnits: 2 })).toThrow('maximumStringCodeUnits');
		expect(json.copy({ a: '💡' }, { maximumStringCodeUnits: 3 })).toEqual({ a: '💡' });
		expect(() => change.diff({}, { long: 'text' }, { maximumStringCodeUnits: 7 })).toThrow('maximumStringCodeUnits');
		expect(change.equal({ a: 1 }, { a: 2 }, { maximumChanges: 0 })).toBe(false);
		expect(change.equal({ a: [1, 2] }, { a: [1, 2] }, { maximumChanges: 0 })).toBe(true);
	});
});
