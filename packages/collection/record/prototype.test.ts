import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as record from './mod.ts';
import * as json from './json.ts';

describe('ordinary record prototypes', () => {
	it('rejects a forged null-rooted prototype borrowing the native Object constructor', () => {
		const prototype = Object.create(null);
		Object.defineProperty(prototype, 'constructor', { value: Object });
		const value = Object.create(prototype);
		value.id = 'job';
		expect(record.is(value)).toBe(false);
		expect(() => record.assert(value)).toThrow(TypeError);
		expect(() => json.copy(value)).toThrow(TypeError);
	});

	it('rejects a constructor that only pretends to have native source text', () => {
		let reads = 0;
		function PretendObject() {
			return {};
		}
		const prototype = Object.create(null);
		Object.defineProperty(prototype, 'constructor', { value: PretendObject });
		PretendObject.prototype = prototype;
		Object.defineProperty(PretendObject, 'toString', {
			get() {
				reads++;
				return () => Function.prototype.toString.call(Object);
			},
		});
		const value = Object.create(prototype);
		expect(record.is(value)).toBe(false);
		expect(() => json.copy(value)).toThrow(TypeError);
		expect(reads).toBe(0);
	});

	it('does not invoke a constructor accessor on an unfamiliar prototype', () => {
		let reads = 0;
		const prototype = Object.create(null);
		Object.defineProperty(prototype, 'constructor', {
			get() {
				reads++;
				return Object;
			},
		});
		const value = Object.create(prototype);
		expect(record.is(value)).toBe(false);
		expect(() => record.assert(value)).toThrow(TypeError);
		expect(() => json.copy(value)).toThrow(TypeError);
		expect(reads).toBe(0);
	});

	it('keeps class instances outside the record contract', () => {
		class Authored {
			id = 'job';
		}
		const value = new Authored();
		expect(record.is(value)).toBe(false);
		expect(() => json.copy(value)).toThrow(TypeError);
	});
});
