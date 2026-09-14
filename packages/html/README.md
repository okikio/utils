`@okikio/html`
===============

Purpose
-------

`@okikio/html` parses HTML and exposes a small traversal API for selectors,
attributes, text, element relationships, and source locations. It keeps HTML
syntax work independent from browser execution and product-specific extraction.

Use it when the input is HTML source and the question can be answered from the
parsed document. Use a browser when the answer depends on scripts, layout,
computed styles, navigation, or other runtime behavior.

The ordinary problem
--------------------

A caller can combine parse5, its htmlparser2 tree adapter, css-select, and
DOMUtils directly. That requires every caller to remember the same adapter
types and storage details:

```ts
import { parse } from 'parse5';
import { adapter } from 'parse5-htmlparser2-tree-adapter';
import { selectAll } from 'css-select';

const document = parse(source, { treeAdapter: adapter });
const anchors = selectAll('a[href]', document);
```

The lower-level libraries are still doing the hard parser and selector work.
`@okikio/html` gives callers one stable document model and hides parser-specific
attribute and relationship shapes.

Use the utility
---------------

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
  console.log(html.text(link).trim());       // Pricing now
  console.log(html.tagName(link));           // a
  console.log(html.location(link));          // parse5 source coordinates
}

console.log(parsed.problems); // non-fatal HTML parse problems
```

The parser follows HTML correction rules. The returned tree therefore describes
parsed HTML structure, which can differ from a naive text/tree interpretation
of malformed markup.

Use with other utilities
------------------------

Extract a stylesheet from HTML and pass its source to `@okikio/css`:

```ts
import * as css from '@okikio/css';
import * as html from '@okikio/html';

const page = html.parse(sourceHtml);
const style = html.selectOne(page.document, 'style');

if (style) {
  const stylesheet = css.parse(html.text(style));
  console.log(css.resources(stylesheet));
}
```

Or feed discovered Sitemap declarations from page metadata into a discovery
layer that also uses `@okikio/robots` and `@okikio/sitemap`. Each parser owns one
syntax; the discovery package owns which sources to fetch and trust.

Convenience and the manual equivalent
-------------------------------------

| Convenience | Manual equivalent | Utility-owned invariant |
| --- | --- | --- |
| `html.parse()` | configure parse5 tree adapter and collect parse diagnostics | one runtime-neutral parsed document |
| selector helpers | call css-select with the correct adapter tree shape | consistent selector behavior |
| attribute/tree helpers | depend on htmlparser2 internal fields in every caller | small stable traversal surface |

The package does not fetch pages or execute JavaScript. It only answers
questions about the HTML source supplied by the caller.

Source guide
------------

1. `mod.ts` contains the complete parser/traversal adapter.
2. `mod.test.ts` covers HTML correction rules, selectors, source locations, and
   non-fatal parse problems.
