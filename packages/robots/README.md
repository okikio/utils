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

The [full API reference](API.md) includes parsed groups, rules and source records.

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

## Filter a local list of candidate pages

Parsing and matching fit into ordinary `Array.filter()`. Supply the same parsed document for every candidate; no network
operation is needed to test the policy itself.

```ts runnable=allowed-pages.ts
import { match, parse } from '@okikio/robots';

const policy = parse('User-agent: *\nDisallow: /private/\nAllow: /private/pricing\n');
const pages = ['/guide', '/private/report', '/private/pricing'];
const allowed = pages.filter((path) =>
	match(policy, {
		userAgent: 'ResearchBot',
		url: new URL(path, 'https://example.com').href,
	})
);
console.log(JSON.stringify(allowed));
```

```text output
["/guide","/private/pricing"]
```

| Call or value                         | Contract                                                         | Meaning                                                                          |
| ------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `parse(text)`                         | String → `{ groups, sitemaps, extensions, records }`             | Retains rule groups and one-based source lines; does not fetch anything.         |
| Rule                                  | `{ kind: 'allow' \| 'disallow', pattern: string, line: number }` | Source instruction, not a global access-control rule.                            |
| `match(document, { userAgent, url })` | Document + absolute URL → boolean                                | `true` means this local rule evaluation permits the path. An invalid URL throws. |
| `getSitemapUrls(document)`            | Document → readonly string array                                 | Returns distinct absolute HTTP(S) sitemap declarations.                          |

Under the hood, parsing groups consecutive user-agent records and preserves extensions separately. Matching selects the
most specific matching agent groups, checks path plus query against their patterns, and chooses the longest matching
rule with wildcard/end markers excluded from its length. Allow wins a tie; no matching rule permits the URL.

Those overlapping-rule mechanics are why collecting every Disallow line is insufficient. Acquisition remains a separate
decision: the application must select the correct site's policy and decide what a failed fetch means. A successful local
check is not authentication or proof that a server will serve the page.

## Build on the example

- Use [Sitemap](../sitemap/README.md) to read declared page candidates, then keep only candidates allowed by the local
  robots policy. The runnable discovery example below shows those two decisions separately.
- Use a [Context](../context/README.md) cancellation signal for the application's policy fetch, with explicit network
  and byte budgets. Your application decides what a missing or failed policy response means.

## The ordinary problem

Collecting every `Disallow:` line loses which user-agent group owns it. It also misses more specific `Allow` rules,
wildcards and comments. Parsing those details once lets a crawler apply the same local policy to many candidate pages.

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
