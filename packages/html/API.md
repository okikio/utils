# @okikio/html contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import         | Source               | Reference     |
| -------------- | -------------------- | ------------- |
| `@okikio/html` | [./mod.ts](./mod.ts) | [root](#root) |

## root

Import `@okikio/html`. [Source](./mod.ts).

Parse imperfect HTML and query it through one consistent tree adapter. A selector library and a parser with incompatible
trees can silently return no matches even when the element exists.

Select elements for discovery, read attributes and text, then inspect source locations for evidence or rewriting.
Resolve relative URLs against the fetched page URL in your application. Parsing does not run scripts or fetch
subresources. The parsed tree is process-local data; share a serializable projection with a Worker rather than treating
DOM identity as a wire contract.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding            | Contract owner or source                                                |
| --------------------------- | ----------------------------------------------------------------------- |
| `matchesCss`                | External declaration: `css-select/dist/index.d.ts`                      |
| `selectCssAll`              | External declaration: `css-select/dist/index.d.ts`                      |
| `selectCssOne`              | External declaration: `css-select/dist/index.d.ts`                      |
| `AnyNode`                   | External declaration: `domhandler/dist/index.d.ts`                      |
| `Document`                  | External declaration: `domhandler/dist/index.d.ts`                      |
| `Element`                   | External declaration: `domhandler/dist/index.d.ts`                      |
| `isTag`                     | External declaration: `domhandler/dist/index.d.ts`                      |
| `textContent`               | External declaration: `domutils/dist/index.d.ts`                        |
| `parseHtml`                 | External declaration: `parse5/dist/index.d.ts`                          |
| `ParserError`               | External declaration: `parse5/dist/index.d.ts`                          |
| `Token`                     | External declaration: `parse5/dist/index.d.ts`                          |
| `adapter`                   | External declaration: `parse5-htmlparser2-tree-adapter/dist/index.d.ts` |
| `Htmlparser2TreeAdapterMap` | External declaration: `parse5-htmlparser2-tree-adapter/dist/index.d.ts` |

### root: attribute

[Declaration source](mod.ts#L102)

```text
function attribute(element: HtmlElement, name: string): string | null
  Get one attribute without exposing the parser's attribute storage shape.
```

### root: children

[Declaration source](mod.ts#L117)

```text
function children(element: HtmlElement): readonly HtmlElement[]
  Return direct child elements, excluding text, comments, and directives.
```

### root: hasAttribute

[Declaration source](mod.ts#L107)

```text
function hasAttribute(element: HtmlElement, name: string): boolean
  Return whether an element contains an attribute, including an empty attribute.
```

### root: location

[Declaration source](mod.ts#L147)

```text
function location(node: Node): Token.Location | Token.ElementLocation | undefined
  Return parse5 source coordinates for a parsed node.
```

### root: matches

[Declaration source](mod.ts#L97)

```text
function matches(element: HtmlElement, selector: string): boolean
  Return whether an element matches a CSS selector.
```

### root: parent

[Declaration source](mod.ts#L122)

```text
function parent(element: HtmlElement): HtmlElement | null
  Return the nearest parent element, if one exists.
```

### root: parse

[Declaration source](mod.ts#L74)

````text
function parse(source: string): ParsedDocument
  Parse source HTML with parse5's WHATWG parser and retain source locations.

  The returned document uses the htmlparser2 tree shape so CSS selectors can be
  evaluated without reparsing the source through a second HTML parser.

  @example
      ```ts
      import * as html from '@okikio/html';

      const parsed = html.parse('<main><a href="/pricing">Pricing</a></main>');
      const link = html.selectOne(parsed.document, 'a[href]');
      if (link) console.log(html.attribute(link, 'href'));
      ```
````

### root: previous

[Declaration source](mod.ts#L132)

```text
function previous(element: HtmlElement): HtmlElement | null
  Return the previous element sibling, ignoring text and comment nodes.
```

### root: selectAll

[Declaration source](mod.ts#L87)

```text
function selectAll(root: Node, selector: string): readonly HtmlElement[]
  Return all descendants that match a CSS selector.
```

### root: selectOne

[Declaration source](mod.ts#L92)

```text
function selectOne(root: Node, selector: string): HtmlElement | null
  Return the first descendant that matches a CSS selector.
```

### root: tagName

[Declaration source](mod.ts#L142)

```text
function tagName(element: HtmlElement): string
  Return the lower-case source tag name.
```

### root: text

[Declaration source](mod.ts#L112)

```text
function text(node: Node): string
  Return normalized descendant text according to the parsed source tree.
```

### root: ParseProblem

[Declaration source](mod.ts#L23)

```text
interface ParseProblem
  One HTML parser problem with source coordinates when parse5 provides them.

  readonly code: string
    Stable machine-readable reason that callers can inspect without matching message text.
  readonly startLine?: number
    Starting line in the original source.
  readonly startColumn?: number
    Starting column in the original source.
  readonly startOffset?: number
    Start offset in the original source.
  readonly endLine?: number
    Ending line in the original source.
  readonly endColumn?: number
    Ending column in the original source.
  readonly endOffset?: number
    Exclusive end offset in the original source.
```

### root: ParsedDocument

[Declaration source](mod.ts#L41)

```text
interface ParsedDocument
  WHATWG-parsed source HTML plus non-fatal parser problems.

  readonly document: Document
    Parsed htmlparser2-compatible document root; selectors inspect this same tree.
  readonly problems: readonly ParseProblem[]
    Non-fatal parse5 observations retained with their source locations.
```

### root: HtmlDocument

[Declaration source](mod.ts#L51)

```text
type HtmlDocument = Document
  Parsed HTML document root.
```

### root: HtmlElement

[Declaration source](mod.ts#L53)

```text
type HtmlElement = Element
  Parsed HTML element node.
```

### root: Node

[Declaration source](mod.ts#L49)

```text
type Node = AnyNode
  Any parsed htmlparser2-compatible node.
```
