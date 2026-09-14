`@okikio/css`
==============

Purpose
-------

`@okikio/css` turns CSS source into inspectable structure without starting a
browser. It exposes parser problems, external resources, custom properties,
media features, pseudo-classes, and normalized source generation.

Use it when a collector or analysis package needs facts from CSS text. Fetching
stylesheets, resolving URLs, executing CSS in a browser, and assigning product
meaning remain caller responsibilities.

The ordinary problem
--------------------

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

Real collectors usually need more than the raw URL value. They need stable
resource kinds, source locations, recoverable parse diagnostics, `@import`
strings, and de-duplication. Repeating that adapter logic in every caller makes
CSS evidence disagree across the codebase.

Use the utility
---------------

Parse once and ask focused questions of the same result:

```ts
import * as css from '@okikio/css';

const parsed = css.parse(`
  @import "theme.css";
  @font-face { src: url("brand.woff2"); }
  :root { --brand: #765; }
  .hero { background-image: url("hero.webp"); }
  @media (prefers-reduced-motion: reduce) { .card:hover { opacity: .8; } }
`, { filename: 'app.css' });

console.log(css.resources(parsed));
console.log(css.customProperties(parsed)); // ['--brand']
console.log(css.mediaFeatures(parsed));    // ['prefers-reduced-motion']
console.log(css.pseudoClasses(parsed));    // ['hover']
console.log(parsed.problems);              // recoverable parser diagnostics
```

`parseResources()` is the shorter path when resources are the only result the
caller needs:

```ts
const resources = css.parseResources(source, { filename: 'app.css' });
```

Resource kinds distinguish `font`, `image`, `import`, and `other`. The package
does not resolve those references against a base URL because URL ownership
belongs to the caller that knows the stylesheet location.

Use with other utilities
------------------------

HTML discovery can extract inline styles and stylesheet links before CSS
analysis inspects each CSS source:

```ts
import * as css from '@okikio/css';
import * as html from '@okikio/html';

const page = html.parse(sourceHtml);

for (const style of html.selectAll(page.document, 'style')) {
  for (const resource of css.parseResources(html.text(style))) {
    await recordCssResource(resource);
  }
}

for (const link of html.selectAll(page.document, 'link[rel~="stylesheet"][href]')) {
  console.log(html.attribute(link, 'href'));
}
```

`@okikio/html` owns HTML structure. `@okikio/css` owns CSS syntax. Network and
URL-resolution policy can then sit above both packages.

Convenience and the manual equivalent
-------------------------------------

| Convenience | Manual equivalent | Utility-owned invariant |
| --- | --- | --- |
| `css.parse()` | configure CSSTree, collect recoverable errors, preserve locations | one stable parsed result |
| `css.resources()` | walk `Url` and `@import` nodes, classify context, de-duplicate, sort by source | consistent resource evidence |
| feature helpers | repeat AST walks and source-order de-duplication | stable focused observations |

CSSTree remains the source grammar engine. This package is the small adapter
that gives the rest of the repository one CSS evidence model.

Source guide
------------

1. `mod.ts` contains the complete public adapter and classification rules.
2. `mod.test.ts` covers resource kinds, declaration-list parsing, source
   locations, feature extraction, and recoverable parser errors.
