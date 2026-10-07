import { describe, it } from 'node:test';
import { expect } from '@std/expect';

import * as csv from './mod.ts';

const encoder = new TextEncoder();

function stream(...chunks: string[]): ReadableStream<Uint8Array> {
	const encoded = chunks.map((chunk) => encoder.encode(chunk));
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of encoded) controller.enqueue(chunk);
			controller.close();
		},
	});
}

describe('CSV text-only source policy', () => {
	it('rejects renamed PNG, MP4, archives, and unsupported UTF-16 CSV before rows', async () => {
		for (
			const bytes of [
				new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]),
				new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]),
				new Uint8Array([0x50, 0x4b, 3, 4]),
				new Uint8Array([0xff, 0xfe, 65, 0, 44, 0, 66, 0, 10, 0]),
				new Uint8Array([0xfe, 0xff, 0, 65, 0, 44, 0, 66, 0, 10]),
			]
		) {
			let cancelled = false;
			const source = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(bytes);
				},
				cancel() {
					cancelled = true;
				},
			});
			// Force discovery to finish at the exact prefix rather than wait for this deliberately open stream.
			await expect(csv.parseStream(source, { textOnly: true, maximumPeekBytes: bytes.length })).rejects.toThrow(
				csv.CsvParseError,
			);
			expect(cancelled).toBe(true);
		}
	});
	it('rejects NUL and other controls anywhere after the discovery prefix', async () => {
		for (const control of ['\u0000', '\u0001', '\u007f']) {
			await using document = await csv.parseStream(stream('A,B\nOne,one.example\n', `Two,${control}payload\n`), {
				textOnly: true,
				maximumPeekBytes: 4,
				headerScanRows: 1,
			});
			await expect(Array.fromAsync(document.rows)).rejects.toThrow(csv.CsvParseError);
		}
	});
	it('preserves UTF-8 BOM and Windows-1252 text, quoted newlines and tabs', async () => {
		const text = 'Company,Notes\nCafé,"line one\nline two\tend"\n';
		for (
			const bytes of [
				new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode(text)]),
				new Uint8Array([...text].map((value) => value.charCodeAt(0))),
			]
		) {
			await using document = await csv.parseStream(
				new ReadableStream({
					start(c) {
						c.enqueue(bytes);
						c.close();
					},
				}),
				{ textOnly: true },
			);
			expect((await Array.fromAsync(document.rows))[0]?.values).toEqual(['Café', 'line one\nline two\tend']);
		}
	});
	it('bounds cells and headers without changing the generic default policy', async () => {
		await expect(csv.parseStream(stream('abcdef,B\nvalue,two\n'), { textOnly: true, maximumCellCharacters: 5 })).rejects
			.toThrow(csv.CsvParseError);
		await using legacy = await csv.parseStream(stream('A,B\nvalue\u0000,two\n'));
		expect((await Array.fromAsync(legacy.rows))[0]?.values[0]).toBe('value\u0000');
	});
	it('keeps ordinary CSV headers containing short media-like labels', async () => {
		for (const header of ['GIF8', 'abcdftyp']) {
			await using document = await csv.parseStream(stream(`${header},Value\nOne,two\n`), {
				textOnly: true,
				headerRow: 1,
			});
			expect((await Array.fromAsync(document.rows))[0]?.values).toEqual(['One', 'two']);
		}
	});
	it('accepts Excel-sized cells and rejects the next character in cells and headers', async () => {
		const maximumCellCharacters = 32_767;
		await using exact = await csv.parseStream(stream(`A,B\n${'x'.repeat(maximumCellCharacters)},value\n`), {
			textOnly: true,
			maximumCellCharacters,
			headerRow: 1,
		});
		expect((await Array.fromAsync(exact.rows))[0]?.values[0]?.length).toBe(maximumCellCharacters);
		await expect(csv.parseStream(stream(`${'x'.repeat(maximumCellCharacters + 1)},B\nvalue,two\n`), {
			textOnly: true,
			maximumCellCharacters,
			headerRow: 1,
		})).rejects.toThrow(csv.CsvParseError);
		await using excess = await csv.parseStream(stream(`A,B\n${'x'.repeat(maximumCellCharacters + 1)},value\n`), {
			textOnly: true,
			maximumCellCharacters,
			headerRow: 1,
		});
		await expect(Array.fromAsync(excess.rows)).rejects.toThrow(csv.CsvParseError);
	});
	it('enforces exact byte boundaries including replayed discovery bytes', async () => {
		const text = 'A,B\nOne,two\n';
		await using exact = await csv.parseStream(stream(text), {
			textOnly: true,
			maximumBytes: encoder.encode(text).length,
		});
		expect(await Array.fromAsync(exact.rows)).toHaveLength(1);
		await using excess = await csv.parseStream(stream(text), {
			textOnly: true,
			maximumBytes: encoder.encode(text).length - 1,
			headerScanRows: 1,
		});
		await expect(Array.fromAsync(excess.rows)).rejects.toThrow(csv.CsvParseError);
	});
});
