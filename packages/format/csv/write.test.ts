import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { parse } from './parse.ts';
import * as write from './write.ts';

describe('bounded CSV scalar writer', () => {
	it('round trips exact blank, comma, quote, CR, LF, Unicode and spreadsheet-like values', () => {
		const values = ['', 'comma,value', '"quoted"', 'bare\rreturn', 'line\nfeed', 'both\r\nlines', '😀', '=unchanged'];
		const csv = values.map(write.cell).join(write.comma) + write.recordEnd;
		expect(parse(csv, { headerRow: 1, preserveBlankRows: true }).columns.map((column) => column.rawHeader)).toEqual(
			values,
		);
	});
	it('encodes a large cell separately from surrounding record framing', () => {
		const value = '"'.repeat(1_000_000);
		const encoded = write.cell(value);
		expect(encoded.length).toBe(2_000_002);
		expect(encoded.endsWith(write.recordEnd)).toBe(false);
	});
});
