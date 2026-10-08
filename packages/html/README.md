# `@okikio/html`

You have the source of a help page and want its guide link and visible source text. `html` turns the markup into a
searchable tree, then lets you select an element and read its attributes or text. You can answer source-document
questions without starting a browser.

![HTML becomes a document tree from which a selector returns an address and link text](diagram.png)

[Editable diagram source](diagram.mmd). The branches are two facts from the same link in the demo. A selector is a
pattern for choosing elements. This diagram omits malformed-markup repair and does not show scripts, layout or
browser-rendered content.

For shared terms such as `await` and `await using`, see
[the short glossary](../../docs/learn.md#read-the-small-amount-of-code-you-need).

For the exact functions, types and field explanations, read the [generated contract reference](API.md).

## Run a complete example

```ts runnable
import * as html from '@okikio/html';
const page = html.parse('<main><a href="/guide">Read the guide</a></main>');
const link = html.selectOne(page.document, 'main a[href]');
console.log(link === null ? 'missing' : html.attribute(link, 'href'));
console.log(link === null ? 'missing' : html.text(link));
```

Expected output:

```text output
/guide
Read the guide
```

The demo supplies a page fragment with one link. The selector finds it, then the two output lines show its address and
text. Remove the link from the input to take the demo's `missing` branch. A relative address such as `/guide` still
needs the page's base URL before it can become an absolute download target.

## Build on the example

- Extract inline stylesheet text and pass it to [CSS](../css/README.md) to find referenced images and fonts. The
  runnable composition below uses both parsers on supplied source.
- Check discovered page URLs with [Robots](../robots/README.md) before a crawler schedules work. Your application still
  fetches pages and decides how to handle unavailable policy files.

Select elements for discovery, read attributes and text, then inspect source locations for evidence or rewriting.
Resolve relative URLs against the fetched page URL in your application. Parsing does not run scripts or fetch
subresources. The parsed tree is process-local data; share a serializable projection with a Worker rather than treating
DOM identity as a wire contract.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Purpose

`@okikio/html` parses HTML and exposes a small traversal API for selectors, attributes, text, element relationships, and
source locations. It keeps HTML syntax work independent from browser execution and product-specific extraction.

Use it when the input is HTML source and the question can be answered from the parsed document. Use a browser when the
answer depends on scripts, layout, computed styles, navigation, or other runtime behavior.

## The ordinary problem

A caller can combine parse5, its htmlparser2 tree adapter, css-select, and DOMUtils directly. That requires every caller
to remember the same adapter types and storage details:

```ts
import { parse } from 'parse5';
import { adapter } from 'parse5-htmlparser2-tree-adapter';
import { selectAll } from 'css-select';

const document = parse(source, { treeAdapter: adapter });
const anchors = selectAll('a[href]', document);
```

The lower-level libraries are still doing the hard parser and selector work. `@okikio/html` gives callers one stable
document model and hides parser-specific attribute and relationship shapes.

## Use the utility

```ts
import * as html from '@okikio/html';

const parsed = html.parse(`
  <main>
    <a class="cta" href="/pricing"> Pricing <strong>now</strong> </a>
  </main>
`);

const link = html.selectOne(parsed.document, 'main > a.cta[href]');
if (link) {
	console.log(html.attribute(link, 'href')); // /pricing
	console.log(html.text(link).trim()); // Pricing now
	console.log(html.tagName(link)); // a
	console.log(html.location(link)); // parse5 source coordinates
}

console.log(parsed.problems); // non-fatal HTML parse problems
```

The parser follows HTML correction rules. The returned tree therefore describes parsed HTML structure, which can differ
from a naive text/tree interpretation of malformed markup.

## Use with other utilities

Extract a stylesheet from HTML and pass its source to `@okikio/css`:

```ts runnable=stylesheet-resources.ts
import * as css from '@okikio/css';
import * as html from '@okikio/html';

const page = html.parse('<style>@import "theme.css"; .hero { background: url("hero.webp"); }</style>');
const style = html.selectOne(page.document, 'style');

if (style) {
	const stylesheet = css.parse(html.text(style));
	console.log(JSON.stringify(css.resources(stylesheet).map((item) => item.url)));
}
```

Expected output:

```text output
["theme.css","hero.webp"]
```

`html.parse()` returns a parsed document immediately; `css.parse()` returns a parsed stylesheet immediately. The final
value is a `string[]` projection of URL references. Neither parser fetches or owns a stream. Kaiju Crawl uses this
separation when extracting HTML and CSS resource evidence.

Or feed discovered Sitemap declarations from page metadata into a discovery layer that also uses `@okikio/robots` and
`@okikio/sitemap`. Each parser owns one syntax; the discovery package owns which sources to fetch and trust.

## Convenience and the manual equivalent

| Convenience            | Manual equivalent                                           | Utility-owned invariant             |
| ---------------------- | ----------------------------------------------------------- | ----------------------------------- |
| `html.parse()`         | configure parse5 tree adapter and collect parse diagnostics | one runtime-neutral parsed document |
| selector helpers       | call css-select with the correct adapter tree shape         | consistent selector behavior        |
| attribute/tree helpers | depend on htmlparser2 internal fields in every caller       | small stable traversal surface      |

The package does not fetch pages or execute JavaScript. It only answers questions about the HTML source supplied by the
caller.

## Source guide

1. `mod.ts` contains the complete parser/traversal adapter.
2. `mod.test.ts` covers HTML correction rules, selectors, source locations, and non-fatal parse problems.
