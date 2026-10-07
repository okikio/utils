import { bench, do_not_optimize, group } from 'mitata';

import * as css from '@okikio/css';
import * as csv from '@okikio/csv';
import * as html from '@okikio/html';
import * as robots from '@okikio/robots';
import * as sitemap from '@okikio/sitemap';

const crm = [
	'Company,Domain,Homepage',
	...Array.from(
		{ length: 1_000 },
		(_, index) => `Company ${index},company-${index}.example,https://company-${index}.example`,
	),
].join('\n');
const robotsText =
	'User-agent: *\nDisallow: /private/\nAllow: /private/pricing\nSitemap: https://example.com/sitemap.xml\n';
const sitemapText = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
	Array.from({ length: 250 }, (_, index) => `<url><loc>https://example.com/page-${index}</loc></url>`).join('')
}</urlset>`;
const htmlText = `<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body>${
	Array.from({ length: 250 }, (_, index) => `<a href="/page-${index}">Page ${index}</a>`).join('')
}</body></html>`;
const cssText = Array.from(
	{ length: 250 },
	(_, index) => `.card-${index}{background-image:url('/images/${index}.webp')}`,
).join('\n');

/** Keep the composed fixture's parsing and policy results visible to the untimed oracle and benchmark sink. */
function discover(verify = false): readonly [number, boolean, number, number, number] {
	const document = csv.parse(crm);
	const policy = robots.parse(robotsText);
	const locations = sitemap.locations({
		url: 'https://example.com/sitemap.xml',
		contentType: 'application/xml',
		text: sitemapText,
	});
	const page = html.parse(htmlText);
	const links = html.selectAll(page.document, 'a[href]');
	const resources = css.parseResources(cssText);
	if (verify) {
		for (let index = 0; index < document.rows.length; index++) {
			const expected = [`Company ${index}`, `company-${index}.example`, `https://company-${index}.example`];
			if (
				document.rows[index]!.values.length !== expected.length ||
				!document.rows[index]!.values.every((value, column) => value === expected[column])
			) {
				throw new Error(`CRM values changed at ${index}.`);
			}
		}
		const expectedUrls = new Set(Array.from({ length: 250 }, (_, index) => `https://example.com/page-${index}`));
		if (!locations.every((value) => expectedUrls.delete(value)) || expectedUrls.size !== 0) {
			throw new Error('Sitemap lost or duplicated a URL.');
		}
		for (let index = 0; index < links.length; index++) {
			if (
				html.attribute(links[index]!, 'href') !== `/page-${index}` || resources[index]?.url !== `/images/${index}.webp`
			) throw new Error(`HTML/CSS discovery changed at ${index}.`);
		}
		if (robots.match(policy, { userAgent: 'KaijuResearchBot', url: 'https://example.com/private/secrets' })) {
			throw new Error('Robots policy allowed a denied path.');
		}
	}
	return [
		document.rows.length,
		robots.match(policy, { userAgent: 'KaijuResearchBot', url: 'https://example.com/private/pricing' }),
		locations.length,
		links.length,
		resources.length,
	];
}

const initial = discover(true);
if (initial[0] !== 1_000 || initial[1] !== true || initial[2] !== 250 || initial[3] !== 250 || initial[4] !== 250) {
	throw new Error('Discovery benchmark fixture did not preserve its documented records and resources.');
}

group('discovery composition', () => {
	bench('1k CRM rows + robots + 250 sitemap URLs + HTML/CSS discovery', () => {
		do_not_optimize(discover());
	}).gc('once');
});
