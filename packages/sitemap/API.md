# @okikio/sitemap contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import            | Source               | Reference     |
| ----------------- | -------------------- | ------------- |
| `@okikio/sitemap` | [./mod.ts](./mod.ts) | [root](#root) |

## root

Import `@okikio/sitemap`. [Source](./mod.ts).

Read sitemap, feed and text discovery sources through one record model. Looking for every XML loc element loses source
kind, alternate links and malformed-document evidence.

Use locations() when only URLs matter, parse() when provenance and metadata matter, and parseStream() for bounded
incremental ingestion. Choose standards or lenient policy explicitly for imperfect sources and retain problems for
diagnostics. The utility does not fetch nested sitemap indexes or choose crawl priority. The acquiring application owns
network, byte and source-count budgets.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding           | Contract owner or source                                |
| -------------------------- | ------------------------------------------------------- |
| `parseXmlDocument`         | [External source](https://jsr.io/@std/xml/0.2.0/mod.ts) |
| `parseXmlRecordsFromBytes` | [External source](https://jsr.io/@std/xml/0.2.0/mod.ts) |
| `XmlAttributeIterator`     | [External source](https://jsr.io/@std/xml/0.2.0/mod.ts) |
| `XmlElement`               | [External source](https://jsr.io/@std/xml/0.2.0/mod.ts) |
| `XmlNode`                  | [External source](https://jsr.io/@std/xml/0.2.0/mod.ts) |
| `XmlSyntaxError`           | [External source](https://jsr.io/@std/xml/0.2.0/mod.ts) |

### root: locations

[Declaration source](mod.ts#L127)

```text
function locations(input: { readonly text: string; readonly url: string; readonly contentType?: string; readonly policy?: SitemapParsePolicy; }): readonly string[]
  Get only normalized locations from one complete sitemap resource.
```

### root: parse

[Declaration source](mod.ts#L99)

```text
function parse(input: { readonly text: string; readonly url: string; readonly contentType?: string; readonly policy?: SitemapParsePolicy; }): readonly SitemapRecord[]
  Parse one complete decoded sitemap/feed/text string without network access.
```

### root: parseStream

[Declaration source](mod.ts#L143)

```text
async function parseStream(input: { readonly stream: ReadableStream<Uint8Array<ArrayBufferLike>>; readonly url: string; readonly contentType?: string; readonly policy?: SitemapParsePolicy; readonly maxBytes?: number; readonly signal?: AbortSignal; readonly onRecord: (record: SitemapRecord) => void | Promise<void>; }): Promise<SitemapStreamResult>
  Incrementally parse one sitemap/feed/text byte stream.

  `@std/xml` owns XML tokenization and well-formedness. the application owns sitemap
  semantics and explicitly resolves default XML namespaces because @std/xml
  intentionally reports `uri = undefined` for unprefixed element callbacks.
```

### root: SitemapAlternate

[Declaration source](mod.ts#L27)

```text
interface SitemapAlternate
  One localized alternate declared beside a sitemap URL.

  readonly href: string
    URL associated with this parsed resource reference.
  readonly hreflang: string
    Language tag declared for this alternate source location.
```

### root: SitemapProblem

[Declaration source](mod.ts#L73)

```text
interface SitemapProblem
  Non-fatal or fatal parser evidence retained for the caller.

  readonly code: "doctype_not_allowed" | "malformed_xml" | "nonstandard_text_comment" | "unexpected_sitemap_namespace"
    Stable machine-readable reason that callers can inspect without matching message text.
  readonly message: string
    Human-readable explanation; use the stable code or discriminant for program decisions.
```

### root: SitemapSourceRecord

[Declaration source](mod.ts#L56)

```text
interface SitemapSourceRecord
  One child source declared by an XML sitemap index.

  readonly kind: "sitemap"
    Stable discriminant that selects the documented variant.
  readonly loc: string
    Location declared by the source document.
  readonly format: "xml"
    Selected external representation format.
  readonly lastModified?: string
    Optional source modification instant reported by the external document.
  readonly alternates: readonly SitemapAlternate[]
    Alternate language locations declared by the source.
```

### root: SitemapStreamResult

[Declaration source](mod.ts#L81)

```text
interface SitemapStreamResult
  Result metadata from an incrementally parsed sitemap source.

  readonly byteLength: number
    Number of encoded bytes represented by this value.
  readonly capped: boolean
    Whether the reported result was limited by a configured bound.
  readonly format?: SitemapFormat
    Selected external representation format.
  readonly problems: readonly SitemapProblem[]
    Parser and format observations associated with the inspected sitemap.
```

### root: SitemapUrlRecord

[Declaration source](mod.ts#L38)

```text
interface SitemapUrlRecord
  One page/resource URL declared by a sitemap source.

  readonly kind: "url"
    Stable discriminant that selects the documented variant.
  readonly loc: string
    Location declared by the source document.
  readonly format: SitemapFormat
    Selected external representation format.
  readonly lastModified?: string
    Optional source modification instant reported by the external document.
  readonly changeFrequency?: string
    Optional change-frequency hint declared by the sitemap source.
  readonly priority?: number
    Optional sitemap priority hint; it does not establish crawl order or source authority.
  readonly alternates: readonly SitemapAlternate[]
    Alternate language locations declared by the source.
```

### root: SitemapFormat

[Declaration source](mod.ts#L35)

```text
type SitemapFormat = "xml" | "rss" | "atom" | "text"
  Source format that produced a normalized sitemap record.
```

### root: SitemapParsePolicy

[Declaration source](mod.ts#L24)

```text
type SitemapParsePolicy = "standards" | "lenient"
  Syntax policy for imperfect real-world sitemap inputs.
```

### root: SitemapRecord

[Declaration source](mod.ts#L70)

```text
type SitemapRecord = SitemapUrlRecord | SitemapSourceRecord
  Format-neutral record produced by one sitemap resource.
```
