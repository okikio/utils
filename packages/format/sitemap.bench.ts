/** Complete parsing pays for an XML tree; streaming pays for incremental callbacks and owned cleanup. */
import { bench, do_not_optimize, group } from 'mitata';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { run } from './fixtures/bench.ts';
import * as sitemap from '@okikio/format/sitemap';
for (const count of [1, 1_000, 10_000]) {
	const text = '<urlset>' + Array.from({ length: count }, (_, index) =>
		`<url><loc>https://example.com/${index}</loc></url>`).join('') +
		'</urlset>';
	const input = { text, url: 'https://example.com/sitemap.xml' };
	const limits = { maximumCodeUnits: text.length, maximumRecords: count, maximumUrlLength: 200, maximumProblems: 8 };
	const result = sitemap.inspect(input, limits);
	const expected = Array.from({ length: count }, (_, index) => `https://example.com/${index}`);
	deepStrictEqual(result.records.map((record) => record.loc), expected);
	if (result.records.length !== count || result.capped || result.problems.length) {
		throw new Error('Sitemap fixture failed.');
	}
	const bytes = new TextEncoder().encode(text);
	/** Create a fresh byte stream for each run; retain callback values only in the untimed check. */
	const stream = async function (verify = false): Promise<number> {
		let seen = 0;
		let offset = 0;
		const locations: string[] | undefined = verify ? [] : undefined;
		const source = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (offset === bytes.length) return controller.close();
				const end = Math.min(offset + 4096, bytes.length);
				controller.enqueue(bytes.subarray(offset, end));
				offset = end;
			},
		});
		const parsed = await sitemap.parseStream({
			stream: source,
			url: input.url,
			maxBytes: bytes.length,
			onRecord(record) {
				seen++;
				locations?.push(record.loc);
			},
		});
		if (verify) {
			strictEqual(seen, count);
			strictEqual(parsed.problems.length, 0);
			strictEqual(parsed.capped, false);
			deepStrictEqual(locations, expected);
			strictEqual(source.locked, false);
		}
		return seen;
	};
	await stream(true);
	group(`sitemap ${count} distinct locations: ${bytes.length} UTF-8 bytes`, () => {
		bench('complete inspection retaining records', () => {
			do_not_optimize(sitemap.inspect(input, limits));
		});
		bench('streamed callbacks, no retained records', async () => {
			do_not_optimize(await stream());
		});
	});
}

for (const count of [1000, 10000]) {
	const text = '<urlset>' + ('<url><loc>https://example.com/repeated</loc></url>'.repeat(count)) + '</urlset>';
	const input = { text, url: 'https://example.com/sitemap.xml' };
	const limits = { maximumCodeUnits: text.length, maximumRecords: 1, maximumUrlLength: 200, maximumProblems: 2 };
	if (sitemap.inspect(input, limits).records.length !== 1) throw new Error('Duplicate retention oracle failed.');
	group(`duplicate-heavy complete XML ${count}, one retained identity`, () => {
		bench('bounded identity merging with complete XML tree', () => do_not_optimize(sitemap.inspect(input, limits)));
	});
}
await run();
