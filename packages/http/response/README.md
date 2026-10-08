# `@okikio/http/response`

An API may return a saved record, a page of results or a file download. Repeating status codes, body rules and headers
in every handler makes those answers drift. This package gives each successful answer a reusable description and creates
individual result values from it. A schema is the executable rule describing the permitted body shape.

```text
Response definition + result body -> create -> logical result
Logical result -> service validates -> finalize -> service sends native Response
Download filename -> attachmentDisposition -> safe Content-Disposition value
```

The upper flow describes a result before a server writes it to the caller. `finalize()` still returns a plain finalized
value, not a native `Response`, and it does not replace the service's output validation. The filename flow prepares a
header value; it does not open a file or grant permission to download it.

## Return a saved record and name a download

```ts runnable
import * as response from '@okikio/http/response';
import { z } from 'zod';
const Saved = response.ok(z.object({ id: z.string() }), { id: 'asset.saved', description: 'Saved asset.' });
const value = response.finalize(response.create(Saved, { id: 'asset-1' }));
console.log(value.status);
const outgoing = Response.json(value.body, { status: value.status, headers: response.toHeaders(value.headers) });
console.log(await outgoing.text());
console.log(response.attachmentDisposition('reports/quarterly.csv'));
```

Expected output:

```text output
200
{"id":"asset-1"}
attachment; filename="quarterly.csv"
```

The demo describes a `200` result whose body has a string `id`, then creates the occurrence `{ id: 'asset-1' }`.
`finalize()` exposes the status, body and prepared transport metadata. The next line turns those values into an ordinary
`Response` and reads its JSON text. Separately, `attachmentDisposition()` reduces `reports/quarterly.csv` to the
download name `quarterly.csv`. That second line can become a `Content-Disposition` header. No file or network connection
is opened in this mini-demo.

## Definition, occurrence, native response

These are three different values. Keeping them separate lets the same contract describe many individual responses:

| Value                                                       | Representative fields                                      | Purpose                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `ResponseDefinition` from `ok(schema, options)`             | `id`, `status`, `schema`, `mode`, `contentType`, `headers` | Reusable rule for a class of successful answers                             |
| `ResponseResult` from `create(Saved, body)`                 | Readonly `[body, status, headers]` tuple                   | One answer, with hidden metadata retaining the exact definition             |
| `FinalizedResponseResult` from `finalize(result, options?)` | `{ definition, body, status, headers }`                    | Request-aware representation, including configured envelopes and pagination |
| Web `Response`                                              | `status`, native `Headers`, readable `body`                | Transport value the caller can consume                                      |

`create()` merges fixed and occurrence headers and records the definition association in a `WeakMap`; it does not run
the body schema. `finalize()` applies presentation policy, such as pagination links using the public URL; it also does
not run that schema. In the example the body is known locally. A service checks unknown handler output against the
declared schema before materialization. A manual host must perform that validation itself when needed.

This separation avoids baking one framework's response object into the API contract. It also gives TypeScript the exact
declared body type at construction. Use native `Response.json()` directly when no shared response contract is needed.
The [full contracts](../API.md#response) include the less common empty, redirect, pagination and streaming modes.

## Build on the example

For an upload API, declare a saved-record result on an [endpoint](../../server/endpoint/README.md), return it from the
handler, and let the [service](../../server/service/README.md) validate and materialize it. Declare a
[problem](../problem/README.md) for expected rejections so success and failure each have a documented shape.

For a CSV export, combine a download response with a safe filename and the [CSV writer](../../csv/README.md). Choose a
bounded buffered result or an intentional stream according to the export size. For search results, use pagination with
[request query parsing](../request/README.md). A response body must be read or cancelled by its consumer so stream-owned
cleanup can finish.

## Response flow

```text
endpoint handler
  -> logical response result
  -> verify declared definition and body
  -> finalize request-aware headers and pagination
  -> server framework materialization
  -> native Response
```

`response.create()` combines one exact definition with the logical body. `response.finalize()` performs the last
request-aware transformation, such as building pagination links from the public request URL.

A raw native `Response` remains an explicit escape hatch for proxying, WebSockets, server-sent events, or provider
responses. It is not the normal handler result.

## Headers and pagination

Header inputs preserve repeated fields. This is required for fields such as `Set-Cookie` that must not be flattened into
one comma-joined value.

Prepare reusable response headers with `headers()` when their values are fixed. The returned record owns frozen values
and keeps an admitted occurrence projection, so repeated reads and merges avoid revalidating the same data. Mutable
records, tuple lists and native `Headers` still receive fresh checks. This reuse preserves separate cookies and record
ordering; freezing an arbitrary caller record does not grant it the library's admission identity.

Storage adapters return transport-neutral cursor or offset page windows. They do not construct public URLs.
`response.finalize()` can add RFC 8288 links and count metadata according to the response definition.

```typescript
return response.create(WidgetPage, {
	kind: 'cursor',
	items,
	limit: 50,
	hasMore: true,
	nextCursor,
});
```

## Discarding an unread body

A native `Response` owns a readable body until the caller consumes it, transfers that body to another response, or
deliberately abandons it. Use `discard()` when the body is no longer part of the result. The operation cancels an
unlocked body and keeps cleanup failure secondary to the HTTP decision that made the body unnecessary.

```typescript
import * as response from '@okikio/http/response';

const upstream = await fetch(url, { signal });
if (!upstream.ok) {
	await response.discard(upstream);
	throw new Error(`Upstream returned ${upstream.status}.`);
}
```

If a reader already owns the body, cancel that reader instead. `discard()` does not take a locked stream away from its
current owner.

## Special HTTP helpers

`onComplete()` observes response-body drain, cancellation, abort, or stream failure exactly once.

Conditional response helpers support declared `304` results. Byte-range helpers support single open, suffix, bounded,
and unsatisfiable ranges for artifact and download adapters.

The server package owns content negotiation, endpoint membership checks, and conversion to the framework response
object.

## Recognized status is not the same as constructible status

The status helpers can recognize historical wire values that the response constructors should not emit. RFC 9110 keeps
`305 Use Proxy` as deprecated and `306` as reserved/unused. `response.redirectStatus` therefore recognizes them when
inspecting external HTTP, while `response.redirect()` only constructs currently supported redirect responses.

```ts
response.redirectStatus.is(305); // true: recognized historical status
response.redirectStatus.is(306); // true: recognized reserved status

response.redirect(308, {
	description: 'Resource moved permanently.',
}); // supported
```

There is no convenience constructor for 305 or 306. Manually, the distinction is the same as keeping one set for
protocol recognition and a smaller set for statuses your application is willing to produce.

## Current status registry

The recognition schemas follow the current IANA HTTP Status Code Registry rather than only the original RFC 9110 table.
As of August 2026, `104 Upload Resumption Supported` is a temporary informational status registered through November
13, 2026. It is recognized by `response.informationalStatus` and `response.statusAny`, but this package does not provide
a response constructor for informational statuses.

```ts
response.informationalStatus.is(104); // true while the IANA registration is current
```

The manual equivalent is a reviewed status-code set derived from the IANA registry. Temporary and obsolete codes should
remain visibly annotated so recognition policy can be revisited without changing application response constructors by
accident.
