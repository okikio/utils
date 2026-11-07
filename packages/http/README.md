# `@okikio/http`

A web request can contain several values with the same name, cookies, credentials and a body that is larger than your
application can accept. Reading those values carelessly can lose a user's choices or send private headers to another
service. `@okikio/http` supplies focused tools for reading requests, describing responses and verifying webhook
messages. You can use one tool with an ordinary Web `Request` or combine them in a service.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

HTTP is the exchange between a caller and a server: the caller sends a `Request`, and the server returns a `Response`.
This package works on those values. Choose the part that matches your task:

```text
Incoming Request                         Outgoing result
  query, headers, body -> request tools     success -> response definition
  named browser cookie -> cookie tools     rejection -> problem definition
  signed provider event -> webhook tools
                    application decides what to do
```

Read the left side as ways to interpret an incoming message and the right side as ways to describe an answer. The
application connects them with its own decisions. Parsing a token does not authenticate it, and accepting bytes does not
make their contents valid for your business rules.

## Keep every search filter in a native handler

From the Utils checkout, review `mise.toml`, then run `mise trust`, `mise install` and `mise run prepare -- --kind deps`.
Save this complete program as `http-search.ts` and run `mise exec -- deno run http-search.ts`.
It calls an ordinary function with a Request; it opens no port.

```ts runnable=http-search.ts
import { parseQuery } from '@okikio/http/request';

/** Preserve repeated tag values before the application chooses how to apply them. */
function search(incoming: Request): Response {
	const query = parseQuery(new URL(incoming.url).search);
	// A missing tag, one tag, and repeated tags have distinct parser shapes. Normalize them for this endpoint.
	const rawTags = query.tag;
	let tags: readonly string[];
	if (rawTags === undefined) {
		tags = [];
	} else if (typeof rawTags === 'string') {
		tags = [rawTags];
	} else {
		tags = rawTags;
	}
	return Response.json({ filters: tags });
}

const outgoing = search(new Request('https://service.invalid/search?tag=art&tag=music'));
console.log(await outgoing.text());
```

```text output
{"filters":["art","music"]}
```

The parser preserves three distinct cases. The handler converts them into one array shape before application work:

| URL input | Parsed `tag` | Normalized tags |
| --- | --- | --- |
| No `tag` | `undefined` | `[]` |
| `?tag=art` | `'art'` | `['art']` |
| `?tag=art&tag=music` | `['art', 'music']` | `['art', 'music']` |

The repeated `tag` field represents two choices. The handler preserves both rather than using only the last one.
It needs no router, schema or execution context. Parsing keeps text intact; deciding which tags a search supports is
still application work.

When that same search forwards a request, remove connection-specific fields before sending it to another service:

```ts runnable=forward-search.ts
import { forward } from '@okikio/http/headers';

// Connection names the field that belongs only to this network hop.
const headers = forward(
	new Headers({
		Connection: 'X-Internal',
		'X-Internal': 'secret',
		Accept: 'application/json',
	}),
);
console.log(headers.has('x-internal'), headers.get('accept'));
```

```text output
false application/json
```

`Connection` names `X-Internal` as hop-specific, so `forward()` removes it and keeps `Accept`. This operation handles
connection headers. Use `request.forwardHeaders()` or Gateway when credential and forwarded-host trust policy must also
be applied; removing hop-by-hop fields alone is not a complete credential policy.

## What the functions receive and return

| Call                                  | Input                                                     | Output and work performed                                                                         |
| ------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `request.parseQuery(search)`          | Raw URL query text                                        | A readonly record whose values are strings or arrays of strings; repeated values keep their order |
| `request.readBody(incoming, options)` | Native `Request`, optional byte limits                    | `Promise<Uint8Array>`; consumes the body under a byte budget                                      |
| `forward(headers)`                    | Native `Headers`                                          | New sanitized headers; removes hop-by-hop fields, including names listed in `Connection`          |
| `response.create(Definition, body)`   | Reusable response description and one body                | Logical `[body, status, headers]` result associated with that exact definition                    |
| `problem.create(Definition, options)` | Reusable rejection description and safe occurrence detail | Problem `[body, status, headers]` result                                                          |

One level deeper, query parsing uses `URLSearchParams` for decoding and collects repeated occurrences instead of
overwriting a previous value. Body reading checks a declared length, counts actual chunks, and cancels its reader on
overflow or abort. Header forwarding gathers the fixed hop-by-hop names and the names nominated by `Connection`, then
copies the remaining fields. The design keeps parsing, trust and application validation separate: a preserved search
filter is still text until your application decides which filters are supported.

