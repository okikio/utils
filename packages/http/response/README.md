# `@okikio/http/response`

An API may return a saved record, a page of results or a file download. Repeating status codes, body rules and headers
in every handler makes those answers drift. This package gives each successful answer a reusable description and creates
individual result values from it. A schema is the executable rule describing the permitted body shape.

A **definition** describes the answers an operation is allowed to return, such as status 200 with `{ id: string }`.
An **occurrence** is one answer, such as `{ id: "asset-1" }`. A native Web `Response` is the HTTP value a caller can read.
These are three stages, not three network requests. Keeping the definition separate lets documentation and many calls
share the same rule without opening a listener or producing a response at import time.

```text
Response definition + result body -> create -> logical result
Logical result -> materialize validates and presents -> Response constructor -> native Response -> caller
```

A logical result holds a body, status and headers associated with a definition. It is not a native Web `Response`,
and creating it does not validate its body. `materialize()` validates and presents
that value; the native Response constructor below adapts it to Fetch. Server's service runtime normally performs
these stages for its handlers. The caller owns reading or cancelling the resulting body.

## Return a saved asset record

Define the saved-asset response once, materialize a value against it, and construct a native Response. The application then sends the checked status, headers and body through a native Response.

These examples use the current experimental source checkout, not an assumed registry release. From the `utils`
repository root, review `mise.toml`, run `mise trust`, then `mise install` and `mise run prepare -- --kind deps`.
Save the following module as `example.ts` and run `mise exec -- deno run example.ts`.
[Checkout prerequisites](../../../README.md#work-on-the-repository) explain installing Mise.

```ts runnable
import * as response from '@okikio/http/response';
import * as schema from '@okikio/schema';
const Saved = response.ok(schema.object({ id: schema.string() }), { id: 'asset.saved', description: 'Saved asset.' });
// Validate and materialize the declared body before adapting it to a Web Response.
const value = await response.materialize(response.create(Saved, { id: 'asset-1' }));
console.log(value.status);
const outgoing = Response.json(value.body, { status: value.status, headers: response.toHeaders(value.headers) });
console.log(await outgoing.text());
```

Expected output:

```text output
200
{"id":"asset-1"}
```

The demo describes a `200` result whose body has a string `id`, then creates the occurrence `{ id: 'asset-1' }`.
`materialize()` validates the body and exposes its converted value with status and transport metadata. The next line
turns those values into an ordinary `Response` and reads its JSON text. No file or network connection is opened in this local example.

Use `Response.json()` directly when one handler only needs to return ordinary JSON. A reusable response definition
becomes useful when several handlers, OpenAPI or a typed service must agree on the same answer. In that case:

1. `ok()` declares the status and body rule once. It does not produce an answer.
2. `create()` associates one body with that exact declaration. Validation has not run yet.
3. `materialize()` validates and converts that body, then adds transport metadata.
4. The native `Response` carries the actual HTTP bytes. Reading or cancelling it belongs to the caller.

The `Response.json()` conversion above is for a JSON body. Do not apply it to a stream or download: that would serialize
the body object instead of forwarding its bytes. A [Service](../../server/service/README.md) performs the correct transport
conversion for declared response modes, including streams. The standalone helpers also remain useful without a service.

## Conditional request dates

`Last-Modified` and `If-Modified-Since` carry HTTP-date text, including the protocol's older weekday/month spellings.
Their existing Date parser stays local to conditional-request evaluation; Temporal's ISO parser accepts a different
language. Invalid parse results do not satisfy the condition. ETag comparison continues to use `@std/http/etag` and
takes precedence when `If-None-Match` is present. These wall timestamps do not measure elapsed execution time.

## Validate and convert each body once

For an ordinary Standard Schema, `create()` accepts the schema input. `prepare()` validates it once and keeps the
validator's returned value. Fields removed by validation remain absent, and transformations are applied once. For an
explicit `schema/codec`, `create()` accepts the application value and `prepare()` uses its encoder. Page definitions apply the same rule to every item;
validation issues include the item index. Handlers never need to pre-parse a value and then feed the output back into a
different input type.

Server calls `prepare()` before its transport step. Standalone adapters use `await materialize(result, options)`, which
composes preparation and presentation. The lower-level synchronous `finalize()` only adds envelopes, links, headers and
timestamps to an already prepared result. It does not validate or transform data.

Body and page definitions default to `application/json`, including primitive strings and null. Server serializes those
values as JSON and rejects values with no faithful JSON representation. Use an explicit `contentType: 'text/plain'` for
raw text. HTML, stream and download modes carry pre-encoded bodies; the same `mediaType()` policy drives OpenAPI. Dates
and other application objects need a codec that emits JSON values before a JSON response is written.

For bounded `readBytes()` or `readText()`, `bodyCleanup(response)` exposes eventual source cancellation as an outcome.
Overflow and abort release the reader promptly; a delayed cancellation failure remains inspectable separately from the
read's primary failure. The same rule applies when Content-Length rejects a response before reading starts.

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

## Choose adjacent capabilities

Use Response to construct protocol output. Endpoint declares which output variants a checked operation may return, and
Service binds that operation to a host. Creating a Response does not open a listener.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

Continue in the [numbered guide](https://github.com/okikio/utils/blob/main/docs/http/06-response.md) for composition,
ownership, and failure behavior.
