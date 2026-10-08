# @okikio/css contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import        | Source               | Reference     |
| ------------- | -------------------- | ------------- |
| `@okikio/css` | [./mod.ts](./mod.ts) | [root](#root) |

## root

Import `@okikio/css`. [Source](./mod.ts).

Extract stylesheet dependencies and feature evidence through a CSS parser. A regular expression cannot reliably
distinguish a URL token from a quoted string, a comment or a nested rule.

Extract URL references first, then collect custom properties, media features and pseudo classes from the same parsed
stylesheet. References retain source positions for diagnostics. Resolve relative URLs against the stylesheet URL in your
application. Parsing performs no network fetch and does not tell you whether a feature is supported by a particular
browser.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding   | Contract owner or source                           |
| ------------------ | -------------------------------------------------- |
| `Atrule`           | External declaration: `@types/css-tree/index.d.ts` |
| `CssLocation`      | External declaration: `@types/css-tree/index.d.ts` |
| `CssNode`          | External declaration: `@types/css-tree/index.d.ts` |
| `generate`         | External declaration: `@types/css-tree/index.d.ts` |
| `parseCss`         | External declaration: `@types/css-tree/index.d.ts` |
| `SyntaxParseError` | External declaration: `@types/css-tree/index.d.ts` |
| `walk`             | External declaration: `@types/css-tree/index.d.ts` |

### root: customProperties

[Declaration source](mod.ts#L161)

```text
function customProperties(parsed: ParsedStylesheet): readonly string[]
  Return declared CSS custom property names in source order without duplicates.
```

### root: generateSource

[Declaration source](mod.ts#L208)

```text
function generateSource(node: CssNode): string
  Generate normalized CSS for a parsed node when a caller needs an inspectable representation.
```

### root: mediaFeatures

[Declaration source](mod.ts#L176)

```text
function mediaFeatures(parsed: ParsedStylesheet): readonly string[]
  Return media feature names used by the stylesheet, such as `prefers-reduced-motion`.
```

### root: parse

[Declaration source](mod.ts#L94)

````text
function parse(source: string, options: { readonly context?: ParseContext; readonly filename?: string; }): ParsedStylesheet
  Parse CSS into a detailed CSSTree AST.

  Parse errors are retained as data because browser CSS frequently contains a
  recoverable invalid declaration or vendor syntax that should not discard the
  rest of the stylesheet.

  @example
      ```ts
      import * as css from '@okikio/css';

      const parsed = css.parse('@font-face { src: url(font.woff2) } .hero { background: url(hero.webp) }');
      console.log(css.resources(parsed));
      ```
````

### root: parseResources

[Declaration source](mod.ts#L153)

```text
function parseResources(source: string, options: { readonly context?: ParseContext; readonly filename?: string; }): readonly ResourceReference[]
  Parse CSS and immediately return its external resource references.
```

### root: pseudoClasses

[Declaration source](mod.ts#L192)

```text
function pseudoClasses(parsed: ParsedStylesheet): readonly string[]
  Return pseudo-class names used by selectors, such as `focus-visible`.
```

### root: resources

[Declaration source](mod.ts#L112)

```text
function resources(parsed: ParsedStylesheet): readonly ResourceReference[]
  Return external resource references from parsed CSS without conflating fonts and images.
```

### root: ParseProblem

[Declaration source](mod.ts#L43)

```text
interface ParseProblem
  One recoverable CSS parser problem.

  readonly message: string
    Human-readable explanation; use the stable code or discriminant for program decisions.
  readonly offset: number
    Position retained by the source or selected window contract.
  readonly line: number
    Source line reported for this observation.
  readonly column: number
    Source column associated with this observation.
```

### root: ParsedStylesheet

[Declaration source](mod.ts#L55)

```text
interface ParsedStylesheet
  Parsed CSS AST plus non-fatal parser problems.

  readonly ast: CssNode
    Parsed syntax tree retained for source-aware interpretation.
  readonly problems: readonly ParseProblem[]
    Parser observations retained alongside the CSS syntax tree.
```

### root: ResourceReference

[Declaration source](mod.ts#L66)

```text
interface ResourceReference
  One external URL referenced by CSS and the syntax context that owns it.

  readonly url: string
    Source or resource URL associated with this observation.
  readonly kind: ResourceKind
    Stable discriminant that selects the documented variant.
  readonly property?: string
    CSS property associated with this resource reference.
  readonly atRule?: string
    CSS at-rule associated with this resource reference.
  readonly location?: CssLocation
    Source or parse-tree location associated with the observation.
```

### root: ParseContext

[Declaration source](mod.ts#L27)

```text
type ParseContext = "stylesheet" | "atrule" | "atrulePrelude" | "mediaQueryList" | "mediaQuery" | "condition" | "rule" | "selectorList" | "selector" | "block" | "declarationList" | "declaration" | "value"
  CSS source context accepted by CSSTree.
```

### root: ResourceKind

[Declaration source](mod.ts#L63)

```text
type ResourceKind = "font" | "image" | "import" | "other"
  Kind of external resource referenced by a CSS construct.
```
