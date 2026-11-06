import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as schema from '@okikio/schema';
import { parse, parseStream } from './mod.ts';
import { CsvRowError, rows } from './validate.ts';
import type { RowOptionsType } from './validate.ts';
const options: RowOptionsType = {
	columns: { name: 1 },
	maximumColumns: 2,
	maximumRows: 10,
	maximumIssues: 1,
	maximumPathLength: 4,
	onInvalid: 'yield',
};
describe('typed CSV row validation', () => {
	it('maps duplicate headers by exact position and preserves multiline logical records', async () => {
		const document = parse('Name,Name\nwrong,"right\nsecond line"\n', { headerRow: 1 });
		const Definition = schema.object({ name: schema.string() });
		expect(await Array.fromAsync(rows(Definition, document.rows, options))).toEqual([
			{ kind: 'value', row: 2, value: { name: 'right\nsecond line' } },
		]);
	});
	it('bounds issue reports and maps schema fields to source columns without hiding defects', async () => {
		const Definition = schema.object({ name: schema.number(), extra: schema.string() });
		const [failure] = await Array.fromAsync(rows(Definition, parse('a,b\nx,y', { headerRow: 1 }).rows, options));
		expect(failure?.kind).toBe('schema');
		if (failure?.kind !== 'schema') throw new Error('Expected schema failure.');
		expect(failure.issues.length).toBe(1);
		expect(failure.issues[0]?.column).toBe(2);
		expect(failure.truncated).toBe(true);
		const defect = new Error('validator defect');
		const broken = schema.defineAsync(async () => {
			throw defect;
		});
		await expect(Array.fromAsync(rows(broken, parse('a,b\nx,y', { headerRow: 1 }).rows, options))).rejects.toBe(defect);
	});
	it('distinguishes missing columns, explicit skip and fail-fast policy, and closes partial sources', async () => {
		const Definition = schema.object({ name: schema.string() });
		const input = parse('a,b\nx,y\nz', { headerRow: 1 }).rows;
		expect((await Array.fromAsync(rows(Definition, input, options)))[1]).toEqual({
			kind: 'mapping',
			row: 3,
			missing: ['name'],
		});
		expect((await Array.fromAsync(rows(Definition, input, { ...options, onInvalid: 'skip' }))).length).toBe(1);
		await expect(Array.fromAsync(rows(Definition, input, { ...options, onInvalid: 'throw' }))).rejects.toBeInstanceOf(
			CsvRowError,
		);
		let closed = 0;
		async function* source() {
			try {
				yield* input;
			} finally {
				closed++;
			}
		}
		for await (const value of rows(Definition, source(), options)) {
			expect(value.kind).toBe('value');
			break;
		}
		expect(closed).toBe(1);
		await expect(Array.fromAsync(rows(Definition, input, { ...options, maximumRows: 1 }))).rejects.toThrow(RangeError);
	});
	it('composes the owned streaming parser with async validation and releases its reader on early return', async () => {
		const encoder = new TextEncoder();
		let cancelled = 0;
		let calls = 0;
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode('a,b\nx,y\nz,w\n'));
			},
			cancel() {
				cancelled++;
			},
		});
		await using document = await parseStream(source, {
			delimiter: ',',
			encoding: 'utf-8',
			headerRow: 1,
			headerScanRows: 1,
		});
		const Definition = schema.defineAsync(async (value) => {
			calls++;
			await Promise.resolve();
			return value;
		});
		for await (const value of rows(Definition, document.rows, options)) {
			expect(value.row).toBe(2);
			break;
		}
		await document.cleanup;
		expect(calls).toBe(1);
		expect(source.locked).toBe(false);
		expect(cancelled).toBe(1);
	});
});
