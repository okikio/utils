import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as html from './mod.ts';

describe('@okikio/html', () => {
	it('uses HTML parsing rules instead of XML-like source structure', () => {
		const parsed = html.parse('<table><tr><td>one<td>two</table>');
		const cells = html.selectAll(parsed.document, 'table > tbody > tr > td');

		expect(cells).toHaveLength(2);
		expect(html.text(cells[0]!)).toBe('one');
		expect(html.text(cells[1]!)).toBe('two');
	});

	it('supports CSS selectors and source locations on the same parsed tree', () => {
		const parsed = html.parse('<main>\n<a id="pricing" href="/pricing">Plans</a>\n</main>');
		const link = html.selectOne(parsed.document, '#pricing[href]');

		expect(link).not.toBeNull();
		expect(html.attribute(link!, 'href')).toBe('/pricing');
		expect(html.location(link!)?.startLine).toBe(2);
		expect(html.matches(link!, 'main > a#pricing')).toBe(true);
	});

	it('reports non-fatal parser problems without rejecting the parsed document', () => {
		const parsed = html.parse('<html><body><div a="1" a="2">content</div></body></html>');

		expect(html.selectOne(parsed.document, 'div')).not.toBeNull();
		expect(parsed.problems.some((problem) => problem.code === 'duplicate-attribute')).toBe(true);
	});
});
