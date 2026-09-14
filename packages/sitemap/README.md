`@okikio/sitemap`
=================

Purpose
-------

`@okikio/sitemap` parses Sitemap XML, RSS, Atom, and plain-text URL lists without
performing network I/O. It exposes one `SitemapRecord` stream so a discovery
layer can consume several source formats through the same contract.

Use it after another component has fetched a Sitemap resource. HTTP status,
redirects, decompression, cache policy, crawl admission, prioritization, and
artifact persistence stay outside this package.

The ordinary problem
--------------------

A small Sitemap can be parsed as one XML document and then walked:

```ts
const text = await response.text();
const document = parseXml(text);
const locations = findLocElements(document).map((element) => element.text);
```

That approach becomes awkward for large sources. The caller must also handle
Sitemap indexes, RSS/Atom links, plain-text lists, namespace scope, source byte
limits, hostile chunk splits, cancellation, and incremental backpressure.

Use the utility
---------------

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

`onRecord` is awaited. A slower consumer therefore applies backpressure instead
of forcing the package to retain the complete record set.

Use with other utilities
------------------------

Robots parsing can discover Sitemap sources, and a `Context` can own the fetch
and parse lifetime:

```ts
import * as context from '@okikio/context';
import * as robots from '@okikio/robots';
import * as sitemap from '@okikio/sitemap';

await using ctx = context.create({ id: 'sitemap-discovery' });
const policy = robots.parse(robotsText);

for (const url of robots.getSitemapUrls(policy)) {
  context.check(ctx);
  const response = await fetch(url, { signal: ctx.signal });

  await sitemap.parseStream({
    stream: response.body!,
    url,
    signal: ctx.signal,
    async onRecord(record) {
      if (robots.match(policy, { userAgent: 'KaijuBot', url: record.loc })) {
        await addCandidate(record.loc);
      }
    },
  });
}
```

Each package owns one mechanism: context owns lifetime, robots owns robots syntax
and matching, and sitemap owns Sitemap/feed/text parsing. The discovery layer
owns the network and crawl policy that connects them.

Parser and safety model
-----------------------

Production XML parsing uses `@std/xml`. The adapter tracks default namespace
scope itself because unprefixed callbacks do not carry enough namespace state
for Sitemap semantics by themselves. Prefixed and unprefixed Sitemap documents
therefore pass through one semantic reducer.

The streaming parser also:

- detects XML versus text from source metadata and a bounded prefix;
- selects XML 1.0 or XML 1.1 from the replayed source prefix;
- rejects DOCTYPE input;
- bounds XML nesting and attribute counts;
- reports deliberate byte-limit truncation as `capped`;
- handles UTF-8 characters split across byte chunks;
- treats Atom `alternate` links as page candidates while excluding feed-control
  links such as `self` and `next`;
- reports an unexpected Sitemap namespace in standards mode.

Saxes is a **test-only differential oracle**. Production code does not import it.
Keep the differential corpus until the pinned `@std/xml` path continues to prove
the same Sitemap semantics.

Convenience and the manual equivalent
-------------------------------------

| Convenience | Manual equivalent | Utility-owned invariant |
| --- | --- | --- |
| `sitemap.parse()` | detect format, parse, normalize records, de-duplicate | one complete-source contract |
| `sitemap.parseStream()` | byte accounting + format detection + incremental parser + backpressure + cancellation + problem reporting | bounded streaming discovery |
| `locations()` | parse records and project `loc` values | simple URL-only use |

Source guide
------------

1. `mod.ts` owns format detection, streaming byte policy, and Sitemap semantics.
2. `mod.test.ts` covers XML/feed/text behavior and safety limits.
3. `differential.test.ts` compares production semantics against Saxes on the
   namespace/chunking corpus.
