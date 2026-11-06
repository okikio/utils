// @benchmark register-only
import { bench, do_not_optimize, group } from 'mitata';

import * as csv from '@okikio/format/csv';
import * as sitemap from '@okikio/format/sitemap';

const crm = [
	'Company,Domain,Homepage',
	...Array.from(
		{ length: 1_000 },
		(_, index) => `Company ${index},company-${index}.example,https://company-${index}.example`,
	),
].join('\n');
const sitemapText = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
	Array.from({ length: 250 }, (_, index) => `<url><loc>https://example.com/page-${index}</loc></url>`).join('')
}</urlset>`;
/** Keep the composed fixture's parsing results visible to the untimed oracle and benchmark sink. */
function discover(verify = false): readonly [number, number] {
	const document = csv.parse(crm);
	const locations = sitemap.locations({
		url: 'https://example.com/sitemap.xml',
		contentType: 'application/xml',
		text: sitemapText,
	});
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
	}
	return [document.rows.length, locations.length];
}

const initial = discover(true);
if (initial[0] !== 1_000 || initial[1] !== 250) {
	throw new Error('Discovery benchmark fixture did not preserve its documented records.');
}

group('discovery composition', () => {
	bench('1k CRM rows + 250 sitemap URLs', () => {
		do_not_optimize(discover());
	}).gc('once');
});