Start with the native handler above. Add response or problem definitions when several handlers need the same checked
answer shape; add a service when you want that checking performed automatically. You can read the
[public source contracts](./mod.ts) without adopting those additional layers.

## Choose value helpers or a complete service

For a search API, combine [request parsing](./request/README.md) with an [endpoint](../server/endpoint/README.md) that
validates the allowed filters. Return a [response](./response/README.md) for matching records or a declared
[problem](./problem/README.md) for an unsupported filter. This separates the user's exact input from the rules your
search supports.

For a provider callback, use [webhook verification](./webhook/README.md) before decoding the event, then pass the
verified message to your application. For forwarding to another service, choose `request.forwardHeaders()` when
credential and host policy must accompany connection-header removal. The [gateway](../server/gateway/README.md) composes
those decisions with route ownership. Neither parsing nor forwarding decides which actor may access a record.

[Choose related utilities by outcome](../../docs/07-outcomes.md). The focused READMEs explain each value before the larger service composition.

## Authenticate bytes independently of an HTTP framework

A stored callback payload can need authentication before it becomes a request or parsed object. Signature signs exact
bytes. The demonstration secret is public example input and must not be used as a real credential.

```ts runnable=authenticate-bytes.ts
import { sign, verify } from '@okikio/http/signature';

const secret = 'example-only-secret';
const bytes = new TextEncoder().encode('{"asset":"photo-1"}');
const signature = await sign(secret, bytes);
console.log(await verify(secret, bytes, signature));
const changed = new TextEncoder().encode('{"asset":"photo-2"}');
console.log(await verify(secret, changed, signature));
```

```text output
true
false
```

The changed payload cannot reuse the original signature. A successful verification does not establish freshness,
audience, authorization, or single delivery. Include the required version, expiry, and scope in the signed bytes and
check them through application policy. Use Webhook when receiving a protocol-defined signed request, and Hash when only
content integrity without a secret key is required.

## Carry HTTP values across a framework boundary

A search URL can contain repeated filters; a webhook needs its exact signed bytes; a file response needs correct
representation headers. These are distinct protocol jobs.

Choose Request for input, Response for output, Problem for expected failures, Cookie for state, and Signature or Webhook
for authenticated bytes. Server owns routing and application composition.

Verify bytes before interpreting signed JSON. The application chooses secrets, replay policy, trust of forwarded
headers, and the meaning of failures.

## Choose an entry point

Use the table to find a focused import for the job you need. Contract links open the exact public source, including its
options and types.

| Import                             | Use it to                                                                       | Exact contract                       |
| ---------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------ |
| `@okikio/http`                     | Use the package entry shown in the complete examples above.                     | [Contract](./mod.ts)                 |
| `@okikio/http/cookie`              | Parse and serialize cookies with explicit attributes and value policy.          | [Contract](./cookie/mod.ts)          |
| `@okikio/http/problem`             | Declare and render expected HTTP problems.                                      | [Contract](./problem/mod.ts)         |
| `@okikio/http/problem/testing`     | Assert problem responses in contract tests.                                     | [Contract](./problem/testing/mod.ts) |
| `@okikio/http/request`             | Read repeated query fields, bounded bodies, and forwarding metadata.            | [Contract](./request/mod.ts)         |
| `@okikio/http/webhook`             | Verify signed request bytes before interpreting an event.                       | [Contract](./webhook/mod.ts)         |
| `@okikio/http/webhook/standard`    | Use the Standard Webhooks signing and verification profile.                     | [Contract](./webhook/standard.ts)    |
| `@okikio/http/retry` | Parse bounded Retry-After advice; the caller owns waiting, safe body replay and retry execution. | [Contract](./retry.ts) |
| `@okikio/http/response`            | Construct responses and apply protocol conditions.                              | [Contract](./response/mod.ts)        |
| `@okikio/http/response/body`       | Construct response bodies with explicit representation choices.                 | [Contract](./response/body.ts)       |
| `@okikio/http/response/types`      | Import public types for this capability; this entry does not start work.        | [Contract](./response/types.ts)      |
| `@okikio/http/response/headers`    | Apply response-header operations without constructing a server.                 | [Contract](./response/headers.ts)    |
| `@okikio/http/response/completion` | Observe response completion through its explicit lifecycle contract.            | [Contract](./response/completion.ts) |
| `@okikio/http/response/http`       | Apply HTTP response negotiation and conditional-request behavior.               | [Contract](./response/http.ts)       |
| `@okikio/http/response/status`     | Use named status contracts when composing response behavior.                    | [Contract](./response/status.ts)     |
| `@okikio/http/problem/types`       | Import public types for this capability; this entry does not start work.        | [Contract](./problem/types.ts)       |
| `@okikio/http/request/types`       | Import public types for this capability; this entry does not start work.        | [Contract](./request/types.ts)       |
| `@okikio/http/headers`             | Inspect and transform HTTP headers independently of a request handler.          | [Contract](./headers.ts)             |
| `@okikio/http/signature`           | Sign or verify authenticated bytes; the application owns key and replay policy. | [Contract](./signature/mod.ts)       |
| `@okikio/http/events`              | Read and write bounded server-sent event streams.                               | [Contract](./events.ts)              |

