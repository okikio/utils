import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as encoding from './encoding.ts';

describe('canonical encodings', () => {
	const formats = [
		{
			name: 'hex',
			encode: encoding.hex,
			decode: encoding.unhex,
			expected: 'fbffef',
			invalid: ['A0', 'a', '0g', '00 '],
		},
		{
			name: 'base64',
			encode: encoding.base64,
			decode: encoding.unbase64,
			expected: '+//v',
			invalid: ['Zg', 'Zh==', 'Zg==\n', '_w=='],
		},
		{
			name: 'base64url',
			encode: encoding.base64url,
			decode: encoding.unbase64url,
			expected: '-__v',
			invalid: ['Zg==', 'Zh', '/w', 'Z g'],
		},
	] as const;

	for (const format of formats) {
		describe(format.name, () => {
			it('encodes and decodes empty input', () => {
				expect(format.encode(new Uint8Array())).toBe('');
				expect(format.decode('')).toEqual(new Uint8Array());
			});

			it('uses only the visible view range and matches literal wire bytes', () => {
				// Nonzero sentinels detect accidental inclusion of the backing buffer.
				const bytes = new Uint8Array([99, 251, 255, 239, 88]).subarray(1, 4);
				expect(format.encode(bytes)).toBe(format.expected);
				expect(format.decode(format.expected)).toEqual(bytes);
			});

			for (const value of format.invalid) {
				it(`rejects the noncanonical spelling ${JSON.stringify(value)}`, () => {
					expect(() => format.decode(value)).toThrow();
				});
			}
		});
	}
});
