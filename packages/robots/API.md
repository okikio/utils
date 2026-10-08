# @okikio/robots contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import           | Source               | Reference     |
| ---------------- | -------------------- | ------------- |
| `@okikio/robots` | [./mod.ts](./mod.ts) | [root](#root) |

## root

Import `@okikio/robots`. [Source](./mod.ts).

Apply user-agent-specific robots rules with overlap and wildcard semantics. Collecting every Disallow line mixes
unrelated groups and cannot tell whether a more specific Allow rule wins.

Parse once and check many URLs, then collect declared sitemaps for discovery. Unknown extension records remain available
for higher-level policy. The parser performs no fetch and does not decide HTTP status, caching or authority rules. The
application owns acquisition limits and whether a failed robots fetch should allow or deny crawling.

### root: getSitemapUrls

[Declaration source](mod.ts#L112)

```text
function getSitemapUrls(document: RobotsDocument): readonly string[]
  Get absolute Sitemap declarations from a parsed robots.txt document.
```

### root: match

[Declaration source](mod.ts#L123)

```text
function match(document: RobotsDocument, input: { readonly userAgent: string; readonly url: string; }): boolean
  Evaluate basic robots Allow/Disallow matching for one URL.

  This implements longest-pattern selection with Allow winning equal-length
  ties, plus `*` and terminal `$`. It is intentionally covered by local corpus
  tests but is not yet claimed Google-parity until the upstream corpus gate runs.
```

### root: parse

[Declaration source](mod.ts#L58)

```text
function parse(text: string): RobotsDocument
  Parse one bounded robots.txt string without HTTP policy.
```

### root: RobotsDocument

[Declaration source](mod.ts#L46)

```text
interface RobotsDocument
  Parse-once robots.txt representation.

  readonly groups: readonly RobotsGroup[]
    Independent user-agent groups retained by the robots parser.
  readonly sitemaps: readonly string[]
    Sitemap locations declared by the robots source.
  readonly extensions: readonly RobotsRecord[]
    Protocol extension data retained outside the canonical members.
  readonly records: readonly RobotsRecord[]
    Retained observations available to the caller.
```

### root: RobotsGroup

[Declaration source](mod.ts#L28)

```text
interface RobotsGroup
  One user-agent policy group.

  readonly userAgents: readonly string[]
    User-agent selectors belonging to this robots group.
  readonly rules: readonly RobotsRule[]
    Rules belonging to the selected source group or classifier.
```

### root: RobotsRecord

[Declaration source](mod.ts#L18)

````text
interface RobotsRecord
  Apply user-agent-specific robots rules with overlap and wildcard semantics. Collecting every Disallow line mixes unrelated groups and cannot tell whether a more specific Allow rule wins.

  Parse once and check many URLs, then collect declared sitemaps for discovery. Unknown extension records remain available for higher-level policy. The parser performs no fetch and does not decide HTTP status, caching or authority rules. The application owns acquisition limits and whether a failed robots fetch should allow or deny crawling.

  @example
      ```ts
      import * as robots from '@okikio/robots';
      const policy = robots.parse(`User-agent: *
      Disallow: /private/
      Allow: /private/pricing
      `);
      console.log(robots.match(policy, { userAgent: 'ResearchBot', url: 'https://example.com/private/report' }));
      console.log(robots.match(policy, { userAgent: 'ResearchBot', url: 'https://example.com/private/pricing' }));
      ```

  @module

  readonly field: string
    Source field associated with this observation.
  readonly value: string
    Value carried by this contract; its schema and owner define the accepted shape.
  readonly line: number
    Source line reported for this observation.
````

### root: RobotsRule

[Declaration source](mod.ts#L36)

```text
interface RobotsRule
  One Allow or Disallow rule.

  readonly kind: "allow" | "disallow"
    Stable discriminant that selects the documented variant.
  readonly pattern: string
    Source matching pattern retained for interpretation.
  readonly line: number
    Source line reported for this observation.
```
