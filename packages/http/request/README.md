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

For shared terms such as `await` and `await using`, see
[the short glossary](../../../docs/learn.md#read-the-small-amount-of-code-you-need).

For the exact functions, types and field explanations, read the [generated contract reference](../API.md#request).

## Run a complete example

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

## Build on the example

For a filterable catalogue, parse repeated query values and let an [endpoint](../../server/endpoint/README.md) validate
which filters and values your search accepts. Pair the result with [pagination responses](../response/README.md) so
callers can request the next page without losing their filters.

For an import form, choose body and field limits before reading, decode the admitted input, and then validate its shape.
Use [webhook verification](../webhook/README.md) first when a provider signs the raw bytes. `readBody()` buffers the
admitted body in memory; use an explicitly designed streaming path for work that must process a large upload
incrementally. Cancellation and over-limit reads reject rather than returning a partial body.

## Purpose

`@okikio/http/request` parses and sanitizes an untrusted Web `Request` before a service gives values to
endpoint-specific schemas or domain code.

The package preserves protocol details that are easy to lose accidentally: repeated values, exact raw bytes, forwarding
trust, bounded inputs, credential redaction, content negotiation, trace correlation, and request-owned memoized work.

It does not authenticate credentials, authorize actors, apply tenant policy, or compile a database query.

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
