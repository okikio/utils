import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import { getSitemapUrls, match, parse } from '#/mod.ts';

describe('@okikio/robots parsing', () => {
	it('parses sitemap directives and preserves extension records', () => {
		const document = parse('User-agent: *\nDisallow: /private\nSitemap: https://example.com/sitemap.xml\nCrawl-delay: 2');
		expect(getSitemapUrls(document)).toEqual(['https://example.com/sitemap.xml']);
		expect(document.extensions).toEqual([{ field: 'crawl-delay', value: '2', line: 4 }]);
	});

	it('strips comments, normalizes directive names, and groups consecutive user agents', () => {
		const document = parse(`
USER-AGENT: AlphaBot # primary crawler
User-Agent: BetaBot
Disallow: /private # keep private
`);

		expect(document.groups).toEqual([{
			userAgents: ['alphabot', 'betabot'],
			rules: [{ kind: 'disallow', pattern: '/private', line: 4 }],
		}]);
	});

	it('keeps only absolute HTTP Sitemap URLs and removes duplicates', () => {
		const document = parse(`
Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap.xml
Sitemap: http://example.com/secondary.xml
Sitemap: /relative.xml
Sitemap: ftp://example.com/archive.xml
`);

		expect(getSitemapUrls(document)).toEqual([
			'https://example.com/sitemap.xml',
			'http://example.com/secondary.xml',
		]);
	});

	it('treats rules before the first user-agent as wildcard policy', () => {
		const document = parse('Disallow: /private\n');
		expect(match(document, { userAgent: 'AnyBot', url: 'https://example.com/private/a' })).toBe(false);
	});
});

describe('@okikio/robots matching', () => {
	it('uses longest-match precedence and Allow on equal length', () => {
		const document = parse('User-agent: *\nDisallow: /private\nAllow: /private/public\n');
		expect(match(document, { userAgent: 'ExampleBot', url: 'https://example.com/private/a' })).toBe(false);
		expect(match(document, { userAgent: 'ExampleBot', url: 'https://example.com/private/public/a' })).toBe(true);
	});

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

	it('combines groups with the same user-agent specificity', () => {
		const document = parse(`
User-agent: KaijuBot
Disallow: /private

User-agent: KaijuBot
Allow: /private/public
`);
		expect(match(document, { userAgent: 'KaijuBot/1.0', url: 'https://example.com/private/a' })).toBe(false);
		expect(match(document, { userAgent: 'KaijuBot/1.0', url: 'https://example.com/private/public/a' })).toBe(true);
	});

	it('supports wildcard segments and a terminal anchor against pathname plus query', () => {
		const document = parse(`
User-agent: *
Disallow: /search*private$
Disallow: /*?preview=1$
`);
		expect(match(document, { userAgent: 'Bot', url: 'https://example.com/search/a/private' })).toBe(false);
		expect(match(document, { userAgent: 'Bot', url: 'https://example.com/search/a/private/more' })).toBe(true);
		expect(match(document, { userAgent: 'Bot', url: 'https://example.com/page?preview=1' })).toBe(false);
		expect(match(document, { userAgent: 'Bot', url: 'https://example.com/page?preview=1&mode=full' })).toBe(true);
	});

	it('allows by default when no group or non-empty rule matches', () => {
		const noMatch = parse('User-agent: OtherBot\nDisallow: /\n');
		expect(match(noMatch, { userAgent: 'KaijuBot', url: 'https://example.com/private' })).toBe(true);

		const emptyDisallow = parse('User-agent: *\nDisallow:\n');
		expect(match(emptyDisallow, { userAgent: 'KaijuBot', url: 'https://example.com/private' })).toBe(true);
	});
});
