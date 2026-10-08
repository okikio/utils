# `@okikio/http`

A web request can contain several values with the same name, cookies, credentials and a body that is larger than your
application can accept. Reading those values carelessly can lose a user's choices or send private headers to another
service. `@okikio/http` supplies focused tools for reading requests, describing responses and verifying webhook
messages. You can use one tool with an ordinary Web `Request` or combine them in a service.

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

## Keep every search filter, remove private forwarding headers

```ts runnable
import * as request from '@okikio/http/request';
import { forward } from '@okikio/http/headers';
console.log(JSON.stringify(request.parseQuery('?tag=one&tag=two')));
const headers = forward(new Headers({ Connection: 'X-Internal', 'X-Internal': 'secret', Accept: 'application/json' }));
console.log(headers.has('x-internal'), headers.get('accept'));
```

Expected output:

```text output
{"tag":["one","two"]}
false application/json
```

The first input asks for both `tag=one` and `tag=two`. `parseQuery()` keeps them as an array, so a search page can use
both filters. The second input names `X-Internal` in the `Connection` header. `forward()` removes that
connection-specific field while keeping `Accept`, which still tells the next service which response format the caller
accepts. The two output lines show preserved choices and removal of a field that must not cross the forwarding hop.

You can use those values in an ordinary handler. This complete example needs no router, schema, execution context or
network connection:

```ts runnable=http-search.ts
import { parseQuery } from '@okikio/http/request';

function search(incoming: Request): Response {
	const query = parseQuery(new URL(incoming.url).search);
	const tags = query.tag === undefined ? [] : typeof query.tag === 'string' ? [query.tag] : query.tag;
	return Response.json({ filters: tags });
}

const outgoing = search(new Request('https://service.invalid/search?tag=art&tag=music'));
console.log(await outgoing.text());
```

```text output
{"filters":["art","music"]}
```

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
[full function and type contracts](API.md) without adopting those additional layers.

## Build on the example

For a search API, combine [request parsing](request/README.md) with an [endpoint](../server/endpoint/README.md) that
validates the allowed filters. Return a [response](response/README.md) for matching records or a declared
[problem](problem/README.md) for an unsupported filter. This separates the user's exact input from the rules your search
supports.

For a provider callback, use [webhook verification](webhook/README.md) before decoding the event, then pass the verified
message to your application. For forwarding to another service, choose `request.forwardHeaders()` when credential and
host policy must accompany connection-header removal. The [gateway](../server/gateway/README.md) composes those
decisions with route ownership. Neither parsing nor forwarding decides which actor may access a record.

[Choose related utilities by outcome](../../docs/outcomes.md). Later examples with application-owned clients or schemas
are composition sketches; supply those dependencies before running them.

## Public areas

`@okikio/http/request` : Parses and sanitizes an untrusted Web `Request` with explicit size and trust rules.

`@okikio/http/cookie` : Defines stable application cookie contracts and provides Fetch-native cookie helpers.

`@okikio/http/response` : Defines successful HTTP representations and runtime occurrences. It also owns headers, status
schemas, pagination, conditional responses, byte ranges, and response-body completion observation.

`@okikio/http/problem` : Defines RFC 9457 problem representations and runtime occurrences.

## Declared problem example

```ts
import * as problem from '@okikio/http/problem';

const problemBase = 'https://problems.example.invalid/v1';
const NotFound = problem.define({
	id: 'widget:not-found',
	type: problem.url(problemBase, 'widget-not-found'),
	status: 404,
	title: 'Widget not found',
	description: 'The requested widget does not exist.',
});

const result = problem.create(NotFound, {
	detail: 'Widget "w_123" was not found.',
	instance: '/widgets/w_123',
});
```

`problem.url(base, path)` is only a convenience. Its manual equivalent is a normalized `new URL(path, base)` call. The
caller owns the stable problem namespace; the generic HTTP package does not choose a product domain.

## Carry search filters and a browser preference together

This handler keeps both selected tags and validates the browser's display preference. The preference cookie carries a
string, not a session object. The response definition supplies one shared shape for the resulting JSON:

