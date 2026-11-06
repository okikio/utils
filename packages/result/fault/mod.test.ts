import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import { SuppressedError } from '@okikio/dispose';

import * as fault from './mod.ts';

describe('fault', () => {
	it('projects ordinary Error diagnostics without retaining the live Error', () => {
		const error = new Error('boom', { cause: new Error('root') });
		const encoded = fault.encode(error);
		expect(encoded).toMatchObject({ name: 'Error', message: 'boom' });
		expect(Object.isFrozen(encoded)).toBe(true);
	});

	it('distinguishes record diagnostics without treating arrays as records', () => {
		const record = fault.encode(new Error('boom'));
		const array = fault.encode([1, 2]);
		expect(fault.isRecord(record)).toBe(true);
		expect(fault.isRecord(array)).toBe(false);
	});

	it('never invokes accessors while inspecting object or array diagnostics', () => {
		let reads = 0;
		const object = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(object, 'secret', {
			enumerable: true,
			get() {
				reads += 1;
				return 'no';
			},
		});
		const array: unknown[] = [];
		Object.defineProperty(array, '0', {
			enumerable: true,
			configurable: true,
			get() {
				reads += 1;
				return 'no';
			},
		});
		array.length = 1;

		expect(fault.encode(object)).toEqual({ secret: '[accessor]' });
		expect(fault.encode(array)).toEqual(['[accessor]']);
		expect(reads).toBe(0);
	});

	it('bounds cycles, depth, breadth, and string length deterministically', () => {
		const root: Record<string, unknown> = { text: 'abcdef', extra: 1 };
		root.self = root;
		root.child = { grandchild: { value: 1 } };
		const encoded = fault.encode(root, { maximumDepth: 2, maximumEntries: 3, maximumStringLength: 4 });
		expect(encoded).toEqual({
			child: { grandchild: '[maximum-depth]' },
			extra: 1,
			self: '[circular]',
		});
	});

	it('uses stable markers instead of executing custom object conversion', () => {
		let calls = 0;
		class Dangerous {
			toString() {
				calls += 1;
				return 'danger';
			}
		}
		expect(fault.encode(new Dangerous())).toBe('[object]');
		expect(calls).toBe(0);
	});

	it('derives bounded messages without invoking custom coercion', () => {
		let calls = 0;
		const dangerous = {
			toString() {
				calls += 1;
				return 'danger';
			},
		};
		expect(fault.message(new Error('boom'))).toBe('boom');
		expect(fault.message('abcdef', { maximumStringLength: 4 })).toBe('abc…');
		expect(fault.message(dangerous)).toBe('{"toString":"[function]"}');
		expect(calls).toBe(0);
	});

	it('rejects accessor-backed options without invoking configuration getters', () => {
		let reads = 0;
		const options = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(options, 'maximumDepth', {
			enumerable: true,
			get() {
				reads += 1;
				return 1;
			},
		});
		expect(() => fault.encode('x', options)).toThrow(TypeError);
		expect(reads).toBe(0);
	});

	it('bounds inherited error names and bigint text as well as ordinary strings', () => {
		const error = new Error('message');
		Object.defineProperty(error, 'name', { value: 'x'.repeat(500), enumerable: true });
		expect(fault.encode(error, { maximumStringLength: 4, includeStack: false })).toMatchObject({
			name: 'xxx…',
			message: 'mes…',
		});
		expect(fault.encode(12345678901234567890n, { maximumStringLength: 4 })).toBe('123…');
		expect(fault.encode(123n, { maximumStringLength: 0 })).toBe('');
	});

	it('rejects unsafe operational limits', () => {
		expect(() => fault.encode('x', { maximumDepth: -1 })).toThrow(TypeError);
		expect(() => fault.encode('x', { maximumEntries: Number.MAX_SAFE_INTEGER + 1 })).toThrow(TypeError);
	});
});

describe('native error diagnostics', () => {
	it('retains nested aggregate and suppressed failures, including undefined', () => {
		const primary = new TypeError('operation failed');
		const cleanup = new AggregateError([new Error('first release'), undefined], 'release failed');
		const error = new SuppressedError(cleanup, primary, 'cleanup after failure');
		expect(fault.encode(error, { includeStack: false })).toEqual({
			name: 'SuppressedError',
			message: 'cleanup after failure',
			error: {
				name: 'AggregateError',
				message: 'release failed',
				errors: [{ name: 'Error', message: 'first release' }, '[undefined]'],
			},
			suppressed: { name: 'TypeError', message: 'operation failed' },
		});
	});
	it('applies cycle, depth, entry, and text limits to cleanup chains', () => {
		const error = new SuppressedError(undefined, undefined, 'parent');
		error.suppressed = error;
		error.error = new AggregateError([new Error('abcdef'), 'extra'], 'children');
		expect(fault.encode(error, { includeStack: false })).toMatchObject({ suppressed: '[circular]' });
		expect(fault.encode(error, { maximumDepth: 1, includeStack: false })).toMatchObject({
			error: '[maximum-depth]',
			suppressed: '[maximum-depth]',
		});
		expect(fault.encode(error, { maximumEntries: 1, maximumStringLength: 4, includeStack: false })).toEqual({
			name: 'Sup…',
			message: 'par…',
			error: {
				name: 'Agg…',
				message: 'chi…',
				errors: [{ name: 'Err…', message: 'abc…' }],
			},
		});
	});
	it('does not invoke or inherit aggregate and suppressed property accessors', () => {
		let reads = 0;
		const error = new Error('own failure');
		Object.defineProperty(error, 'errors', {
			get() {
				reads++;
				return [];
			},
		});
		Object.setPrototypeOf(
			error,
			Object.create(Error.prototype, {
				suppressed: {
					get() {
						reads++;
						return new Error('inherited');
					},
				},
			}),
		);
		expect(fault.encode(error, { includeStack: false })).toEqual({
			name: 'Error',
			message: 'own failure',
			errors: '[accessor]',
		});
		expect(reads).toBe(0);
	});
	it('preserves inherited built-in error names and their message', () => {
		for (const error of [new TypeError('type'), new RangeError('range'), new SyntaxError('syntax')]) {
			expect(fault.encode(error)).toMatchObject({ name: error.name, message: error.message });
		}
	});

	it('does not invoke inherited diagnostic accessors or custom stack formatters', () => {
		let reads = 0;
		const error = new Error('private');
		Object.setPrototypeOf(
			error,
			Object.create(Error.prototype, {
				name: {
					get() {
						reads += 1;
						return 'secret';
					},
				},
			}),
		);
		expect(fault.encode(error, { includeStack: true })).toMatchObject({ name: 'Error', message: 'private' });
		expect(reads).toBe(0);
	});
});
