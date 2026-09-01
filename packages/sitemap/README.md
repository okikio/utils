# `@okikio/sitemap`

Network-free, format-neutral sitemap syntax for the application and other consumers.

Production XML parsing uses `@std/xml`. The adapter does not assume that an unprefixed `@std/xml` callback carries the
document's default namespace. It tracks `xmlns="…"` scope itself and combines that state with the URI that `@std/xml` reports
for prefixed names. This makes ordinary default-namespace Sitemaps, prefixed equivalents, namespace shadowing, and extension
namespaces follow the same semantic reducer.

Saxes is a **test-only differential oracle**. Keep it until the Deno conformance suite passes against the current pinned
`@std/xml` release. It is not imported by production sitemap code.

## Public model

```text
one source
  -> detect XML / feed / text
  -> parse incrementally
  -> UrlRecord | SitemapRecord
```

The utility performs no HTTP requests, decompression, crawl admission, candidate prioritization, or artifact persistence.
`the consuming discovery package` owns those operations.

## Streaming properties

- XML uses `parseXmlRecordsFromBytes()` so downstream consumers can apply per-record backpressure.
- Source chunks are re-chunked to 64 KiB before `@std/xml`, which bounds the record buffer produced by one parser chunk.
- XML 1.0 versus XML 1.1 is selected from a small replayed source prefix before the parser starts.
- DOCTYPE is rejected by `@std/xml`.
- Depth and attribute counts are bounded for untrusted discovery input.
- The caller's byte limit applies to uncompressed bytes and reports `capped` without pretending deliberate truncation is malformed XML.
- Plain text handles LF, CRLF, BOM, a final line without a newline, and UTF-8 scalars split across source chunks.
- Atom emits page links only for the default/`alternate` relation; feed metadata such as `self` and `next` does not become a crawl route.
- Standards-mode Sitemap roots with the wrong XML namespace produce explicit `unexpected_sitemap_namespace` evidence instead of silently returning an empty record stream.

## Required Deno cutover gate

Run the package tests with the frozen dependency graph. The differential corpus covers default and prefixed Sitemap namespaces,
XHTML hreflang, extension `loc` elements, namespace shadowing, hostile chunk splits, XML 1.1 selection, DOCTYPE rejection, and
a generated 50,000-entry stream.
