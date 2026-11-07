# Http: response

Suppose a save operation returns `{ id: "asset-1" }`. The response definition describes the allowed body and status;
`create()` attaches that definition to this one result. `materialize()` checks the value and prepares headers and body
for the native Web `Response` that HTTP callers read. These steps keep the answer consistent across many requests.

The program below starts with a locally supplied ID and ends by reading the exact JSON a caller would receive. It
creates no network listener. A schema is an executable value rule; parsing JSON alone does not check those fields.

## Run a complete task

Create an ordinary checked JSON response. This program supplies its own local input and uses public
workspace imports. After `mise run prepare -- --kind deps`, save it as `example.ts` at the checkout root and run
`mise exec -- deno run example.ts`.

```ts runnable=complete-task.ts
import * as response from '@okikio/http/response';
import * as schema from '@okikio/schema';

// Many calls can share this definition; each call supplies its own body.
const Saved = response.ok(schema.object({ id: schema.string() }), {
	id: 'asset.saved',
	description: 'Saved asset.',
});
const occurrence = response.create(Saved, { id: 'asset-1' });
const value = await response.materialize(occurrence);
console.log(value.status);

// Encode the checked JSON value as the native response the caller consumes.
const outgoing = Response.json(value.body, { status: value.status, headers: response.toHeaders(value.headers) });
console.log(await outgoing.text());
```

Expected output:

```text output
200
{"id":"asset-1"}
```

Compare the output before changing the input. The remaining sections explain the options and limits; the
[package example](../../packages/http/response/README.md) also places this operation among adjacent capabilities.

## Definition, occurrence, native response

These values represent separate stages. Keeping them separate lets the same contract describe many individual responses:

| Value                                                                | Representative fields                                      | Purpose                                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `ResponseDefinition` from `ok(schema, options)`                      | `id`, `status`, `schema`, `mode`, `contentType`, `headers` | Reusable rule for a class of successful answers                             |
| `ResponseResult` from `create(Saved, body)`                          | Readonly `[body, status, headers]` tuple                   | One answer, with hidden metadata retaining the exact definition             |
| `FinalizedResponseResult` from `await materialize(result, options?)` | `{ definition, body, status, headers }`                    | Request-aware representation, including configured envelopes and pagination |
| Web `Response`                                                       | `status`, native `Headers`, readable `body`                | Transport value the caller can consume                                      |

`create()` merges fixed and occurrence headers and records the exact definition association. It accepts ordinary schema
input, or a codec's application value. `prepare()` validates or encodes that value once and retains the returned
representation. `finalize()` only adds presentation details such as envelopes and pagination links. A standalone adapter
uses `await materialize()` to compose both stages; Server performs the same two stages before sending the response.

The native conversion in this example is specific to JSON. `Response.json(value.body)` serializes that value as JSON;
it cannot forward a byte stream or file body. Let Service choose the transport conversion for declared stream/download
modes. A standalone application can still use the lower-level helpers, but must select the native body representation
and own its read or cancellation. A definition is optional when an ordinary `Response.json()` already meets the task.

## Build on the example

For an upload API, declare a saved-record result on an [endpoint](../../packages/server/endpoint/README.md), return it
from the handler, and let the [service](../../packages/server/service/README.md) validate and materialize it. Declare a
[problem](../../packages/http/problem/README.md) for expected rejections so success and failure each have a documented
shape.

For a CSV export, combine a download response with a safe filename and the
[CSV writer](../../packages/format/csv/README.md). Choose a bounded buffered result or an intentional stream according
to the export size. For search results, use pagination with
[request query parsing](../../packages/http/request/README.md). A response body must be read or cancelled by its
consumer so stream-owned cleanup can finish.

## Response flow

The handler creates a logical result. Server checks its exact declaration, prepares the validated output, adds
request-aware headers and pagination, and creates the native Response. JSON bodies use the shared finite JSON value
contract before serialization. Raw text and byte streams retain explicitly declared media types.

`response.create()` combines one exact definition with the logical body. `await response.materialize()` performs the
last request-aware transformation, such as building pagination links from the public request URL.

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
`await response.materialize()` can add RFC 8288 links and count metadata according to the response definition.

Inside a handler, `WidgetPage` is your declared paginated response, `items` is the already selected page, and
`nextCursor` is the storage adapter's continuation token. This fragment returns a page window; it does not query storage.

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

For a fetch your application already needs, `url` is its chosen upstream URL and `signal` is the request's cancellation
signal. Discard the rejected response before throwing so its source can stop. This is a fragment inside that caller's
operation; the application must also consume or transfer the successful body.

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

## Download the same asset as a CSV file

A download is still a Response. This variation sends actual file text and a safe filename header; the helper does not
open a file. Save as `asset-download.ts` and run `mise exec -- deno run asset-download.ts`.

```ts runnable=asset-download.ts
import { attachmentDisposition } from '@okikio/http/response';
const outgoing = new Response('id\nasset-1\n', {
	headers: {
		'content-type': 'text/csv',
		'content-disposition': attachmentDisposition('reports/assets.csv'),
	},
});
console.log(outgoing.headers.get('content-disposition'));
console.log((await outgoing.text()).trim());
```

```text output
attachment; filename="assets.csv"
id
asset-1
```

The caller consumes the body once. If real bytes come from a file or remote stream, its owner must also arrange
cancellation and release; constructing a filename header supplies neither authorization nor file ownership.
