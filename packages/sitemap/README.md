# `@okikio/sitemap`

Read sitemap, feed and text discovery sources through one record model. Looking for every XML loc element loses source
kind, alternate links and malformed-document evidence.

## Run a complete example

```ts runnable
import * as sitemap from '@okikio/sitemap';
const text =
	'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/guide</loc></url></urlset>';
console.log(
	JSON.stringify(sitemap.locations({ url: 'https://example.com/sitemap.xml', contentType: 'application/xml', text })),
);
```

Expected output:

```text output
["https://example.com/guide"]
```

## Build on the example

Use locations() when only URLs matter, parse() when provenance and metadata matter, and parseStream() for bounded
incremental ingestion. Choose standards or lenient policy explicitly for imperfect sources and retain problems for
diagnostics. The utility does not fetch nested sitemap indexes or choose crawl priority. The acquiring application owns
network, byte and source-count budgets.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Purpose

`@okikio/sitemap` parses Sitemap XML, RSS, Atom, and plain-text URL lists without performing network I/O. It exposes one
`SitemapRecord` stream so a discovery layer can consume several source formats through the same contract.

Use it after another component has fetched a Sitemap resource. HTTP status, redirects, decompression, cache policy,
crawl admission, prioritization, and artifact persistence stay outside this package.

## The ordinary problem

A small Sitemap can be parsed as one XML document and then walked:

```ts
const text = await response.text();
const document = parseXml(text);
const locations = findLocElements(document).map((element) => element.text);
```

That approach becomes awkward for large sources. The caller must also handle Sitemap indexes, RSS/Atom links, plain-text
lists, namespace scope, source byte limits, hostile chunk splits, cancellation, and incremental backpressure.

## Use the utility

For a small complete source, use `parse()` or `locations()`:

```ts
import * as sitemap from '@okikio/sitemap';

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

For unknown or large input, stream records as the parser discovers them:

```ts
const result = await sitemap.parseStream({
	stream: response.body!,
	url: response.url,
	contentType: response.headers.get('content-type') ?? undefined,
	maxBytes: 64 * 1024 * 1024,
	signal: ctx.signal,
	async onRecord(record) {
		await saveCandidate(record);
	},
});

console.log(result.byteLength, result.capped, result.problems);
```

`onRecord` is awaited. A slower consumer therefore applies backpressure instead of forcing the package to retain the
complete record set.

## Use with other utilities

Kaiju Crawl discovers Sitemap sources from robots declarations and waits for its candidate sink on each record. This
complete local version streams supplied bytes, applies robots rules and returns only accepted page URLs.

```ts runnable=stream-discovery.ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as robots from '@okikio/robots';
import * as sitemap from '@okikio/sitemap';

const policy = robots.parse('User-agent: *\nDisallow: /private/\nSitemap: https://example.com/sitemap.xml\n');
const text = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
	'<url><loc>https://example.com/guide</loc></url>' +
	'<url><loc>https://example.com/private/report</loc></url></urlset>';
const candidates: string[] = [];
await using owner = context.create({ id: 'sitemap-discovery' });
for (const url of robots.getSitemapUrls(policy)) {
	const parsed = await sitemap.parseStream({
		stream: new Response(text).body!,
		url,
		contentType: 'application/xml',
		maxBytes: 20_000,
		signal: owner.signal,
		async onRecord(record) {
			if (record.kind === 'url' && robots.match(policy, { userAgent: 'KaijuBot', url: record.loc })) {
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
the stream reader and releases it when parsing finishes, fails or is cancelled. The context supplies cancellation and is
disposed when its block ends. Cancellation cannot undo an already accepted sink write.

For a fetched source, pass `owner.signal` to `fetch()` too, reject unwanted HTTP status, and limit nested source counts.
Context owns lifetime, robots owns syntax and matching, and sitemap owns XML/feed/text parsing. The acquiring
application owns network and crawl policy.

## Parser and safety model

Production XML parsing uses `@std/xml`. The adapter tracks default namespace scope itself because unprefixed callbacks
do not carry enough namespace state for Sitemap semantics by themselves. Prefixed and unprefixed Sitemap documents
therefore pass through one semantic reducer.

The streaming parser also:

- detects XML versus text from source metadata and a bounded prefix;
- selects XML 1.0 or XML 1.1 from the replayed source prefix;
- rejects DOCTYPE input;
- bounds XML nesting and attribute counts;
- reports deliberate byte-limit truncation as `capped`;
- handles UTF-8 characters split across byte chunks;
- treats Atom `alternate` links as page candidates while excluding feed-control links such as `self` and `next`;
- reports an unexpected Sitemap namespace in standards mode.

Saxes is a **test-only differential oracle**. Production code does not import it. Keep the differential corpus until the
pinned `@std/xml` path continues to prove the same Sitemap semantics.

## Convenience and the manual equivalent

| Convenience             | Manual equivalent                                                                                         | Utility-owned invariant      |
| ----------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `sitemap.parse()`       | detect format, parse, normalize records, de-duplicate                                                     | one complete-source contract |
| `sitemap.parseStream()` | byte accounting + format detection + incremental parser + backpressure + cancellation + problem reporting | bounded streaming discovery  |
| `locations()`           | parse records and project `loc` values                                                                    | simple URL-only use          |

## Source guide

1. `mod.ts` owns format detection, streaming byte policy, and Sitemap semantics.
2. `mod.test.ts` covers XML/feed/text behavior and safety limits.
3. `differential.test.ts` compares production semantics against Saxes on the namespace/chunking corpus.
