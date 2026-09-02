import { expect } from '@std/expect';
import { describe, it } from 'node:test';

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
		Object.defineProperty(object, 'secret', { enumerable: true, get() { reads += 1; return 'no'; } });
		const array: unknown[] = [];
		Object.defineProperty(array, '0', { enumerable: true, configurable: true, get() { reads += 1; return 'no'; } });
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
		const dangerous = { toString() { calls += 1; return 'danger'; } };
		expect(fault.message(new Error('boom'))).toBe('boom');
		expect(fault.message('abcdef', { maximumStringLength: 4 })).toBe('abc…');
		expect(fault.message(dangerous)).toBe('{\"toString\":\"[function]\"}');
		expect(calls).toBe(0);
	});

	it('rejects accessor-backed options without invoking configuration getters', () => {
		let reads = 0;
		const options = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(options, 'maximumDepth', { enumerable: true, get() { reads += 1; return 1; } });
		expect(() => fault.encode('x', options)).toThrow('enumerable data property');
		expect(reads).toBe(0);
	});

	it('rejects unsafe operational limits', () => {
		expect(() => fault.encode('x', { maximumDepth: -1 })).toThrow(TypeError);
		expect(() => fault.encode('x', { maximumEntries: Number.MAX_SAFE_INTEGER + 1 })).toThrow(TypeError);
	});
});
