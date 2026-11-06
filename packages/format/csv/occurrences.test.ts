import { describe, it } from 'node:test';
import { expect } from '@std/expect';

import { CsvParseError, parse, parseStream } from './mod.ts';

describe('CSV header and row occurrences', () => {
	it('preserves explicitly selected all-blank headers consistently while automatic discovery still requires evidence', async () => {
		const source = ',,\r\none,,\r\n,,\r\n';
		const options = { delimiter: ',' as const, headerRow: 1, preserveBlankRows: true };
		const collected = parse(source, options);
		await using streamed = await parseStream(new Blob([source]).stream(), options);
		expect(collected.columns.map((column) => column.rawHeader)).toEqual(['', '', '']);
		expect(streamed.columns).toEqual(collected.columns);
		expect(await Array.fromAsync(streamed.rows)).toEqual(collected.rows);
		expect(() => parse(',,\r\n,,\r\n', { delimiter: ',', preserveBlankRows: true })).toThrow(CsvParseError);
		await expect(parseStream(new Blob([',,\r\n,,\r\n']).stream(), { delimiter: ',', preserveBlankRows: true })).rejects
			.toBeInstanceOf(CsvParseError);
	});

	it('preserves raw duplicate/blank headers and empty source occurrences in both parsers', async () => {
		const source = ' Company ,Company,,Notes\r\nAcme,Acme,,"a\nb"\r\n,,,\r\n,, ,\r\n';
		const collected = parse(source, { headerRow: 1, preserveBlankRows: true });
		const bytes = new TextEncoder().encode(source);
		await using streamed = await parseStream(
			new ReadableStream({
				start(c) {
					c.enqueue(bytes);
					c.close();
				},
			}),
			{
				headerRow: 1,
				preserveBlankRows: true,
			},
		);
		expect(collected.columns.map((column) => column.rawHeader)).toEqual([' Company ', 'Company', '', 'Notes']);
		expect(streamed.columns).toEqual(collected.columns);
		expect(collected.rows).toHaveLength(3);
		expect(await Array.fromAsync(streamed.rows)).toEqual(collected.rows);
		expect(parse(source, { headerRow: 1 }).rows).toHaveLength(1);
	});

	it('counts empty records against the collecting parser row limit', async () => {
		// Admit through a promise so the rejection assertion checks the issue fields
		// directly and fails when parsing unexpectedly succeeds.
		const pending = Promise.resolve().then(() =>
			parse('A,B\n,\n,\n', { headerRow: 1, preserveBlankRows: true, maximumRows: 1 })
		);
		await expect(pending).rejects.toBeInstanceOf(CsvParseError);
		await expect(pending).rejects.toMatchObject({ code: 'too-many-rows' });
	});

	it('counts empty records against the streaming parser row limit', async () => {
		const pending = async () => {
			await using document = await parseStream(new Blob(['A,B\n,\n,\n']).stream(), {
				headerRow: 1,
				preserveBlankRows: true,
				maximumRows: 1,
			});
			return await Array.fromAsync(document.rows);
		};
		const result = pending();
		await expect(result).rejects.toBeInstanceOf(CsvParseError);
		await expect(result).rejects.toMatchObject({ code: 'too-many-rows' });
	});

	it('preserves uneven original values', () => {
		const document = parse('A,B\n1,2,extra\n3\n', { headerRow: 1, preserveBlankRows: true });
		expect(document.rows.map((row) => row.values)).toEqual([['1', '2', 'extra'], ['3']]);
	});

	it('preserves physically empty logical records without inventing a trailing record', async () => {
		const source = 'A,B\r\n\r\n1,2\r\n\r\n';
		const collected = parse(source, { headerRow: 1, preserveBlankRows: true });
		await using streamed = await parseStream(new Blob([source]).stream(), { headerRow: 1, preserveBlankRows: true });
		expect(collected.rows.map((row) => row.values)).toEqual([[''], ['1', '2'], ['']]);
		expect((await Array.fromAsync(streamed.rows)).map((row) => row.values)).toEqual([[''], ['1', '2'], ['']]);
	});
});

describe('CSV streaming character decoding', () => {
	it('rejects invalid UTF-8 after discovery instead of changing original cell bytes', async () => {
		const prefix = new TextEncoder().encode('A,B\nvalid,row\n');
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(prefix);
				controller.enqueue(new Uint8Array([0xff, 0x2c, 0x78, 0x0a]));
				controller.close();
			},
		});
		await using document = await parseStream(source, {
			headerRow: 1,
			headerScanRows: 1,
			maximumPeekBytes: 4,
			encoding: 'utf-8',
		});
		await expect(Array.fromAsync(document.rows)).rejects.toMatchObject({ code: 'invalid-csv' });
	});

	it('keeps UTF-8 when discovery ends inside a multibyte character', async () => {
		const source = new Blob(['A,B\n€uro,😀\n']).stream();
		await using document = await parseStream(source, { headerRow: 1, headerScanRows: 1, maximumPeekBytes: 5 });
		expect(document.encoding).toBe('utf-8');
		expect((await Array.fromAsync(document.rows)).map((row) => row.values)).toEqual([['€uro', '😀']]);
	});
});

describe('CSV logical source coordinates', () => {
	it('skips blank output rows without shifting logical source coordinates across quoted newlines', async () => {
		const source = 'Name,Note\r\n\r\nAda,"line one\nline two"\r\n,\r\nGrace,last\r\n';
		const expected = [
			{ row: 3, values: ['Ada', 'line one\nline two'], diagnostics: [] },
			{ row: 5, values: ['Grace', 'last'], diagnostics: [] },
		];
		expect(parse(source, { delimiter: ',', headerRow: 1 }).rows).toEqual(expected);
		const bytes = new TextEncoder().encode(source);
		let offset = 0;
		await using streamed = await parseStream(
			new ReadableStream<Uint8Array>({
				pull(controller) {
					if (offset === bytes.length) {
						controller.close();
						return;
					}
					const end = Math.min(bytes.length, offset + 3);
					controller.enqueue(bytes.slice(offset, end));
					offset = end;
				},
			}),
			{ delimiter: ',', headerRow: 1, maximumPeekBytes: 7 },
		);
		expect(await Array.fromAsync(streamed.rows)).toEqual(expected);
	});

	it('explicit header rows count blank source records while quoted newlines remain within one record', async () => {
		const source = 'Export\n\nName,Note\nAda,"first\nsecond"\n\nGrace,last\n';
		const options = { delimiter: ',' as const, headerRow: 3 };
		const collected = parse(source, options);
		expect(collected.headerRow).toBe(3);
		expect(collected.preamble).toEqual([['Export'], ['']]);
		expect(collected.columns.map((column) => column.rawHeader)).toEqual(['Name', 'Note']);
		expect(collected.rows).toEqual([
			{ row: 4, values: ['Ada', 'first\nsecond'], diagnostics: [] },
			{ row: 6, values: ['Grace', 'last'], diagnostics: [] },
		]);
		await using streamed = await parseStream(new Blob([source]).stream(), options);
		expect(streamed.headerRow).toBe(3);
		expect(streamed.preamble).toEqual([['Export'], ['']]);
		expect((await Array.fromAsync(streamed.rows)).map((row) => [row.row, row.values])).toEqual([
			[4, ['Ada', 'first\nsecond']],
			[6, ['Grace', 'last']],
		]);
	});
});
