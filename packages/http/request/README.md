# `@okikio/http/request`

A search page can ask for several tags, and an import route can receive an unexpectedly large upload. You need to keep
all the user's values while limiting how much request data enters memory. This package reads and parses Web requests
before application validation. Its limits govern bytes and HTTP fields; your application's validation rules govern what
those values mean.

```text
Repeated query: tag=a&tag=b -> { tag: [a, b] }
Body stream -> count bytes against budget -> complete Uint8Array -> decode/validate
                                      over budget -> reject, cancel reader
```

The query line preserves both choices. The body line admits a complete bounded byte array or rejects the read; it does
not return a successful partial upload. A byte limit is not a character limit, so non-ASCII text can consume several
bytes per character.

## Read search filters and a small upload

```ts runnable
import * as request from '@okikio/http/request';
console.log(JSON.stringify(request.parseQuery('?tag=a&tag=b')));
const incoming = new Request('https://service.invalid/import', { method: 'POST', body: 'abc' });
console.log(new TextDecoder().decode(await request.readBody(incoming, { maximumBodyBytes: 3 })));
```

Expected output:

```text output
{"tag":["a","b"]}
abc
```

The query input contains two `tag` fields, and the first output proves that neither was lost. The POST body `abc`
contains three bytes. `readBody()` accepts those bytes with a budget of three, and `TextDecoder` turns the returned byte
array back into `abc`. Adding another ASCII byte would exceed this budget. Reading consumes the request body, so choose
when to read or deliberately clone it before another reader needs it.

## The values and limits behind these calls

| Call                            | Returns                                                                    | Important boundary                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `parseQuery(search, options?)`  | `WireRecord`: readonly string keys, string or readonly string-array values | Decodes transport text; does not convert `"true"` to a boolean                                            |
| `readBody(incoming, options?)`  | `Promise<Uint8Array>`                                                      | Buffers all admitted bytes; consumes the body once                                                        |
| `parseJson(incoming, options?)` | `Promise<unknown>`                                                         | Requires a JSON content type, bounded bytes and valid UTF-8/JSON; your schema checks the resulting object |
| `parseForm(incoming, options?)` | `Promise<FormWireRecord>`                                                  | Keeps text, `File` values and repeated fields; applies body and field-count limits                        |

`maximumBodyBytes` is an override on `RequestParsingOptions`; omitted limits use the package's bounded defaults. Choose
an explicit budget for the route's job rather than using the default as an application policy. See the
[complete option fields](../API.md#request).

Under the hood, `readBody()` checks `Content-Length` when framing allows it, takes a body reader, and counts each
chunk's `byteLength`. A declared length does not bypass that actual count. At success it copies the chunks into one
`Uint8Array`. At overflow or abort it cancels the reader, waits for cancellation, and releases the lock. This is why the
function is useful for small JSON/uploads but is not a streaming processor for multi-gigabyte files.

If a header/content-type/declared-length check rejects before reading starts, the helper has not taken a body reader.
The surrounding transport still owns that unread body. Once a reader is taken, the helper owns releasing its lock and
joining any cancellation it starts.

### Turn a JSON request into a familiar response

The reader does the byte and syntax work; the ordinary `if` decides whether this application accepts the value:

```ts runnable=request-json.ts
import { parseJson } from '@okikio/http/request';

async function save(incoming: Request): Promise<Response> {
	const input = await parseJson(incoming, { maximumBodyBytes: 1024 });
	if (typeof input !== 'object' || input === null || !('title' in input) || typeof input.title !== 'string') {
		return Response.json({ error: 'A title is required.' }, { status: 400 });
	}
	return Response.json({ title: input.title.trim() });
}

const incoming = new Request('https://service.invalid/notes', {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: '{"title":"  First note  "}',
});
console.log(await (await save(incoming)).text());
```

```text output
{"title":"First note"}
```

Malformed or oversized input rejects the parsing call. For expected transport failures, branch on
`RequestTransportError.issues[*].code`, such as `body-too-large`, rather than matching its message. Decide at the host
whether to convert those failures to HTTP responses; the reader does not silently return partial or invalid data.

## Build on the example

For a filterable catalogue, parse repeated query values and let an [endpoint](../../server/endpoint/README.md) validate
which filters and values your search accepts. Pair the result with [pagination responses](../response/README.md) so
callers can request the next page without losing their filters.

For an import form, choose body and field limits before reading, decode the admitted input, and then validate its shape.
Use [webhook verification](../webhook/README.md) first when a provider signs the raw bytes. `readBody()` buffers the
admitted body in memory; use an explicitly designed streaming path for work that must process a large upload
incrementally. Cancellation and over-limit reads reject rather than returning a partial body.

## Request flow

```text
untrusted HTTP request
  -> syntax and size checks
  -> normalized HTTP values
  -> endpoint Standard Schema validation
  -> typed application input
```

`parseParameters()`, `parseQuery()`, `parseHeaders()`, and `parseCookies()` retain the information needed by later
validation instead of silently choosing one repeated value.

`readBody()`, `parseJson()`, and `parseForm()` enforce independent body limits. `parseAuthorization()` parses credential
syntax but redacts the credential when it is stringified or serialized.

`readBody()` owns its reader until pending cancellation settles, then releases the lock. If cancellation succeeds, an
abort rejects with the caller's exact signal reason, including `null`. If overflow cancellation fails, the rejection
still contains the `body-too-large` transport issue; its `cause` retains the cleanup failure for private diagnostics.
Other combined read or abort and cleanup failures use `AggregateError`, with the primary failure in `cause` and both
failures in `errors`, in primary-then-cleanup order. A rejection with `undefined` still counts as a cleanup failure.
Applications may report safe transport `issues` to clients, but should keep `cause` and aggregate `errors` private.

## Trust and correlation

`externalUrl()` ignores forwarding headers unless the caller supplies an explicit trusted-proxy policy. Host and
protocol allowlists prevent a caller from selecting the public origin used for links or redirects.

`correlation()` validates W3C trace fields and request IDs. The HTTP value is named `requestId` because it identifies an
HTTP request. A server can copy that value into the generic execution context as `ctx.id`.

`correlationFields()` returns safe structured identifiers for logging. It does not include authorization values,
cookies, query values, or request bodies.

## Request-owned memoization

`memoize()` shares pending request work such as authentication, body reads, hashes, or canonical-origin resolution.
Failed loads are removed so an explicit retry can run.

`disposeMemo()` releases disposable memoized values after the response body finishes, cancels, aborts, or fails.
Releasing values only when headers are created would end request-owned resources too early for streaming responses.

## Content length

`parseContentLength()` is the small wire-level parser used by bounded body readers. An absent header returns
`undefined`. A present header must contain only decimal digits and fit inside JavaScript's safe-integer range. Malformed
values fail with `RequestTransportError` code `invalid-content-length`; they are not reclassified as an oversized body.

```ts
request.parseContentLength(null); // undefined
request.parseContentLength('0012'); // 12
request.parseContentLength('12.5'); // throws invalid-content-length
```

The convenience is intentionally thin. Manually, the same rule is: check the HTTP `1*DIGIT` shape, convert it to a
number, reject values outside the safe-integer range, and only then compare it with the body policy.
