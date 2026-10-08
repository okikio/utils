# `@okikio/css`

You are collecting a page's dependencies for an offline copy. Its stylesheet mentions an imported theme and a hero
image, but those references are buried in CSS text. `css` parses that text and lets you ask for the resources and
features it contains, without opening a browser.

| Stylesheet fragment in the demo | Extracted fact             | Why it helps                              |
| ------------------------------- | -------------------------- | ----------------------------------------- |
| `@import "theme.css"`           | Resource URL `theme.css`   | A collector can find the next stylesheet. |
| `url("hero.webp")`              | Resource URL `hero.webp`   | A collector can find the image.           |
| `--accent: blue`                | Custom property `--accent` | An analyzer can inspect theme vocabulary. |

Read each row as evidence from source text. The table does not show resolved addresses, downloaded files, or the styles
that a browser actually applies.

The [full API reference](API.md) includes every extractor and source-location field.

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

The demo parses one stylesheet once, then asks two questions of it. The first line lists referenced resources; the
second lists custom-property names. Change `hero.webp` to `banner.webp` to change the corresponding resource evidence.
The parser does not download either image.

## Turn stylesheet references into download addresses

A parser finds references; the ordinary `URL` constructor resolves their relative addresses. Keeping those jobs separate
lets the same parsed stylesheet support dependency reports, downloads or source diagnostics.

```ts runnable=download-addresses.ts
import { parseResources } from '@okikio/css';

const stylesheetUrl = 'https://example.com/styles/site.css';
const references = parseResources('@import "theme.css"; .hero { background: url("../images/hero.webp"); }');
const addresses = references.map((reference) => ({
	kind: reference.kind,
	url: new URL(reference.url, stylesheetUrl).href,
}));
console.log(JSON.stringify(addresses));
```

```text output
[{"kind":"import","url":"https://example.com/styles/theme.css"},{"kind":"image","url":"https://example.com/images/hero.webp"}]
```

| Call or value              | Contract                                       | Meaning                                                                                                    |
| -------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `parse(source, options?)`  | CSS string → `{ ast, problems }`               | Retains the syntax tree and recoverable parse problems.                                                    |
| `ResourceReference`        | `{ url, kind, property?, atRule?, location? }` | An occurrence with source context, not a fetched resource. `kind` is `font`, `image`, `import` or `other`. |
| `resources(parsed)`        | Parsed tree → readonly reference array         | Collects `url()` tokens and quoted imports, removes duplicate reference keys and sorts by source position. |
| `customProperties(parsed)` | Parsed tree → readonly name array              | Returns distinct declared `--name` properties in source order.                                             |

One level deeper: `parse()` uses CSSTree with source positions and custom-property parsing enabled. Each extractor walks
that existing tree. URL classification uses the containing declaration or at-rule, so a font source can be distinguished
from a background image. Recoverable problems remain available beside the tree; fatal parser errors can still throw.

The design avoids reparsing for every question and avoids treating a comment or ordinary quoted string as a URL. It does
not calculate browser styles or decide which discovered addresses are safe to download.

## Build on the example

- Use [HTML](../html/README.md) to extract a page's inline `<style>` text, then inspect that text with CSS. The runnable
  composition below shows this without network access.
- Record the URLs with [CSV](../csv/README.md) for a dependency report. Your application must resolve relative
  references against the stylesheet's address before scheduling downloads.

## The ordinary problem

CSSTree supplies the parser and tree traversal. Collectors need more than raw URL tokens: stable resource kinds, source
locations, recoverable parse diagnostics, `@import` strings and de-duplication. Repeating that adapter logic makes CSS
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

Use `parseResources(source, { filename: 'app.css' })` when the dependency list is the only result you need. The earlier
download-address example uses that convenience directly.

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