## Read or write bounded SSE wire messages

SSE carries named events and IDs over a byte stream. Write two greeting events, then parse those bytes back into
wire messages. Save `greeting-events.ts` and run `mise exec -- deno run greeting-events.ts`:

```ts runnable=greeting-events.ts
import { readable } from '@okikio/streams';
import * as events from '@okikio/http/events';
const limits = { maximumBytes: 1024, maximumChunkBytes: 1024, maximumEventBytes: 256, maximumEvents: 2 };
const encoded = events.write(
	readable([
		{ id: '1', event: 'greeting', data: 'Hello, Sam!' },
		{ id: '2', event: 'greeting', data: 'Hello, Jo!' },
	]),
	limits,
);
for await (const message of events.read(readable(encoded), limits)) console.log(message.id, message.data);
```

```text output
1 Hello, Sam!
2 Hello, Jo!
```

The focused entry composes STD's browser-compatible SSE parser and writer. Read budgets count total original bytes, each
provider chunk, raw bytes between blank logical lines, and returned wire messages. Comments and unknown fields consume
raw byte budgets too. CR, LF, CRLF and split initial UTF-8 BOM follow the parser's rules. Admission checks a complete
input chunk before giving it to STD, so a later oversize frame can reject earlier messages in that same chunk. The
parser's retention is bounded by admitted event/chunk sizes; these byte limits do not count JavaScript object overhead
or the provider's original allocation.

These are **wire messages**: comments, id-only and retry-only messages are exposed, and STD emits a nonempty final
message without a terminating blank line. This is not browser EventSource dispatch. An absent ID is not filled from an
earlier message. The caller owns Last-Event-ID state, retry timing and any reconnect loop. Retry values must fit safe
nonnegative milliseconds. Writing rejects NUL in IDs, newlines in ID/event, invalid counters and oversized serialized
messages. Native UTF-8 replacement behavior is retained.

Both iterators own their source reader, stop on early return and release its lock promptly. `signal` interrupts a
pending read. `onCleanup` receives the eventual actual source cancellation outcome, including late failure; it is
separate from the consumer's refusal or cancellation. `preventCancel` releases a borrowed source without requesting its
cancellation.

## Stream finite JSON values in one native Response

NDJSON is one JSON value per line. This version streams the same greeting data and joins source cleanup. Save
`greeting-lines.ts` and run `mise exec -- deno run greeting-lines.ts`:

```ts runnable=greeting-lines.ts
import { readable } from '@okikio/streams';
import { jsonl, jsonlCompletion } from '@okikio/http/response';
const response = jsonl(readable([{ message: 'Hello, Sam!' }, { message: 'Hello, Jo!' }]), {
	maximumBytes: 1024,
	maximumRecordBytes: 128,
	maximumItems: 2,
	projection: { maximumDepth: 3, maximumNodes: 10, maximumStringCodeUnits: 80 },
});
console.log((await response.text()).trim());
const delivered = await jsonlCompletion(response);
console.log(delivered.outcome, (await delivered.cleanup).status);
```

```text output
{"message":"Hello, Sam!"}
{"message":"Hello, Jo!"}
completed completed
```

`jsonl` returns one native Response. `jsonlCompletion` observes that same object without adding a response wrapper. It
only accepts responses created by this factory. The terminal outcome is completed, cancelled or errored; byte counts
mean enqueued output, not remote receipt. Source cleanup remains a separate promise so a stalled or failed cancellation
hook cannot keep the input lock held.

