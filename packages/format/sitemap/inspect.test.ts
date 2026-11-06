import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { inspect, parse, parseStream } from './mod.ts';

const limits = { maximumCodeUnits: 100_000, maximumRecords: 2, maximumUrlLength: 200, maximumProblems: 4 };
const source = (text: string) => ({ text, url: 'https://example.com/sitemap.xml' });
describe('complete sitemap evidence', () => {
	it('distinguishes a valid empty document from malformed XML and rejects DOCTYPE', () => {
		const empty = inspect(source('<urlset/>'), limits);
		expect(empty.records).toEqual([]);
		expect(empty.problems).toEqual([]);
		expect(empty.capped).toBe(false);
		const malformed = inspect(source('<urlset><url>'), limits);
		expect(malformed.problems[0]?.code).toBe('malformed_xml');
		expect(parse(source('<urlset><url>'))).toEqual([]);
		expect(inspect(source('<!DOCTYPE urlset><urlset/>'), limits).problems[0]?.code).toBe('doctype_not_allowed');
	});
	it('bounds distinct records while merging repeated locations and reports URL/input limits', () => {
		const text = '<urlset>' +
			['a', 'a', 'b', 'c'].map((id) => `<url><loc>https://example.com/${id}</loc></url>`).join('') + '</urlset>';
		const result = inspect(source(text), limits);
		expect(result.records.map((record) => record.loc)).toEqual(['https://example.com/a', 'https://example.com/b']);
		expect(result.capped).toBe(true);
		expect(result.problems[0]?.code).toBe('record_limit');
		expect(inspect(source(text), { ...limits, maximumUrlLength: 4 }).problems[0]?.code).toBe('url_limit');
		expect(inspect(source(text), { ...limits, maximumCodeUnits: text.length - 1 }).problems[0]?.code).toBe(
			'input_limit',
		);
		expect(inspect(source('<urlset/>'), { ...limits, maximumCodeUnits: 9 }).capped).toBe(false);
	});
	it('bounds text diagnostics and preserves unsupported-format and namespace evidence', () => {
		const result = inspect({ text: '# a\n# b\n# c\nhttps://example.com/a', url: 'https://example.com/urls.txt' }, {
			...limits,
			maximumProblems: 1,
		});
		expect(result.problems.length).toBe(1);
		expect(result.records.length).toBe(1);
		expect(result.capped).toBe(true);
		expect(inspect({ text: 'plain words', url: 'https://example.com/unknown' }, limits).problems[0]?.code).toBe(
			'unsupported_format',
		);
		expect(inspect(source('<urlset xmlns="urn:wrong"/>'), { ...limits, maximumProblems: 0 }).capped).toBe(true);
	});
	it('validates finite policy before parsing', () => {
		for (const maximumRecords of [-1, .5, Infinity, NaN]) {
			expect(() => inspect(source('<urlset/>'), { ...limits, maximumRecords })).toThrow(TypeError);
		}
	});
});

it('keeps duplicate-heavy retained identity bounded and streams repeated records with serial callbacks', async () => {
	const count = 10000;
	const text = '<urlset>' + ('<url><loc>https://example.com/repeated</loc></url>'.repeat(count)) + '</urlset>';
	const result = inspect(source(text), { ...limits, maximumCodeUnits: text.length, maximumRecords: 1 });
	expect(result.records).toHaveLength(1);
	expect(result.capped).toBe(false);
	const bytes = new TextEncoder().encode(text);
	let offset = 0, seen = 0, active = 0;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (offset === bytes.length) {
				controller.close();
				return;
			}
			const end = Math.min(offset + 1024, bytes.length);
			controller.enqueue(bytes.subarray(offset, end));
			offset = end;
		},
	});
	const parsed = await parseStream({
		stream,
		url: source(text).url,
		maxBytes: bytes.length,
		maximumProblems: 1,
		async onRecord() {
			active++;
			expect(active).toBe(1);
			await Promise.resolve();
			seen++;
			active--;
		},
	});
	expect(seen).toBe(count);
	expect(parsed.capped).toBe(false);
	expect(stream.locked).toBe(false);
});
it('bounds repetitive streaming diagnostics independently from emitted records and validates before acquisition', async () => {
	const bytes = new TextEncoder().encode('# comment\n'.repeat(10000) + 'https://example.com/item');
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
	let seen = 0;
	const parsed = await parseStream({
		stream,
		url: 'https://example.com/urls.txt',
		maxBytes: bytes.length,
		maximumProblems: 2,
		onRecord() {
			seen++;
		},
	});
	expect(parsed.problems).toHaveLength(2);
	expect(parsed.capped).toBe(true);
	expect(seen).toBe(1);
	expect(stream.locked).toBe(false);
	const idle = new ReadableStream<Uint8Array>();
	await expect(parseStream({ stream: idle, url: 'https://example.com/urls.txt', maximumProblems: -1, onRecord() {} }))
		.rejects.toBeInstanceOf(RangeError);
	expect(idle.locked).toBe(false);
	await idle.cancel();
});
