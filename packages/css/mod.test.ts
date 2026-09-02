import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as css from './mod.ts';

describe('@okikio/css', () => {
	it('classifies stylesheet resources by CSS context', () => {
		const parsed = css.parse(`
			@import "theme.css";
			@font-face { font-family: Brand; src: url("brand.woff2") format("woff2"); }
			.hero { background-image: url(hero.webp); cursor: url(cursor.png), auto; }
			.data { --endpoint: url(api.json); }
		`);

		expect(css.resources(parsed).map((reference) => [reference.kind, reference.url])).toEqual([
			['import', 'theme.css'],
			['font', 'brand.woff2'],
			['image', 'hero.webp'],
			['image', 'cursor.png'],
			['other', 'api.json'],
		]);
	});

	it('parses inline declaration lists without a URL regex', () => {
		const references = css.parseResources(
			`background: image-set(url("one.webp") 1x, url(two.webp) 2x); color: red`,
			{ context: 'declarationList' },
		);

		expect(references.map((reference) => reference.url)).toEqual(['one.webp', 'two.webp']);
		expect(references.every((reference) => reference.kind === 'image')).toBe(true);
	});

	it('extracts custom properties and accessibility-related CSS syntax from the AST', () => {
		const parsed = css.parse(`
			:root { --brand-color: red; --brand-color: blue; --spacing: 1rem; }
			@media (prefers-reduced-motion: reduce) { .motion { animation: none; } }
			@media (forced-colors: active) { button:focus-visible { outline: 2px solid; } }
		`);

		expect(css.customProperties(parsed)).toEqual(['--brand-color', '--spacing']);
		expect(css.mediaFeatures(parsed)).toEqual(['prefers-reduced-motion', 'forced-colors']);
		expect(css.pseudoClasses(parsed)).toContain('focus-visible');
	});

	it('retains recoverable parse problems while preserving the parsed block', () => {
		const parsed = css.parse('{a: 1!; foo; background: url(ok.webp)}', { context: 'block' });

		expect(css.resources(parsed).some((reference) => reference.url === 'ok.webp')).toBe(true);
		expect(parsed.problems).toHaveLength(2);
		expect(parsed.problems.map((problem) => problem.message)).toEqual([
			'Identifier is expected',
			'Colon is expected',
		]);
	});
});
