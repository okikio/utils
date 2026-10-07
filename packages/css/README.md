# `@okikio/css`

Extract stylesheet dependencies and feature evidence through a CSS parser. A regular expression cannot reliably
distinguish a URL token from a quoted string, a comment or a nested rule.

## Run a complete example

```ts runnable
import * as css from '@okikio/css';
const source = '@import "theme.css"; .hero { background: url("hero.webp"); --accent: blue; }';
const parsed = css.parse(source);
console.log(JSON.stringify(css.resources(parsed).map((item) => item.url)));
console.log(JSON.stringify(css.customProperties(parsed)));
```

Expected output:

```text output
["theme.css","hero.webp"]
["--accent"]
```

## Build on the example

Extract URL references first, then collect custom properties, media features and pseudo classes from the same parsed
stylesheet. References retain source positions for diagnostics. Resolve relative URLs against the stylesheet URL in your
application. Parsing performs no network fetch and does not tell you whether a feature is supported by a particular
browser.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Purpose

`@okikio/css` turns CSS source into inspectable structure without starting a browser. It exposes parser problems,
external resources, custom properties, media features, pseudo-classes, and normalized source generation.

Use it when a collector or analysis package needs facts from CSS text. Fetching stylesheets, resolving URLs, executing
CSS in a browser, and assigning product meaning remain caller responsibilities.

## The ordinary problem

CSSTree already provides an excellent CSS parser. A caller can use it directly:

```ts
import { parse, walk } from 'css-tree';

const ast = parse(source, { positions: true });
const urls: string[] = [];

walk(ast, {
	visit: 'Url',
	enter(node) {
		urls.push(node.value);
	},
});
```

Real collectors usually need more than the raw URL value. They need stable resource kinds, source locations, recoverable
parse diagnostics, `@import` strings, and de-duplication. Repeating that adapter logic in every caller makes CSS
evidence disagree across the codebase.

## Use the utility

Parse once and ask focused questions of the same result:

```ts
import * as css from '@okikio/css';

const parsed = css.parse(
	`
  @import "theme.css";
  @font-face { src: url("brand.woff2"); }
  :root { --brand: #765; }
  .hero { background-image: url("hero.webp"); }
  @media (prefers-reduced-motion: reduce) { .card:hover { opacity: .8; } }
`,
	{ filename: 'app.css' },
);

console.log(css.resources(parsed));
console.log(css.customProperties(parsed)); // ['--brand']
console.log(css.mediaFeatures(parsed)); // ['prefers-reduced-motion']
console.log(css.pseudoClasses(parsed)); // ['hover']
console.log(parsed.problems); // recoverable parser diagnostics
```

`parseResources()` is the shorter path when resources are the only result the caller needs:

```ts
const resources = css.parseResources(source, { filename: 'app.css' });
```

Resource kinds distinguish `font`, `image`, `import`, and `other`. The package does not resolve those references against
a base URL because URL ownership belongs to the caller that knows the stylesheet location.

## Use with other utilities

Extract inline stylesheet dependencies from HTML, then resolve them against the page URL. This mirrors the source
analysis used by Kaiju Crawl before its application decides which resource to fetch.

```ts runnable=inline-resources.ts
import * as css from '@okikio/css';
import * as html from '@okikio/html';

const base = 'https://example.com/guide/';
const page = html.parse('<style>.hero { background: url("hero.webp"); }</style><link rel="stylesheet" href="app.css">');
const urls = new Set<string>();
for (const style of html.selectAll(page.document, 'style')) {
	for (const resource of css.parseResources(html.text(style))) {
		urls.add(new URL(resource.url, base).href);
	}
}
for (const link of html.selectAll(page.document, 'link[rel~="stylesheet"][href]')) {
	const href = html.attribute(link, 'href');
	if (href !== null) urls.add(new URL(href, base).href);
}
console.log(JSON.stringify([...urls]));
```

Expected output:

```text output
["https://example.com/guide/hero.webp","https://example.com/guide/app.css"]
```

`css.parseResources()` returns `readonly ResourceReference[]` immediately. The final value is a deduplicated `string[]`
of resolved URLs. Both utilities perform pure parsing and retain no timer, reader or network connection to close. The
application still owns fetch budgets, origin policy and how to respond to parser problems.

## Convenience and the manual equivalent

| Convenience       | Manual equivalent                                                              | Utility-owned invariant      |
| ----------------- | ------------------------------------------------------------------------------ | ---------------------------- |
| `css.parse()`     | configure CSSTree, collect recoverable errors, preserve locations              | one stable parsed result     |
| `css.resources()` | walk `Url` and `@import` nodes, classify context, de-duplicate, sort by source | consistent resource evidence |
| feature helpers   | repeat AST walks and source-order de-duplication                               | stable focused observations  |

CSSTree remains the source grammar engine. This package is the small adapter that gives the rest of the repository one
CSS evidence model.

## Source guide

1. `mod.ts` contains the complete public adapter and classification rules.
2. `mod.test.ts` covers resource kinds, declaration-list parsing, source locations, feature extraction, and recoverable
   parser errors.
