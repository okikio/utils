# Sitemap

A website's **sitemap** is a document listing page addresses or other sitemap documents. A page record is a candidate
to visit; a child-source record asks your application to read another list first. Reading either record does not fetch
that address. The [package example](../../packages/format/sitemap/README.md) starts from supplied local XML; this guide
then streams the same kind of input into an application-owned sink.

## The ordinary problem

A generic XML parser can find `loc` elements in a small source. A discovery reader must also distinguish pages from
child sources, interpret RSS/Atom links, handle plain-text lists, respect namespaces and bound streamed bytes. Those
format and lifetime rules are the reusable work this package supplies.

## Use the utility

For a small complete source, use `parse()` or `locations()`:

```ts
import * as sitemap from '@okikio/format/sitemap';

const records = sitemap.parse({
	url: 'https://example.com/sitemap.xml',
	text: `<?xml version="1.0"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://example.com/a</loc></url>
      <url><loc>https://example.com/b</loc></url>
    </urlset>`,
});

console.log(records.map((record) => record.loc));
// ['https://example.com/a', 'https://example.com/b']
```

An index introduces one extra step: its addresses name other sitemap documents rather than pages. After the
[checkout setup](../../README.md#run-a-complete-example-from-this-checkout), save this as `sitemap-index.ts` and run
`mise exec -- deno run sitemap-index.ts`. The output labels each address so you can tell what to read next.

```ts runnable=sitemap-index.ts
import * as sitemap from '@okikio/format/sitemap';

const text = `
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://example.com/pages.xml</loc>
  </sitemap>
</sitemapindex>`;
const records = sitemap.parse({ url: 'https://example.com/index.xml', text });
console.log(JSON.stringify(records.map(({ kind, loc }) => ({ kind, loc }))));
```

```text output
[{"kind":"sitemap","loc":"https://example.com/pages.xml"}]
```

```text
index.xml
└── pages.xml             child source; application fetches this document
    ├── /a                page candidate from that child's contents
    └── /b                page candidate from that child's contents
```

The tree shows a possible second document, not recursive work the parser performed. The application owns fetching the
child, checking its status, bounding the number of nested sources and applying crawl policy to the resulting pages.
The [parser limits](../../packages/format/sitemap/README.md#retain-complete-input-failure-evidence) bound inspection of
each supplied document; they do not bound an application that keeps following new sources forever.

For unknown or large input, use `parseStream()` as in the complete example below. Its `onRecord` callback is awaited, so
a slower consumer applies backpressure instead of forcing the package to retain the complete record set.

## Use with other utilities

The application supplies the source URL and bytes. Sitemap waits for the candidate sink on each record. This example
collects page URLs. The application must apply its own crawl policy before requesting those pages.

After the [checkout setup](../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`stream-discovery.ts` at that root, then run `mise exec -- deno run stream-discovery.ts`.

```ts runnable=stream-discovery.ts
import * as sitemap from '@okikio/format/sitemap';

const text = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
	'<url><loc>https://example.com/guide</loc></url>' +
	'</urlset>';
const candidates: string[] = [];
{
	const url = 'https://example.com/sitemap.xml';
	const parsed = await sitemap.parseStream({
		stream: new Response(text).body!,
		url,
		contentType: 'application/xml',
		maxBytes: 20_000,
		onRecord(record) {
			if (record.kind === 'url') {
				candidates.push(record.loc);
			}
		},
	});
	if (parsed.capped) throw new Error('The discovery source exceeded its byte budget.');
}
console.log(JSON.stringify(candidates));
```

Expected output:

```text output
["https://example.com/guide"]
```

`parseStream()` returns `Promise<SitemapStreamResult>`. It awaits `onRecord()` before advancing, so an asynchronous sink
can apply backpressure. The final application result is `string[]`; it is deliberately collected here. The parser owns
the stream reader and releases it when parsing finishes or fails. No context is needed for this supplied finite source;
the byte budget is the useful input bound.

Pass the caller's cancellation signal to both `fetch()` and `parseStream()`. Check the HTTP status before
parsing and limit how many linked sitemaps you follow. Stopping the parser does not undo a write you have
already made. The package reads the sitemap; your application chooses which URLs to fetch and which results
to save.

## Parser and safety model

The parser uses `@std/xml` to read XML. Utils also tracks the namespace, which tells it what an XML name means.
For example, two documents can both use `loc` for a sitemap location even if one writes it with a prefix.
Tracking the default namespace lets the parser apply the same Sitemap rules to both forms.

The streaming parser also:

- detects XML versus text from source metadata and a bounded prefix;
- selects XML 1.0 or XML 1.1 from the replayed source prefix;
- rejects DOCTYPE input;
- bounds XML nesting and attribute counts;
- reports deliberate byte-limit truncation as `capped`;
- handles UTF-8 characters split across byte chunks;
- treats Atom `alternate` links as page candidates while excluding feed-control links such as `self` and `next`;
- reports an unexpected Sitemap namespace in standards mode.

The tests also parse the same files with Saxes and compare the results. The files include namespace variations
and input split across chunks. Keep those checks when changing `@std/xml`. The Sitemap parser does not import Saxes
when your application runs.

## Convenience and the manual equivalent

| Convenience             | Manual equivalent                                                                                         | Utility-owned invariant      |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `sitemap.parse()`       | detect format, parse, normalize records, de-duplicate                                                     | one complete-source contract |
| `sitemap.parseStream()` | byte accounting + format detection + incremental parser + backpressure + cancellation + problem reporting | bounded streaming discovery  |
| `locations()`           | parse records and project `loc` values                                                                    | simple URL-only use          |

## Source guide

The paths below are relative to the [package directory](../../packages/format/sitemap).

1. `mod.ts` owns format detection, streaming byte policy, and Sitemap semantics.
2. `mod.test.ts` covers XML/feed/text behavior and safety limits.
3. `differential.test.ts` compares production semantics against Saxes on the namespace/chunking corpus.

## Retain complete-input failure evidence

Use `inspect(input, { maximumCodeUnits, maximumRecords, maximumUrlLength, maximumProblems })` when empty results must be
explained. The result includes `records`, detected `format`, `problems` and `capped`. All limits are required finite
non-negative integers. String lengths count UTF-16 code units. The input-length guard runs before XML tree construction;
inspection is a complete-input operation. Use `parseStream` for incremental input.

A valid `<urlset/>` has no records and no problems. Malformed XML produces `malformed_xml`; a policy limit sets
`capped`. Duplicate kind/location pairs merge within the retained record bound. `maximumProblems: 0` suppresses messages
and sets `capped` when evidence is discarded. Unexpected defects throw. The older `parse`/`locations` operations
preserve their permissive array results.
