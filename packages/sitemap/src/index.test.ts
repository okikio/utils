import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import { locations, parse, parseStream, type SitemapProblem, type SitemapRecord } from './index.ts';

describe('@okikio/sitemap', () => {
	it('parses URL sets, freshness, priority, change frequency, and hreflang', () => {
		expect(parse({
			url: 'https://example.com/sitemap.xml',
			contentType: 'application/xml',
			text: `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"><url><loc>https://example.com/en</loc><lastmod>2026-08-12</lastmod><changefreq>weekly</changefreq><priority>0.8</priority><xhtml:link rel="alternate" hreflang="fr" href="https://example.com/fr"/></url></urlset>`,
		})).toEqual([{
			kind: 'url', loc: 'https://example.com/en', format: 'xml', lastModified: '2026-08-12',
			changeFrequency: 'weekly', priority: 0.8, alternates: [{ href: 'https://example.com/fr', hreflang: 'fr' }],
		}]);
	});

	it('only sitemap-index positions create child sitemap records', () => {
		expect(parse({ url: 'https://example.com/index.xml', text: '<sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap></sitemapindex>' })[0]?.kind).toBe('sitemap');
		expect(parse({ url: 'https://example.com/routes.xml', text: '<urlset><url><loc>https://example.com/a.xml</loc></url></urlset>' })[0]?.kind).toBe('url');
	});

	it('excludes image/video extension locations from page routes', () => {
		expect(locations({
			url: 'https://example.com/routes.xml',
			text: '<urlset xmlns:image="urn:image"><url><loc>https://example.com/page</loc><image:image><image:loc>https://example.com/image.jpg</image:loc></image:image></url></urlset>',
		})).toEqual(['https://example.com/page']);
	});

	it('streams large sources one record at a time', async () => {
		const text = `<urlset>${Array.from({ length: 1000 }, (_, index) => `<url><loc>https://example.com/${index}</loc></url>`).join('')}</urlset>`;
		const bytes = new TextEncoder().encode(text);
		const records: string[] = [];
		const result = await parseStream({
			stream: new ReadableStream({ start(controller) { for (let offset = 0; offset < bytes.length; offset += 127) controller.enqueue(bytes.slice(offset, offset + 127)); controller.close(); } }),
			url: 'https://example.com/routes.xml',
			onRecord: (record: SitemapRecord) => { records.push(record.loc); },
		});
		expect(result.capped).toBe(false);
		expect(records).toHaveLength(1000);
	});


	it('streams the protocol maximum entry count without retaining an entry inventory', async () => {
		const encoder = new TextEncoder();
		const total = 50_000;
		let next = 0;
		let seen = 0;
		const stream = new ReadableStream<Uint8Array<ArrayBufferLike>>({
			start(controller) {
				controller.enqueue(encoder.encode('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
			},
			pull(controller) {
				if (next >= total) {
					controller.enqueue(encoder.encode('</urlset>'));
					controller.close();
					return;
				}
				const end = Math.min(total, next + 250);
				let chunk = '';
				for (; next < end; next += 1) chunk += `<url><loc>https://example.com/${next}</loc></url>`;
				controller.enqueue(encoder.encode(chunk));
			},
		});
		const result = await parseStream({
			stream,
			url: 'https://example.com/sitemap.xml',
			onRecord: () => { seen += 1; },
		});
		expect(result.capped).toBe(false);
		expect(seen).toBe(total);
	});


	it('does not skip source chunks after the format prefix is consumed', async () => {
		const chunks = [
			'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
			'<url><loc>https://example.com/one</loc></url>',
			'<url><loc>https://example.com/two</loc></url>',
			'<url><loc>https://example.com/three</loc></url>',
			'</urlset>',
		];
		const encoder = new TextEncoder();
		const records: SitemapRecord[] = [];
		await parseStream({
			stream: new ReadableStream<Uint8Array<ArrayBufferLike>>({
				start(controller) {
					for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
					controller.close();
				},
			}),
			url: 'https://example.com/sitemap.xml',
			policy: 'standards',
			onRecord: (record: SitemapRecord) => { records.push(record); },
		});
		expect(records.map((record) => record.loc)).toEqual([
			'https://example.com/one',
			'https://example.com/two',
			'https://example.com/three',
		]);
	});

	it('propagates downstream record-consumer failures instead of relabeling them as XML syntax problems', async () => {
		const error = new Error('candidate store unavailable');
		const stream = new Blob([
			'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/one</loc></url></urlset>',
		]).stream();
		await expect(parseStream({
			stream,
			url: 'https://example.com/sitemap.xml',
			policy: 'standards',
			onRecord: () => { throw error; },
		})).rejects.toBe(error);
	});

	it('propagates cancellation instead of reporting malformed XML', async () => {
		const controller = new AbortController();
		const reason = new DOMException('discovery cancelled', 'AbortError');
		const stream = new ReadableStream<Uint8Array<ArrayBufferLike>>({
			start(streamController) {
				streamController.enqueue(new TextEncoder().encode(
					'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/one</loc></url>',
				));
			},
		});
		controller.abort(reason);
		await expect(parseStream({
			stream,
			url: 'https://example.com/sitemap.xml',
			signal: controller.signal,
			onRecord: () => undefined,
		})).rejects.toBe(reason);
	});

	it('keeps Atom navigation metadata out of the page-route stream', async () => {
		const records: SitemapRecord[] = [];
		const feed = `<feed xmlns="http://www.w3.org/2005/Atom">
			<link rel="self" href="https://example.com/feed.atom"/>
			<link rel="next" href="https://example.com/feed.atom?page=2"/>
			<entry><link href="https://example.com/article"/></entry>
		</feed>`;
		await parseStream({
			stream: new Blob([feed]).stream(),
			url: 'https://example.com/feed.atom',
			onRecord: (record: SitemapRecord) => { records.push(record); },
		});
		expect(records.map((record) => record.loc)).toEqual(['https://example.com/article']);
	});

	it('reports a standards-mode Sitemap namespace mismatch explicitly', async () => {
		const records: SitemapRecord[] = [];
		const result = await parseStream({
			stream: new Blob(['<urlset xmlns="urn:not-sitemaps"><url><loc>https://example.com/ignored</loc></url></urlset>']).stream(),
			url: 'https://example.com/sitemap.xml',
			policy: 'standards',
			onRecord: (record: SitemapRecord) => { records.push(record); },
		});
		expect(records).toEqual([]);
		expect(result.problems).toEqual([{
			code: 'unexpected_sitemap_namespace',
			message: 'Expected Sitemap namespace http://www.sitemaps.org/schemas/sitemap/0.9, received urn:not-sitemaps.',
		}]);
	});

	it('rejects DOCTYPE input as a problem and does not emit attacker-defined entity URLs', async () => {
		const text = '<!DOCTYPE urlset [<!ENTITY xxe "https://attacker.example/">]><urlset><url><loc>&xxe;</loc></url></urlset>';
		const bytes = new TextEncoder().encode(text);
		const records: string[] = [];
		const result = await parseStream({ stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), url: 'https://example.com/sitemap.xml', onRecord: (record) => { records.push(record.loc); } });
		expect(records).toEqual([]);
		expect(result.problems.some((problem) => problem.code === 'doctype_not_allowed')).toBe(true);
	});
});

describe('streaming sitemap conformance regressions', () => {
	it('emits the final text URL without a trailing newline', async () => {
		const records: SitemapRecord[] = [];
		const bytes = new TextEncoder().encode('https://example.com/one\nhttps://example.com/two');
		await parseStream({
			stream: new Blob([bytes]).stream(),
			url: 'https://example.com/sitemap.txt',
			onRecord: (record: SitemapRecord) => { records.push(record); },
		});
		expect(records.map((record) => record.loc)).toEqual([
			'https://example.com/one',
			'https://example.com/two',
		]);
	});



	it('streams an ordinary default namespace correctly when every UTF-8 byte is split', async () => {
		const text = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/café</loc></url></urlset>';
		const bytes = new TextEncoder().encode(text);
		const records: SitemapRecord[] = [];
		const result = await parseStream({
			stream: new ReadableStream({
				start(controller) {
					for (let index = 0; index < bytes.byteLength; index += 1) controller.enqueue(bytes.slice(index, index + 1));
					controller.close();
				},
			}),
			url: 'https://example.com/sitemap.xml',
			policy: 'standards',
			onRecord: (record: SitemapRecord) => { records.push(record); },
		});
		expect(result.problems).toEqual([]);
		expect(records.map((record) => record.loc)).toEqual(['https://example.com/café']);
	});


	it('applies @std/xml depth and attribute limits to hostile XML', async () => {
		const deep = `${'<x>'.repeat(260)}${'</x>'.repeat(260)}`;
		const deepResult = await parseStream({
			stream: new Blob([deep]).stream(),
			url: 'https://example.com/sitemap.xml',
			onRecord: () => undefined,
		});
		expect(deepResult.problems.some((problem: SitemapProblem) => problem.code === 'malformed_xml')).toBe(true);

		const attributes = Array.from({ length: 4_097 }, (_, index) => ` a${index}="x"`).join('');
		const attributeResult = await parseStream({
			stream: new Blob([`<urlset${attributes}/>`]).stream(),
			url: 'https://example.com/sitemap.xml',
			onRecord: () => undefined,
		});
		expect(attributeResult.problems.some((problem: SitemapProblem) => problem.code === 'malformed_xml')).toBe(true);
	});

	it('selects XML 1.1 parsing from the document declaration before streaming', async () => {
		const text = '<?xml version="1.1"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><note>&#x1;</note><url><loc>https://example.com/xml11</loc></url></urlset>';
		const records: SitemapRecord[] = [];
		const result = await parseStream({
			stream: new Blob([text]).stream(),
			url: 'https://example.com/sitemap.xml',
			policy: 'standards',
			onRecord: (record: SitemapRecord) => { records.push(record); },
		});
		expect(result.problems).toEqual([]);
		expect(records.map((record) => record.loc)).toEqual(['https://example.com/xml11']);
	});

	it('reports a byte cap without converting the deliberate truncation into malformed XML', async () => {
		const text = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/one</loc></url><url><loc>https://example.com/two</loc></url></urlset>';
		const records: SitemapRecord[] = [];
		const result = await parseStream({
			stream: new Blob([text]).stream(),
			url: 'https://example.com/sitemap.xml',
			maxBytes: 115,
			onRecord: (record: SitemapRecord) => { records.push(record); },
		});
		expect(result.capped).toBe(true);
		expect(result.problems).toEqual([]);
		expect(records.map((record) => record.loc)).toEqual(['https://example.com/one']);
	});
	it('accepts a prefixed Sitemap namespace without treating image loc as a route', () => {
		const records = parse({
			url: 'https://example.com/sitemap.xml',
			text: `<?xml version="1.0"?>
				<sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
					<sm:url><sm:loc>https://example.com/page</sm:loc><image:image><image:loc>https://cdn.example.com/image.jpg</image:loc></image:image></sm:url>
				</sm:urlset>`,
		});
		expect(records.map((record) => record.loc)).toEqual(['https://example.com/page']);
	});
});
