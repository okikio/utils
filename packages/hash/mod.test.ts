import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { hex, id, sha256 } from './mod.ts';

describe('SHA-256', () => {
	it('matches published empty and ASCII vectors for text and bytes', async () => {
		expect(await sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
		expect(await sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
		expect(await sha256(new TextEncoder().encode('abc'))).toBe(await sha256('abc'));
	});
	it('copies only the admitted view before returning control', async () => {
		const bytes = new Uint8Array([1, 97, 98, 99, 2]);
		const pending = sha256(bytes.subarray(1, 4));
		bytes.fill(0);
		expect(await pending).toBe(await sha256('abc'));
		expect(hex(new Uint8Array([1, 0, 255, 2]).subarray(1, 3))).toBe('00ff');
	});
	it('keeps tuples unambiguous when values contain separators', async () => {
		expect(await id('row', ['a\0b', 'c'])).not.toBe(await id('row', ['a', 'b\0c']));
		expect(await id('row', ['a', 'b'])).toBe(await id('row', ['a', 'b']));
		expect(await id('row', ['a', 'b'])).toMatch(/^row-[a-f0-9]{32}$/);
	});
});
