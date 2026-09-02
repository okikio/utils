import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import { getSitemapUrls, match, parse } from '#/mod.ts';

describe('@okikio/robots', () => {
	it('parses sitemap directives and preserves extension records', () => {
		const document = parse('User-agent: *\nDisallow: /private\nSitemap: https://example.com/sitemap.xml\nCrawl-delay: 2');
		expect(getSitemapUrls(document)).toEqual(['https://example.com/sitemap.xml']);
		expect(document.extensions).toEqual([{ field: 'crawl-delay', value: '2', line: 4 }]);
	});

	it('uses longest-match precedence and Allow on equal length', () => {
		const document = parse('User-agent: *\nDisallow: /private\nAllow: /private/public\n');
		expect(match(document, { userAgent: 'ExampleBot', url: 'https://example.com/private/a' })).toBe(false);
		expect(match(document, { userAgent: 'ExampleBot', url: 'https://example.com/private/public/a' })).toBe(true);
	});
});

describe('robots matching specificity', () => {
	it('does not combine wildcard rules with a more-specific matching group', () => {
		const document = parse(`
User-agent: *
Disallow: /private

User-agent: KaijuBot
Allow: /
`);
		expect(match(document, { userAgent: 'KaijuBot/1.0', url: 'https://example.com/private' })).toBe(true);
		expect(match(document, { userAgent: 'OtherBot/1.0', url: 'https://example.com/private' })).toBe(false);
	});
});
