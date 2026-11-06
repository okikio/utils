import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as csv from './mod.ts';
import * as write from './write.ts';

/** Collect bounded test output; production callers can forward each chunk directly. */
async function text(
	rows: Iterable<readonly string[]> | AsyncIterable<readonly string[]>,
	dialect = write.standard,
	opts: write.SerializeOptions = {},
): Promise<string> {
	const decoder = new TextDecoder();
	let result = '';
	for await (const chunk of write.serialize(rows, dialect, opts)) result += decoder.decode(chunk, { stream: true });
	return result + decoder.decode();
}

describe('source-aware CSV output', () => {
	it('distinguishes record endings from quoted newlines and only seals a streamed dialect at EOF', async () => {
		const source = '"A";"B"\r\n"line\ninside";"value"';
		const document = csv.parseBytes(new TextEncoder().encode(source), { delimiter: ';', headerRow: 1 });
		expect(document.dialect).toMatchObject({
			recordDelimiter: '\r\n',
			lineEnding: 'crlf',
			quoting: 'all',
			finalNewline: false,
		});
		expect(await text([['A', 'B'], ...document.rows.map((row) => row.values)], document.dialect)).toBe(source);
		await using streamed = await csv.parseStream(new Blob([source]).stream(), { delimiter: ';', headerRow: 1 });
		expect(streamed.dialect).toBeUndefined();
		await Array.fromAsync(streamed.rows);
		expect(streamed.dialect).toEqual(document.dialect);
	});
	it('emits one BOM with bounded chunks and preserves formula cells unless explicitly rewritten', async () => {
		const chunks = await Array.fromAsync(
			write.serialize([['=1', 'é'], ['second', 'value']], { ...write.standard, encoding: 'utf-8-bom' }, {
				chunkBytes: 2,
			}),
		);
		expect(chunks.every((chunk) => chunk.length <= 2)).toBe(true);
		const bytes = Uint8Array.from(chunks.flatMap((chunk) => [...chunk]));
		expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191]);
		expect(new TextDecoder().decode(bytes)).toBe('=1,é\nsecond,value\n');
		expect(write.spreadsheet('=1')).toBe("'=1");
		expect(write.spreadsheet('-12')).toBe('-12');
		expect(write.encode('€', 'windows-1252')).toEqual(new Uint8Array([128]));
		expect(() => write.encode('😀', 'windows-1252')).toThrow(write.EncodingError);
	});
	it('bounds bytes, cells and rows, and closes input after early return or failure', async () => {
		for (const opts of [{ maximumBytes: 1 }, { maximumRows: 1 }, { maximumCellCharacters: 1 }]) {
			let closed = false;
			const rows = async function* () {
				try {
					yield ['wide'];
					yield ['next'];
				} finally {
					closed = true;
				}
			};
			await expect(text(rows(), write.standard, opts)).rejects.toThrow(RangeError);
			expect(closed).toBe(true);
		}
		let closed = false;
		async function* rows() {
			try {
				yield ['first'];
				yield ['next'];
			} finally {
				closed = true;
			}
		}
		for await (const _ of write.serialize(rows())) break;
		expect(closed).toBe(true);
		await expect(text([['value']], write.standard, { signal: AbortSignal.abort('stop') })).rejects.toBe('stop');
	});
});
