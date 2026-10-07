import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as fc from 'fast-check';

import * as csv from './mod.ts';

/** Frame CSV independently so a broken writer cannot disguise a parser defect. */
function encode(rows: readonly (readonly string[])[]): string {
	return rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
}

/** Pull encoded bytes in fixed pieces, including splits inside UTF-8 and quoted records. */
function source(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			if (offset === bytes.length) {
				controller.close();
				return;
			}
			controller.enqueue(bytes.slice(offset, offset + size));
			offset = Math.min(bytes.length, offset + size);
		},
	});
}

describe('CSV independent invariants', () => {
	it('preserves generated original cells in collecting and byte-chunked parsers', async () => {
		const cell = fc.array(fc.constantFrom('a', 'b', ',', '"', '\r', '\n', 'β', '😀', ' ', '=', '0'), { maxLength: 20 })
			.map((characters) => characters.join(''));
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.tuple(cell, cell, cell), { minLength: 1, maxLength: 12 }),
				fc.integer({ min: 1, max: 31 }),
				async (rows, chunkSize) => {
					const bytes = new TextEncoder().encode(encode([['Account', 'Notes', 'Email'], ...rows]));
					const options = { delimiter: ',' as const, headerRow: 1, preserveBlankRows: true };
					expect(csv.parseBytes(bytes, options).rows.map((row) => row.values)).toEqual(rows);
					const input = source(bytes, chunkSize);
					await using parsed = await csv.parseStream(input, options);
					expect((await Array.fromAsync(parsed.rows)).map((row) => row.values)).toEqual(rows);
					expect(input.locked).toBe(false);
				},
			),
			{ seed: 20261007, numRuns: 100 },
		);
	});

	it('streams a realistic import without changing row identity or retaining an input inventory', async () => {
		const total = 10_000;
		let produced = 0;
		const input = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (produced === 0) controller.enqueue(new TextEncoder().encode('Account,Domain\n'));
				if (produced === total) {
					controller.close();
					return;
				}
				controller.enqueue(new TextEncoder().encode(`account-${produced},domain-${produced}.example\n`));
				produced += 1;
			},
		});
		await using parsed = await csv.parseStream(input, { headerRow: 1, headerScanRows: 1, maximumRows: total });
		let consumed = 0;
		for await (const row of parsed.rows) {
			expect(row.values).toEqual([`account-${consumed}`, `domain-${consumed}.example`]);
			consumed += 1;
			if (consumed === 1) expect(produced).toBeLessThan(total);
		}
		expect(consumed).toBe(total);
		expect(input.locked).toBe(false);
	});
});
