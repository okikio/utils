`@okikio/robots`
=================

Purpose
-------

`@okikio/robots` parses one `robots.txt` document and evaluates its local
Allow/Disallow rules. It also returns absolute `Sitemap:` declarations and
preserves unknown extension records for higher-level consumers.

The package is deliberately network-free. HTTP status handling, redirects,
cache lifetime, authority rules, fetch limits, and Sitemap retrieval belong to
the discovery layer that acquires the file.

The ordinary problem
--------------------

The file format looks simple enough to split by lines:

```ts
const disallowed = text
  .split(/\r?\n/u)
  .filter((line) => line.toLowerCase().startsWith('disallow:'))
  .map((line) => line.slice(line.indexOf(':') + 1).trim());
```

That stops being sufficient when several user-agent groups exist, `Allow` and
`Disallow` overlap, wildcard rules are present, comments appear after values, or
an application needs the original line for diagnostics.

Use the utility
---------------

Parse once and check many URLs:

```ts
import * as robots from '@okikio/robots';

const document = robots.parse(`
  User-agent: *
  Disallow: /private/
  Allow: /private/public/
  Sitemap: https://example.com/sitemap.xml
`);

console.log(robots.match(document, {
  userAgent: 'KaijuBot',
  url: 'https://example.com/private/report',
})); // false

console.log(robots.match(document, {
  userAgent: 'KaijuBot',
  url: 'https://example.com/private/public/index.html',
})); // true

console.log(robots.getSitemapUrls(document));
// ['https://example.com/sitemap.xml']
```

Matching uses the most specific matching user-agent group, then longest matching
rule. `Allow` wins an equal-length tie. Patterns support `*` and a terminal `$`.

Use with other utilities
------------------------

A discovery layer can combine robots policy with Sitemap parsing without making
either syntax package own HTTP:

```ts
import * as robots from '@okikio/robots';
import * as sitemap from '@okikio/sitemap';

const policy = robots.parse(robotsText);

for (const sitemapUrl of robots.getSitemapUrls(policy)) {
  const source = await fetchText(sitemapUrl);
  for (const record of sitemap.parse({ text: source, url: sitemapUrl })) {
    if (robots.match(policy, { userAgent: 'KaijuBot', url: record.loc })) {
      await addCandidate(record.loc);
    }
  }
}
```

The consuming discovery package still decides whether robots rules should be
applied to a candidate and how fetched responses affect policy.

Parity target
---------------

The local matcher has focused corpus coverage, but this repository does **not**
claim Google `robotstxt` parity yet. The upstream Google corpus remains a
required conformance gate before that claim can be made.

Convenience and the manual equivalent
-------------------------------------

| Convenience | Manual equivalent | Utility-owned invariant |
| --- | --- | --- |
| `robots.parse()` | line parser + group state + comment stripping + sitemap validation + extension retention | one reusable syntax document |
| `robots.match()` | user-agent specificity + wildcard matching + longest-rule selection + tie behavior | one deterministic local decision |

Source guide
------------

1. `mod.ts` contains parsing and current matching semantics.
2. `mod.test.ts` contains the local conformance and edge-case corpus.
3. Do not infer HTTP/crawl policy from this package; inspect the consuming
   discovery layer for those decisions.
