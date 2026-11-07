# Http: request

A request body arrives as bytes. JSON decoding turns those bytes into a JavaScript value; validation then decides
whether the value means something your application accepts. Valid JSON can still have the wrong fields or types.
For a small note, buffer only a bounded body, check its title, then create the outgoing response.

Run the complete program below from this checkout after `mise run prepare -- --kind deps`. Save it as `request-json.ts`
and run `mise exec -- deno run request-json.ts`. `await` waits for reading and decoding; no listener or database is needed.

## Turn a JSON request into a familiar response

The reader does the byte and syntax work; the ordinary `if` decides whether this application accepts the value:

```ts runnable=request-json.ts
import { parseJson } from '@okikio/http/request';

async function save(incoming: Request): Promise<Response> {
	const input = await parseJson(incoming, { maximumBodyBytes: 1024 });
	// JSON syntax can succeed without producing a record or a usable title.
	if (typeof input !== 'object' || input === null) {
		return Response.json({ error: 'A title is required.' }, { status: 400 });
	}
	if (!('title' in input) || typeof input.title !== 'string') {
		return Response.json({ error: 'A title is required.' }, { status: 400 });
	}
	return Response.json({ title: input.title.trim() });
}

const incoming = new Request('https://service.invalid/notes', {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: '{"title":"  First note  "}',
});
const outgoing = await save(incoming);
console.log(await outgoing.text());
```

```text output
{"title":"First note"}
```

Malformed or oversized input rejects the parsing call. For expected transport failures, branch on
`RequestTransportError.issues[*].code`, such as `body-too-large`, rather than matching its message. Decide at the host
whether to convert those failures to HTTP responses; the reader does not silently return partial or invalid data.


## The values and limits behind these calls

| Call                            | Returns                                                                    | Important boundary                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `parseQuery(search, options?)`  | `WireRecord`: readonly string keys, string or readonly string-array values | Decodes transport text; does not convert `"true"` to a boolean                                            |
| `readBody(incoming, options?)`  | `Promise<Uint8Array>`                                                      | Buffers all admitted bytes; consumes the body once                                                        |
| `parseJson(incoming, options?)` | `Promise<unknown>`                                                         | Requires a JSON content type, bounded bytes and valid UTF-8/JSON; your schema checks the resulting object |
| `parseForm(incoming, options?)` | `Promise<FormWireRecord>`                                                  | Keeps text, `File` values and repeated fields; applies body and field-count limits                        |

`maximumBodyBytes` is an override on `RequestParsingOptions`; omitted limits use the package's bounded defaults. Choose
an explicit budget for the route's job rather than using the default as an application policy. See the
[complete option fields](../../packages/http/README.md).

A sender can declare a body size in the `Content-Length` header. `readBody()` uses that number to reject an
oversized body early when the message format permits it. Once reading starts, it also counts the bytes that actually
arrive. A declared length does not bypass that actual count. At success it copies the chunks into one
`Uint8Array`. At overflow or abort it releases the reader lock promptly and requests source cancellation.
Source cancellation can finish later; `bodyCleanup(request)` exposes that separate completion. This is why the
function is useful for small JSON/uploads but is not a streaming processor for multi-gigabyte files.

If a header/content-type/declared-length check rejects before reading starts, the helper has not taken a body reader.
The surrounding transport still owns that unread body. Once a reader is taken, the helper owns releasing its lock and
recording the outcome of any cancellation it starts. Cancellation may still be pending when the read rejects.
The enclosing request owner must await `bodyCleanup(request)` when it needs to join that source cleanup.

An overflow after reading starts has two outcomes. Read across each line separately; the cancellation result can
arrive after the parsing call has already rejected. This path omits checks that reject before taking a reader.

```text
Read:   bytes exceed limit -> release reader -> reject body-too-large
Source: request cancellation -> observe completion in bodyCleanup()
```

## Keep the read failure separate from cleanup

An upload that exceeds its budget must fail even if stopping its producer also fails. This local source sends two
bytes against a one-byte budget, then throws during cancellation. The read retains the `body-too-large` issue; the
separate cleanup receipt exposes the producer failure. Neither path returns a partial accepted body.

```ts runnable=bounded-upload.ts
import { bodyCleanup, readBody, RequestTransportError } from '@okikio/http/request';

const source = new ReadableStream<Uint8Array>({
	start(controller) {
		controller.enqueue(new Uint8Array([1, 2]));
	},
	cancel() {
		throw new Error('The upload producer could not finish teardown.');
	},
});
const incoming = new Request(
	'https://service.invalid/import',
	{
		method: 'POST',
		body: source,
		duplex: 'half',
	} as RequestInit & { duplex: 'half' },
);

try {
	await readBody(incoming, { maximumBodyBytes: 1 });
	throw new Error('The oversized upload should not be accepted.');
} catch (error) {
	if (!(error instanceof RequestTransportError)) throw error;
	console.log(error.issues[0]!.code);
}

// Read rejection released the lock. Join and inspect the separately owned source cancellation.
const cleanup = await bodyCleanup(incoming);
console.log(incoming.body!.locked, cleanup.status);
```

```text output
body-too-large
false failed
```

Releasing the reader lock means another reader can acquire it; it does not prove the producer has stopped. If the
body is one branch of a split stream, cancellation can wait for the sibling branch too. Its owner must consume or
cancel that sibling before joining shared source cleanup. The byte budget limits this reader, not all memory retained
by other readers or the network transport.

## Build on the example

For a filterable catalogue, parse repeated query values and let an [endpoint](../../packages/server/endpoint/README.md)
validate which filters and values your search accepts. Pair the result with
[pagination responses](../../packages/http/response/README.md) so callers can request the next page without losing their
filters.

For an import form, choose body and field limits before reading, decode the admitted input, and then validate its shape.
Use [webhook verification](../../packages/http/webhook/README.md) first when a provider signs the raw bytes.
`readBody()` buffers the admitted body in memory; use an explicitly designed streaming path for work that must process a
large upload incrementally. Cancellation and over-limit reads reject rather than returning a partial body.

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

`readBody()` releases its reader lock when the read stops, without waiting for a source that may block cancellation.
Await `bodyCleanup(request)` separately when the surrounding owner must join that cleanup. An abort rejects with the
caller's exact signal reason, including `null`; an overflow rejects with the `body-too-large` transport issue.
Cleanup failure does not replace that read result. The cleanup Promise resolves with `{ status: 'failed', error }`,
including when the error is `undefined`. Keep that error in private diagnostics rather than a public HTTP response.

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

Import the parser directly to check header text without constructing a Request. The final call demonstrates a rejection;
catch that error at the HTTP host if it should become a client response.

```ts
import { parseContentLength } from '@okikio/http/request';
parseContentLength(null); // undefined
parseContentLength('0012'); // 12
parseContentLength('12.5'); // throws invalid-content-length
```

The convenience is intentionally thin. Manually, the same rule is: check the HTTP `1*DIGIT` shape, convert it to a
number, reject values outside the safe-integer range, and only then compare it with the body policy.
