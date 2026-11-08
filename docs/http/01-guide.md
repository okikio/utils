# Preserve wire meaning before applying application policy

A search page receives two selected tags in its URL and a display preference in a cookie. It needs to preserve both tags, check the preference, and return useful feedback when the preference is invalid. HTTP utilities perform those protocol steps without choosing your business rules or opening a server.

A Web `Request` carries the incoming URL, headers and optional body. A Web `Response` carries the outgoing status, headers and body. The programs below create both locally, so you can inspect the values without setting up a network listener.

## Preserve search values and filter connection-specific headers

Read the repeated query values without collapsing them into a single field. Then prepare headers for forwarding, removing
headers that the HTTP `Connection` field marks as specific to this connection. The output makes both transformations inspectable.

After the [checkout setup](../../README.md#work-on-the-repository), save the block as `package-task.ts` at the checkout
root and run `mise exec -- deno run package-task.ts`.

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

| I need to… | Start with | What it gives me |
| --- | --- | --- |
| Read search filters or a bounded body | [`@okikio/http/request`](./05-request.md) | Decoded values for my application to check. |
| Read or write a browser preference | [`@okikio/http/cookie`](./03-cookie.md) | A named value with a rule for reading it and attributes for writing it. |
| Return a checked answer | [`@okikio/http/response`](./06-response.md) | A reusable success rule and helpers for building the response. |
| Return a rejection clients can identify | [`@okikio/http/problem`](./04-problem.md) | A status, stable type and safe detail for an expected failure. |
| Check a callback from another service | [`@okikio/http/webhook`](./07-webhook.md) | Verification of the signature over the original request bytes. |

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

When `parseQuery()` reads the original `URL.search` string, it can tell `?loud` from `?loud=`. The first names a
parameter without giving it a value. The second gives it an empty value. Your endpoint can decide whether to accept
either form.

```text
?loud        bare parameter
?loud=       explicit empty value
?loud=true   explicit value
```

`parseQuery()` accepts a `bareQueryParameters` policy:

- `flag` maps a bare parameter to the string `"true"`;
- `empty` maps it to an empty string;
- `reject` reports the bare form as invalid input.

By default, `empty` treats both forms like `URLSearchParams`. If your endpoint treats the presence of `?loud` as true,
select `flag` in `endpoint.input(...)`. The parser still leaves `?loud=` empty. A schema that accepts only `true` or
`false` can reject it. The parser keeps repeated values in the order they appeared.

`URLSearchParams` decodes percent escapes and reads `+` as a space. If you pass an existing `URLSearchParams` object,
it has already turned `?loud` and `?loud=` into the same empty string. Pass the original query string if you need to tell
them apart.

The parser returns text, even for a value such as `42`. Use your endpoint's Standard Schema to turn that text into a
number and check whether your application accepts it.

## Use HTTP values without starting a service

Your application can define a failure such as a missing picture without choosing an HTTP status. The endpoint
lists the success and error replies it allows. When the handler returns a value, the server checks that it belongs
to one of those replies and builds the Web `Response` the client receives.

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
A `Content-Length` header can help reject an oversized response before reading. The reader still counts the bytes it
actually receives. Use the signal to interrupt a stalled read. The reader releases its lock without waiting for the
source to stop. If you need to know when the source has stopped, arrange that separately.

`@okikio/http/signature` signs and verifies exact bytes with HMAC-SHA-256 and exposes the full SHA-256 digest.
Signatures use canonical lower-case hexadecimal. Callers own secrets and rotation, authenticated audience, protocol
version, expiry and replay prevention. Borrowed bytes are copied before asynchronous cryptography.
