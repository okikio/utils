import { bench, do_not_optimize, group, run } from 'mitata';

import * as css from '@okikio/css';
import * as csv from '@okikio/csv';
import * as html from '@okikio/html';
import * as robots from '@okikio/robots';
import * as sitemap from '@okikio/sitemap';

const crm = [
	'Company,Domain,Homepage',
	...Array.from({ length: 1_000 }, (_, index) => `Company ${index},company-${index}.example,https://company-${index}.example`),
].join('\n');
const robotsText = 'User-agent: *\nDisallow: /private/\nAllow: /private/pricing\nSitemap: https://example.com/sitemap.xml\n';
const sitemapText = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from({ length: 250 }, (_, index) => `<url><loc>https://example.com/page-${index}</loc></url>`).join('')}</urlset>`;
const htmlText = `<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body>${Array.from({ length: 250 }, (_, index) => `<a href="/page-${index}">Page ${index}</a>`).join('')}</body></html>`;
const cssText = Array.from({ length: 250 }, (_, index) => `.card-${index}{background-image:url('/images/${index}.webp')}`).join('\n');

group('discovery composition', () => {
	bench('1k CRM rows + robots + 250 sitemap URLs + HTML/CSS discovery', () => {
		const document = csv.parse(crm);
		const policy = robots.parse(robotsText);
		const locations = sitemap.locations({ url: 'https://example.com/sitemap.xml', contentType: 'application/xml', text: sitemapText });
		const page = html.parse(htmlText);
		const links = html.selectAll(page.document, 'a[href]');
		const resources = css.parseResources(cssText);
		do_not_optimize([document.rows.length, robots.match(policy, { userAgent: 'KaijuResearchBot', url: 'https://example.com/private/pricing' }), locations.length, links.length, resources.length]);
	}).gc('once');
});

await run();
