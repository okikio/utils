import { describe, it } from 'node:test';
import { expect } from '@std/expect';

import * as csv from './mod.ts';

describe('CSV retained Core admission', () => {
	it('enforces each collecting safety limit at the public boundary', () => {
		expect(() => csv.parse('Company,Domain\nOne,one.example\nTwo,two.example', { maximumRows: 1 }))
			.toThrow(csv.CsvParseError);
		expect(() => csv.parse('Company,Domain\nOne,one.example', { maximumColumns: 1 }))
			.toThrow(csv.CsvParseError);
		expect(() => csv.parse('Company,Domain\nNorthstar,northstar.example', { maximumCellCharacters: 5 }))
			.toThrow(csv.CsvParseError);
		expect(() =>
			csv.parseBytes(new TextEncoder().encode('Company,Domain\nNorthstar,northstar.example'), { maximumBytes: 8 })
		)
			.toThrow(csv.CsvParseError);
		expect(() => csv.parse('Company,Domain\nNorthstar,northstar.example', { maximumCharacters: 8 }))
			.toThrow(csv.CsvParseError);
	});
});
