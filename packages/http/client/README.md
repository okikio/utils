# HTTP transport lifetime

`@okikio/http/client` sends Fetch requests with explicit credentials, byte limits
and cancellation. Create one client for an upstream origin. Pass the current
request signal to each call so cancellation can stop transport and decoding.
The client does not read environment variables or discover authentication.

This finite JSON read keeps its 15-second timeout active until decoding ends.
The decoder rejects a response that exceeds the configured 64 KiB limit.

```ts
import * as client from '@okikio/http/client';

const upstream = client.create({
  origin: 'https://api.example.invalid',
  timeoutMs: 15_000,
  maximumResponseBytes: 64 * 1024,
});
export async function readStatus(signal: AbortSignal): Promise<unknown> {
  return await upstream.request(
    { method: 'GET', path: '/status', signal },
    (response, scoped) => client.json(response, upstream.maximumResponseBytes, scoped),
  );
}
```

Browser callers can omit the origin and use `credentials: 'same-origin'`.
Server callers supply an absolute origin and verified credentials. Per-call
headers cannot replace credential values supplied by the client owner.

Choose the method by who owns response consumption:

| Method | Lifetime |
| --- | --- |
| `request(input, read)` | Own the timeout and caller cancellation while the decoder runs. |
| `stream(input)` | Transfer that lifetime to the returned byte body until it ends, fails or is cancelled. |
| `fetch(input)` | End the timeout and caller linkage after headers arrive. The caller owns body consumption and cancellation. |

The default timeout is 15,000 milliseconds. The default response limit is 8 MiB.
The `json` decoder counts actual UTF-8 bytes, cancels an oversized or aborted
reader and checks the response media type. Custom decoders must use the configured
limit and supplied signal when they read the body.

`stream(input)` reads at most one chunk ahead. It cancels the upstream reader
when the consumer cancels or the total deadline expires, including when the
consumer stops reading. It does not collect a download into a complete buffer.
Use the owning capability's timeout for downloads. The [response module](../response/README.md)
documents reader release and operation disposal.

Cancellation keeps the caller's original reason. It stops waiting for a Fetch
implementation or decoder that ignores the signal. A late Fetch response has its
body discarded. A late decoder result cannot replace cancellation, and a later
failure remains observed. Completion removes the caller listener and timer.

HTTP failures remain distinct from cancellation, transport failures and invalid
responses. The JSON decoder preserves bounded RFC 9457 details, status, request ID
and Retry-After information in `ClientResponseError`. The client does not retry.
Application code decides whether the operation can be retried safely.

The endpoint adapter lives in `@okikio/server/client`. HTTP transport does not
need routing or capability schemas. The same portable source tests run with
`node:test` and `@std/expect` under Deno and Node.
