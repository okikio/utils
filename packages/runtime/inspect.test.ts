import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { inspect } from './inspect.ts';
describe('host evidence without acquisition', () => {
	it('reports actual API presence and package coverage separately from permission', () => {
		const report = inspect();
		const expected = 'Deno' in globalThis ? 'deno' : 'Bun' in globalThis ? 'bun' : 'node';
		expect(report.host).toBe(expected);
		expect(report.permissions).toBe('unqueried');
		expect(report.adapters.file).toBe(expected === 'deno');
		expect(report.adapters.worker).toBe(true);
		expect(report.features.streams).toBe(true);
		expect(Object.isFrozen(report.features)).toBe(true);
		expect(Object.isFrozen(report.adapters)).toBe(true);
		expect(Object.isFrozen(report)).toBe(true);
	});
});
