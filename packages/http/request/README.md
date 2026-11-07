# `@okikio/http/request`

A search page can ask for several tags, and an import route can receive an unexpectedly large upload. You need to keep
all the user's values while limiting how much request data enters memory. This package reads and parses Web requests
before application validation. Its limits govern bytes and HTTP fields; your application's validation rules govern what
those values mean.

A `Request` is the incoming HTTP message. Its URL and headers are text; a JSON body only becomes a JavaScript value
after it has been read and decoded. That decoded value still needs field validation. For example, valid JSON can contain
`{ "age": "many" }` even when the application requires a number.

A request body is a stream that is normally read once. These helpers share one bounded byte read for the same Request,
then decode it for the selected format. They deliberately buffer the accepted body; use a separately owned streaming
upload path when the whole file must not be retained in memory.

```text
Repeated query: tag=a&tag=b -> { tag: [a, b] }
Body stream -> count bytes against budget -> complete Uint8Array -> decode/validate
                                      over budget -> reject, cancel reader
```

The query line preserves both choices. The body line admits a complete bounded byte array or rejects the read; it does
not return a successful partial upload. A byte limit is not a character limit, so non-ASCII text can consume several
bytes per character.

From the Utils checkout, review `mise.toml`, then run `mise trust`, `mise install`, and `mise run prepare -- --kind deps`.
Save each runnable block as a `.ts` file in your project and run it with `mise exec -- deno run <file>.ts`.

## Read search filters and a small upload

Parse repeated search tags and read an upload with an explicit three-byte ceiling. The first result retains both tags;
the second returns the accepted body bytes for the application to interpret.

```ts runnable
import * as request from '@okikio/http/request';

// Query inspection does not consume the request body.
const query = request.parseQuery('?tag=a&tag=b');
console.log(JSON.stringify(query));

const incoming = new Request('https://service.invalid/import', { method: 'POST', body: 'abc' });
// The three-byte limit accepts this exact body; larger input must fail before application parsing.
const bytes = await request.readBody(incoming, { maximumBodyBytes: 3 });

// Decoding bytes produces text; application field validation is a later step.
const text = new TextDecoder().decode(bytes);
console.log(text);
```

Expected output:

```text output
{"tag":["a","b"]}
abc
```

The query input contains two `tag` fields, and the first output proves that neither was lost. The POST body `abc`
contains three bytes. `readBody()` accepts those bytes with a budget of three, and `TextDecoder` turns the returned byte
array back into `abc`. Adding another ASCII byte would exceed this budget. The first read owns the request body. Later
`readBody()`, `parseJson()` or `parseForm()` calls on the same Request start from a copy of those bytes. The parsing
functions then return decoded values. A later smaller limit still rejects oversized data. Choose the limit before the first read starts: if that
read consumes the stream and rejects on overflow, a larger limit on the same Request cannot restart it.

## Cancellation and cleanup

Abort and overflow reject the read promptly and release its stream lock. Underlying source cancellation can continue,
for example when an application splits a stream with `tee()` and another reader still uses the other branch.
`await bodyCleanup(request)` observes the eventual
`completed`, `cancelled`, `released` or `failed` outcome. A failed outcome retains its exact error without replacing the
caller's primary read failure. Await that outcome only when the source owner is ready to join cleanup; waiting for a tee
branch can require its sibling owner to finish first.

## Share one request-owned resource, then release it

A request may need the same capability in several parts of a handler. `memoize()` shares the pending load under an exact
key, so concurrent callers do not acquire duplicate resources. The handler must join its consumers before disposing the
request cache. Save `request-memo.ts`:

```ts runnable=request-memo.ts
import { disposeMemo, memoize } from '@okikio/http/request';
const incoming = new Request('http://localhost/search');
const key = Symbol('search-index');
let opened = 0;
try {
	const load = () => {
		opened += 1;
		return {
			find: () => ['photo-1'],
			[Symbol.dispose]() {
				console.log('Closed index.');
			},
		};
	};
	const [first, second] = await Promise.all([memoize(incoming, key, load), memoize(incoming, key, load)]);
	console.log('opened', opened, 'same', first === second);
	console.log(first.find().join(','));
} finally {
	await disposeMemo(incoming);
}
```

```text output
opened 1 same true
photo-1
Closed index.
```

A failed load can be retried by default; `cacheRejected` changes that policy. Disposal attempts every unique resolved
resource in reverse cache-entry order. Multiple failures use the shared disposal package's `SuppressedError`; one failed
loader or disposer cannot skip unrelated cleanup. `invalidateMemo()` removes cached entries without disposing their
values, so the caller must already own any resources it removes.

## Accept JSON, forms and signed provider messages

The [complete greeting request workflow](../../../docs/server/09-http-input.md) uses this reader in POST routes and
checks malformed JSON, unsupported media, oversized bodies, repeated form names, uploaded files, forged signatures and
duplicates. It also shows the difference between liveness, readiness and response-created observation. The parser reads
a bounded complete body; it is not a large-file streaming upload API. Use [streamed responses](../../../docs/server/10-http-streaming.md)
when the caller should receive results progressively instead.

## Choose adjacent capabilities

Use Request to preserve repeated fields, bound input, and choose forwarding behavior. Schema validates business meaning
after input is read; Server connects the checked input to application behavior.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

Continue in the [numbered guide](https://github.com/okikio/utils/blob/main/docs/http/05-request.md) for composition,
ownership, and failure behavior.