The body serializes one finite JSON value per pull, with LF included in record and total byte limits. Traversal limits
reject cycles, accessors and non-JSON values; no toJSON hook runs. Local deterministic key ordering follows Collection's
JSON profile. Schema/codec validation belongs upstream. The factory owns a reader at construction but reads only on
demand, and cancels even before the first pull. For `method: 'HEAD'` or status 204/205/304 it creates no reader: the
unused source remains caller-owned. Metadata is checked before acquiring ownership. Content-Type is NDJSON and
Content-Length is removed. Serialization, source and limit errors remain on the native body and its completion record.

For routes that cancel early and resume a retained event feed, use the complete
[streaming greeting workflow](../../docs/server/10-http-streaming.md). For bounded POST/form input and signed callbacks,
use [request workflows](../../docs/server/09-http-input.md). For an AI client, the [MCP example](../../docs/server/11-mcp.md)
hosts a real SDK handler; SSE serialization alone does not implement MCP.

## Measure HTTP data and ownership

The focused benchmarks measure streaming bodies, validators, cookies, retry planning and webhook replay admission. The
benchmark compares against native or reduced-contract references named by each case. There is no network listener in
these package measurements.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
deno task --cwd=packages/http test
deno task --cwd=packages/http bench:check
deno task --cwd=packages/http bench
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.

## Check a representation before sending it again

A client that already has revision 42 can ask whether the same representation is still current. Check routing,
authentication and resource access first; then plan the conditional response without reading or writing its body.
This complete local handler returns status 304 when the client's `If-None-Match` matches the current ETag. Save it as
`conditional-asset.ts` and run `mise exec -- deno run conditional-asset.ts` after the checkout setup above.

```ts runnable=conditional-asset.ts
import { preconditions } from '@okikio/http/response/http';

/** The example assumes access is already allowed and this is the current representation. */
function readAsset(request: Request): Response {
	const etag = '"revision-42"';
	const plan = preconditions(request, {
		exists: true,
		etag,
		lastModified: 'Sun, 06 Nov 1994 08:49:37 GMT',
		now: Date.now(),
	});
	if (plan.kind === 'not-modified' || plan.kind === 'failed' || plan.kind === 'invalid') {
		return new Response(null, { status: plan.status, headers: { etag } });
	}
	// plan.range permits range evaluation; byteRange() separately decides satisfiability for real file routes.
	return new Response('Asset revision 42', { headers: { etag } });
}
const request = new Request('https://service.invalid/assets/1', { headers: { 'if-none-match': '"revision-42"' } });
console.log(readAsset(request).status);
```

```text output
304
```

The planner follows
[RFC 9110 precondition precedence](https://www.rfc-editor.org/rfc/rfc9110.html#name-precedence-of-preconditions). It
distinguishes strong If-Match, weak If-None-Match, representation existence, GET/HEAD cache validation and write
preconditions. Entity tags remain opaque even when their quoted value contains a comma. Malformed entity lists return an
invalid 400 plan; invalid request dates are ignored. The planner does not infer that a previous write already succeeded.
If-Range uses exact strong-tag comparison; date comparison requires `strongDate: true` from the representation owner.
That proof cannot be inferred merely from a Last-Modified header. Conditions do not read a body or perform the action.
CONNECT, OPTIONS and TRACE ignore conditions.

## Read Retry-After advice before choosing another attempt

A server can return a delay in `Retry-After`. `planRetryAfter()` parses that advice and caps it at your budget. It does
not wait or retry a request. This example receives three seconds of advice and admits at most two seconds. Save it as
`retry-advice.ts` and run `mise exec -- deno run retry-advice.ts`:

```ts runnable=retry-advice.ts
import { planRetryAfter } from '@okikio/http/retry';
const plan = planRetryAfter('3', { now: 0, maximumDelay: 2000, maximumCodeUnits: 100 });
if (plan.kind === 'delay') console.log(plan.milliseconds, plan.capped);
```

```text output
2000 true
```

The result distinguishes missing, invalid and usable delay data. Delays use whole milliseconds. Both decimal seconds
and the three HTTP-date grammars are accepted. Obsolete two-digit years use the supplied clock's 50-year horizon;
impossible calendar dates reject. Epoch time maps a leap-second `:60` to the following epoch second. Past dates produce
zero delay. Native-only formats such as ISO dates do not silently become valid Retry-After fields. The application
still owns replay safety, idempotency, deadlines and retry execution.

For browser preferences, the [Cookie example](./cookie/README.md#remove-a-saved-preference) shows updating and removing a
cookie while retaining its identity and attributes.

## Read further

The [Http guide](https://github.com/okikio/utils/blob/main/docs/http/01-guide.md) explains the model, manual
alternatives, and composition.