```ts runnable=search-preference.ts
import * as cookie from '@okikio/http/cookie';
import * as request from '@okikio/http/request';
import * as response from '@okikio/http/response';
import { z } from 'zod';

const Theme = cookie.define({
	id: 'display.theme',
	name: 'theme',
	description: 'Preferred display theme.',
	value: z.enum(['light', 'dark']),
	attributes: { path: '/', sameSite: 'lax' },
});
const SearchResult = response.ok(z.object({ tags: z.array(z.string()), theme: z.enum(['light', 'dark']) }), {
	id: 'search.result',
	description: 'Selected search filters and display theme.',
});

async function search(incoming: Request): Promise<Response> {
	const query = request.parseQuery(new URL(incoming.url).search);
	const tags = query.tag === undefined ? [] : typeof query.tag === 'string' ? [query.tag] : query.tag;
	const theme = await cookie.safeGet(incoming, Theme);
	if (!theme.success) return Response.json({ error: 'Unsupported display theme.' }, { status: 400 });
	const value = response.finalize(response.create(SearchResult, { tags: [...tags], theme: theme.value ?? 'light' }));
	return Response.json(value.body, { status: value.status, headers: response.toHeaders(value.headers) });
}

const incoming = new Request('https://service.invalid/search?tag=film&tag=music', {
	headers: { cookie: 'theme=dark' },
});
const outgoing = await search(incoming);
console.log(outgoing.status, await outgoing.text());
```

```text output
200 {"tags":["film","music"],"theme":"dark"}
```

Only local Request/Response values are used. An absent preference selects `light`; an unsupported cookie follows the
ordinary `400` branch. The body is assembled from parsed strings and the checked cookie. `response.create()` supplies
the declared type at construction; a service would additionally validate unknown handler output at runtime.

## Query wire forms

Query parsing keeps transport syntax separate from endpoint schema semantics. When the runtime has the raw `URL.search`
string, it preserves the difference between a bare parameter and an explicitly empty value:

```text
?loud        bare parameter
?loud=       explicit empty value
?loud=true   explicit value
```

`parseQuery()` accepts a `bareQueryParameters` policy:

- `flag` maps a bare parameter to the string `"true"`;
- `empty` maps it to an empty string;
- `reject` reports the bare form as invalid input.

The default is `empty`, which matches `URLSearchParams`. An endpoint that defines presence-as-true syntax can opt into
`flag`; `endpoint.input(...)` can scope that policy to one query contract. Explicit `=` values are never rewritten, so
`?loud=` remains empty and can fail a schema that accepts only `true` or `false`. Repeated values retain authored order.
WHATWG `URLSearchParams` still owns percent decoding and `+`-as-space behavior. Passing an existing `URLSearchParams`
cannot preserve the bare-versus-empty distinction because the Web API has already normalized both forms to an empty
string.

The generic reader does not coerce arbitrary text such as `42`, `null`, or JSON. The endpoint Standard Schema remains
responsible for domain-specific conversion and validation.

## How it fits

Domain code can define expected failures without HTTP. Endpoint code selects which success responses and HTTP problems
the operation may expose. The server runtime validates the selected definitions and materializes the final native
`Response`.

```text
domain result or expected failure
  -> endpoint response/problem selection
  -> HTTP response or RFC 9457 problem occurrence
  -> server materialization
  -> native Response
```

The package remains import-safe. Importing it performs no network access, starts no listener, and installs no global
state.

## Record-shaped request options and response headers

When an HTTP operation accepts a JavaScript record for parsing limits or headers, that record must be a plain object or
null-prototype data record. Hidden, inherited, symbol, and accessor properties are rejected before their values are
read. Native `Headers` objects and explicit `[name, value]` header tuples keep their own Web-platform semantics.

This matters most for operational limits: an inherited getter must never be able to silently change a body/header bound
that the visible configuration does not show.

## Webhooks

`@okikio/http/webhook` verifies exact request bytes without owning routes. `@okikio/http/webhook/standard` also signs
outbound Standard Webhooks v1 messages.

An inbound service endpoint verifies the request before normal parsing. An outbound sender signs the serialized bytes
that it will transmit. A service that uses both directions composes these two roles independently.

Durable subscriptions, delivery attempts, retry schedules, replay, dead-letter records, endpoint health, and delivery
telemetry need persistent application state. Those persistent delivery responsibilities belong to a higher-level webhook
capability if Okikio needs a reusable implementation.

Read [`webhook/README.md`](webhook/README.md) for signing, verification, limits, and the inbound and outbound flows.

## Focused imports

HTTP subpaths are public package entries. A reusable library can depend on `@okikio/http/request`. An application that
uses the single-install suite can import the same implementation from `@okikio/utils/http/request`.
