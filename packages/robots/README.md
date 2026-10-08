# `@okikio/robots`

You are building a crawler and a website's `robots.txt` says to skip private pages but allows its pricing page. `robots`
reads those instructions and answers whether its local rules allow a particular URL for your crawler's name. The
crawler's **user agent** is the name used to select the relevant rules.

| Candidate path in the demo | Matching instruction                    | `match()` answer              |
| -------------------------- | --------------------------------------- | ----------------------------- |
| `/private/report`          | `Disallow: /private/`                   | `false`: local rules deny it. |
| `/private/pricing`         | More specific `Allow: /private/pricing` | `true`: local rules allow it. |

The table explains this document's two decisions. An allow decision is not authentication, a successful download or
permission to ignore other site policies. Fetch errors and cache policy belong to the crawler.

For shared terms such as `await` and `await using`, see
[the short glossary](../../docs/learn.md#read-the-small-amount-of-code-you-need).

## Run a complete example

```ts runnable
import * as robots from '@okikio/robots';
const policy = robots.parse(`User-agent: *
Disallow: /private/
Allow: /private/pricing
`);
console.log(robots.match(policy, { userAgent: 'ResearchBot', url: 'https://example.com/private/report' }));
console.log(robots.match(policy, { userAgent: 'ResearchBot', url: 'https://example.com/private/pricing' }));
```

Expected output:

```text output
false
true
```

The demo supplies a policy string and checks two URLs against it. The longer matching pricing rule wins for the second
URL. Remove that Allow line to make both examples denied by the private-path rule. No website is contacted while these
checks run.

## Build on the example

- Use [Sitemap](../sitemap/README.md) to read declared page candidates, then keep only candidates allowed by the local
  robots policy. The runnable discovery example below shows those two decisions separately.
- Use a [Context](../context/README.md) cancellation signal for the application's policy fetch, with explicit network
  and byte budgets. Your application decides what a missing or failed policy response means.

Parse once and check many URLs, then collect declared sitemaps for discovery. Unknown extension records remain available
for higher-level policy. The parser performs no fetch and does not decide HTTP status, caching or authority rules. The
application owns acquisition limits and whether a failed robots fetch should allow or deny crawling.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Purpose

`@okikio/robots` parses one `robots.txt` document and evaluates its local Allow/Disallow rules. It also returns absolute
`Sitemap:` declarations and preserves unknown extension records for higher-level consumers.

The package is deliberately network-free. HTTP status handling, redirects, cache lifetime, authority rules, fetch
limits, and Sitemap retrieval belong to the discovery layer that acquires the file.

## The ordinary problem

The file format looks simple enough to split by lines:

```ts
const disallowed = text
	.split(/\r?\n/u)
	.filter((line) => line.toLowerCase().startsWith('disallow:'))
	.map((line) => line.slice(line.indexOf(':') + 1).trim());
```

That stops being sufficient when several user-agent groups exist, `Allow` and `Disallow` overlap, wildcard rules are
present, comments appear after values, or an application needs the original line for diagnostics.

## Use the utility

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

Matching uses the most specific matching user-agent group, then longest matching rule. `Allow` wins an equal-length tie.
Patterns support `*` and a terminal `$`.

## Use with other utilities

Kaiju Crawl combines declared Sitemap sources with local robots policy. Supply the fetched bytes explicitly, parse
records and retain allowed page candidates. This complete version uses supplied sources and performs no network I/O.

```ts runnable=discover-pages.ts
import * as robots from '@okikio/robots';
import * as sitemap from '@okikio/sitemap';

const policy = robots.parse('User-agent: *\nDisallow: /private/\nSitemap: https://example.com/sitemap.xml\n');
const sources = new Map([
	[
		'https://example.com/sitemap.xml',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
		'<url><loc>https://example.com/guide</loc></url>' +
		'<url><loc>https://example.com/private/report</loc></url></urlset>',
	],
]);
const candidates: string[] = [];
for (const url of robots.getSitemapUrls(policy)) {
	const text = sources.get(url);
	if (text === undefined) throw new Error('No source was supplied for the declared sitemap.');
	for (const record of sitemap.parse({ url, text })) {
		if (record.kind === 'url' && robots.match(policy, { userAgent: 'KaijuBot', url: record.loc })) {
			candidates.push(record.loc);
		}
	}
}
console.log(JSON.stringify(candidates));
```

```text output
["https://example.com/guide"]
```

`robots.parse()` returns a `RobotsDocument`; `sitemap.parse()` returns `readonly SitemapRecord[]`; `robots.match()`
returns a boolean. `candidates` is the application's `string[]`. These calls acquire no network resource and require no
disposal. Parser problems belong to their returned document/record contracts; the explicit missing-source error belongs
to this application.

The application decides how HTTP status, redirect limits, nested sources and a failed robots fetch affect its policy.
For the streaming acquisition path, see [the sitemap guide](../sitemap/README.md#use-with-other-utilities).

## Parity target

The local matcher has focused corpus coverage, but this repository does **not** claim Google `robotstxt` parity yet. The
upstream Google corpus remains a required conformance gate before that claim can be made.

## Convenience and the manual equivalent

| Convenience      | Manual equivalent                                                                        | Utility-owned invariant          |
| ---------------- | ---------------------------------------------------------------------------------------- | -------------------------------- |
| `robots.parse()` | line parser + group state + comment stripping + sitemap validation + extension retention | one reusable syntax document     |
| `robots.match()` | user-agent specificity + wildcard matching + longest-rule selection + tie behavior       | one deterministic local decision |

## Source guide

1. `mod.ts` contains parsing and current matching semantics.
2. `mod.test.ts` contains the local conformance and edge-case corpus.
3. Do not infer HTTP/crawl policy from this package; inspect the consuming discovery layer for those decisions.
