import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import { SaxesParser, type SaxesTagNS } from 'saxes';

import { parse, type SitemapRecord } from './index.ts';

const SITEMAP_NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9';

/**
 * Saxes remains a test-only namespace oracle until the @std/xml adapter passes
 * the live Deno conformance gate. Production code does not import Saxes.
 */
describe('@std/xml sitemap namespace differential', () => {
	for (const fixture of [
		{
			name: 'default namespace',
			xml: '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/default</loc></url></urlset>',
		},
		{
			name: 'prefixed namespace',
			xml: '<sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"><sm:url><sm:loc>https://example.com/prefixed</sm:loc></sm:url></sm:urlset>',
		},
		{
			name: 'extension namespace loc',
			xml: '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><loc>https://example.com/page</loc><image:image><image:loc>https://cdn.example.com/image.jpg</image:loc></image:image></url></urlset>',
		},
		{
			name: 'default namespace shadowing',
			xml: '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url xmlns="urn:not-sitemap"><loc>https://example.com/rejected</loc></url><url><loc>https://example.com/accepted</loc></url></urlset>',
		},
		{
			name: 'entity decoding',
			xml: '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/?a=1&amp;b=2</loc></url></urlset>',
		},
		{
			name: 'CDATA route location',
			xml: '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc><![CDATA[https://example.com/cdata]]></loc></url></urlset>',
		},
		{
			name: 'comments and processing instructions',
			xml: '<?xml version="1.0"?><?kaiju test?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><!-- comment --><url><loc>https://example.com/pi</loc></url></urlset>',
		},
		{
			name: 'unbound qualified name rejection',
			xml: '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><missing:loc>https://example.com/rejected</missing:loc></url></urlset>',
		},
		{
			name: 'DOCTYPE rejection',
			xml: '<!DOCTYPE urlset><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/rejected</loc></url></urlset>',
		},
	]) {
		it(`matches Saxes for ${fixture.name}`, () => {
			expect(parse({
				url: 'https://example.com/sitemap.xml',
				contentType: 'application/xml',
				policy: 'standards',
				text: fixture.xml,
			})).toEqual(parseWithSaxes(fixture.xml));
		});
	}

	it('retains XHTML hreflang while using the Sitemap namespace for route fields', () => {
		const xml = `<urlset xmlns="${SITEMAP_NAMESPACE}" xmlns:xhtml="http://www.w3.org/1999/xhtml">
			<url><loc>https://example.com/en</loc><xhtml:link rel="alternate" hreflang="fr" href="https://example.com/fr"/></url>
		</urlset>`;
		expect(parse({
			url: 'https://example.com/sitemap.xml',
			policy: 'standards',
			text: xml,
		})).toEqual(parseWithSaxes(xml));
	});
});

function parseWithSaxes(xml: string): readonly SitemapRecord[] {
	const parser = new SaxesParser({ xmlns: true });
	const records: SitemapRecord[] = [];
	let current: { kind: 'url' | 'sitemap'; loc?: string; alternates: { href: string; hreflang: string }[] } | undefined;
	let captureLoc = false;
	let text = '';
	let failed = false;
	parser.on('error', () => { failed = true; });
	parser.on('doctype', () => { failed = true; });
	parser.on('opentag', (tag: SaxesTagNS) => {
		if (failed) return;
		if (isSitemap(tag, 'url')) current = { kind: 'url', alternates: [] };
		else if (isSitemap(tag, 'sitemap')) current = { kind: 'sitemap', alternates: [] };
		if (current && isSitemap(tag, 'loc')) {
			captureLoc = true;
			text = '';
			return;
		}
		if (!current || tag.local.toLowerCase() !== 'link') return;
		const href = attribute(tag, 'href');
		const rel = attribute(tag, 'rel')?.toLowerCase();
		const hreflang = attribute(tag, 'hreflang')?.toLowerCase();
		if (href && rel === 'alternate' && hreflang) current.alternates.push({ href, hreflang });
	});
	parser.on('text', (value: string) => { if (captureLoc) text += value; });
	parser.on('cdata', (value: string) => { if (captureLoc) text += value; });
	parser.on('closetag', (tag: SaxesTagNS) => {
		if (failed) return;
		if (captureLoc && isSitemap(tag, 'loc')) {
			current!.loc = text.trim();
			captureLoc = false;
		}
		if (!current?.loc || (!isSitemap(tag, 'url') && !isSitemap(tag, 'sitemap'))) return;
		records.push(current.kind === 'sitemap'
			? { kind: 'sitemap', loc: current.loc, format: 'xml', alternates: current.alternates }
			: { kind: 'url', loc: current.loc, format: 'xml', alternates: current.alternates });
		current = undefined;
	});
	try {
		parser.write(xml).close();
	} catch {
		failed = true;
	}
	return failed ? [] : records;
}

function isSitemap(tag: SaxesTagNS, local: string): boolean {
	return tag.local.toLowerCase() === local && tag.uri === SITEMAP_NAMESPACE;
}

function attribute(tag: SaxesTagNS, local: string): string | undefined {
	for (const entry of Object.values(tag.attributes)) {
		const value = entry as { readonly local?: string; readonly value?: string } | string;
		if (typeof value !== 'string' && value.local?.toLowerCase() === local) return value.value;
	}
	return undefined;
}
