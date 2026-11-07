# Preserve wire meaning before applying application policy

A search page receives two selected tags in its URL and a display preference in a cookie. It needs to preserve both tags, check the preference, and return useful feedback when the preference is invalid. HTTP utilities perform those protocol steps without choosing your business rules or opening a server.

A Web `Request` carries the incoming URL, headers and optional body. A Web `Response` carries the outgoing status, headers and body. The programs below create both locally, so you can inspect the values without setting up a network listener.

## Preserve search values and filter connection-specific headers

Read the repeated query values without collapsing them into a single field. Then prepare headers for forwarding, removing
headers that the HTTP `Connection` field marks as specific to this connection. The output makes both transformations inspectable.

From the experimental Utils checkout, run `mise trust`, `mise install`, and `mise run prepare -- --kind deps` at the repository root. Save each named program there and run `mise exec -- deno run <filename>.ts`, replacing `<filename>` with the name shown. These examples use workspace exports, not an assumed published registry release.

Save `package-task.ts` and run `mise exec -- deno run package-task.ts`.

```ts runnable=package-task.ts
import * as request from '@okikio/http/request';
import { forward } from '@okikio/http/headers';
console.log(JSON.stringify(request.parseQuery('?tag=one&tag=two')));

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

Expected output:

```text output
{"tag":["one","two"]}
false application/json
```

Here `Connection: X-Internal` nominates `X-Internal` for removal. This is HTTP hop-by-hop filtering, not a general secret detector. The application must still decide which cookies, authorization and other credentials may cross an origin.

## Choose the HTTP value you need

`@okikio/http/request` : Parses and sanitizes an untrusted Web `Request` with explicit size and trust rules.

`@okikio/http/cookie` : Defines stable application cookie contracts and provides Fetch-native cookie helpers.

`@okikio/http/response` : Defines successful HTTP representations and runtime occurrences. It also owns headers, status
schemas, pagination, conditional responses, byte ranges, and response-body completion observation.

`@okikio/http/problem` : Defines RFC 9457 problem representations and runtime occurrences.

A response definition is a reusable rule. `create()` associates that rule with one logical answer; it does not send
bytes. `materialize()` validates and prepares that answer. Finally, a native `Response` encodes the value for its caller.
Keeping these stages separate lets several handlers share a rule without sharing a particular response body.

## Carry search filters and a browser preference together

This handler keeps both selected tags and validates the browser's display preference. The preference cookie carries a
string, not a session object. The response definition supplies one shared shape for the resulting JSON:

Save `search-preference.ts` and run `mise exec -- deno run search-preference.ts`.

```ts runnable=search-preference.ts
import * as problem from '@okikio/http/problem';
import * as cookie from '@okikio/http/cookie';
import * as request from '@okikio/http/request';
import * as response from '@okikio/http/response';
import * as schema from '@okikio/schema';

const Theme = cookie.define({
	id: 'display.theme',
	name: 'theme',
	description: 'Preferred display theme.',
	value: schema.oneOf(['light', 'dark']),
	attributes: { path: '/', sameSite: 'lax' },
});
const SearchResult = response.ok(
	schema.object({ tags: schema.array(schema.string()), theme: schema.oneOf(['light', 'dark']) }),
	{
		id: 'search.result',
		description: 'Selected search filters and display theme.',
	},
);

const UnsupportedTheme = problem.define({
	id: 'display.theme.unsupported',
	type: problem.url('https://problems.invalid/v1', 'unsupported-theme'),
	status: 400,
	title: 'Unsupported display theme',
	description: 'Choose light or dark.',
});

/** Preserve repeated tag values before the application chooses how to apply them. */
async function search(incoming: Request): Promise<Response> {
	const query = request.parseQuery(new URL(incoming.url).search);
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
	const theme = await cookie.safeGet(incoming, Theme);
	if (!theme.success) {
		const [body, status] = problem.create(UnsupportedTheme, { detail: 'Choose light or dark.' });
		return Response.json(body, { status, headers: { 'content-type': 'application/problem+json' } });
	}

	// Associate this answer with its reusable definition, then validate and prepare it.
	const occurrence = response.create(SearchResult, { tags: [...tags], theme: theme.value ?? 'light' });
	const value = await response.materialize(occurrence);
	return Response.json(value.body, { status: value.status, headers: response.toHeaders(value.headers) });
}

const incoming = new Request('https://service.invalid/search?tag=film&tag=music', {
	headers: { cookie: 'theme=dark' },
});
const outgoing = await search(incoming);
console.log(outgoing.status, await outgoing.text());
const rejected = await search(
	new Request('https://service.invalid/search?tag=film', { headers: { cookie: 'theme=neon' } }),
);
console.log(rejected.status, (await rejected.json()).title);
```

```text output
200 {"tags":["film","music"],"theme":"dark"}
400 Unsupported display theme
```

`UnsupportedTheme` is a declaration of the expected rejection; `problem.create` supplies one occurrence with safe detail. Its type URL names this kind of problem and is never fetched. The application owns that stable URL namespace. The second request uses `theme=neon`, so the handler returns the declared 400 problem before assembling a search result. Correct or clear the preference cookie and retry.

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

## Use HTTP values without starting a service

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

Read [`webhook/README.md`](../../packages/http/webhook/README.md) for signing, verification, limits, and the inbound and
outbound flows.

## Focused imports

HTTP subpaths are public package entries. A reusable library can depend on `@okikio/http/request`. An application that
uses the single-install suite can import the same implementation from `@okikio/utils/http/request`.

## Bounded responses and byte signatures

`@okikio/http/response` exports `readBytes` and `readText` with an explicit byte budget and optional abort signal.
Content-Length is only an early admission hint; counted body bytes remain authoritative. The signal interrupts stalled
reads. Reader release does not wait indefinitely for an uncooperative producer's cancellation promise; eventual producer
cleanup remains caller-owned.

`@okikio/http/signature` signs and verifies exact bytes with HMAC-SHA-256 and exposes the full SHA-256 digest.
Signatures use canonical lower-case hexadecimal. Callers own secrets and rotation, authenticated audience, protocol
version, expiry and replay prevention. Borrowed bytes are copied before asynchronous cryptography.
