# Hono proxy upstream vectors

These fixtures adapt all fourteen `it` registrations in
[Hono's proxy tests](https://github.com/honojs/hono/blob/06880c4a2b04de9dd74217f26dd831209b9c01f1/src/helper/proxy/index.test.ts),
commit `06880c4a2b04de9dd74217f26dd831209b9c01f1`, version 4.13.5. The implementation contract was inspected at the
[matching helper source](https://github.com/honojs/hono/blob/06880c4a2b04de9dd74217f26dd831209b9c01f1/src/helper/proxy/index.ts).
The helper directory contains these two files and no separate fixtures or helper tests. The retained copyright and MIT
permission notice is in [UPSTREAM-LICENSE](./UPSTREAM-LICENSE).

`corpus.ts` preserves original request data and every originally asserted status, header, URL, and body projection. It
records separate literal expectations where a gateway policy differs. `upstream.ts` preserves the original mock URL
branches and response data. `implementations.ts` runs the published Hono helper and real public Utils HTTP/gateway
declarations, not a second handwritten forwarding implementation. The mock transport owns all responses and never
contacts `example.com`.

Most Hono calls use `customFetch` in place of a process-global Vitest mock. The exact Request-as-init overload has no
custom transport option, so its isolated serial test temporarily replaces `globalThis.fetch` and restores it in
`finally`. The disconnect vector retains request body `test`, reason `client disconnect`, and Hono's response-body
expectation. Its abort happens after an explicit upstream-entry gate rather than relying on the timing of a synchronous
Vitest mock. The gateway rejects the caller's exact reason and must cancel a late upstream body with that same reason.

All ordinary responses are consumed. Streaming controls cancel their readers and release locks. Disconnect readers
remove listeners and release locks in `finally`. The Utils gateway holds no service/resource runtime or socket to close;
only statically compiled service declarations are used. No runtime permission, listener, DNS, provider, or ambient
credential is involved.

## Boundaries that remain different

- Hono removes explicit Accept-Encoding. The gateway retains caller encoding negotiation. Both response adapters are
  tested against the original already decoded `ok` body. The gateway normalizes metadata for single gzip/br bodies,
  which both pinned runtimes decode. An injected transport must return decoded bytes for those codings. Other codings
  differ between engines; an adapter that decodes them must normalize their metadata itself. Unknown codings and
  bodyless HEAD responses preserve their representation headers. Authored tests record that difference from Hono's
  unconditional removal of encoding metadata.
- Hono preserves an explicitly supplied Host. Gateway routing derives the target authority and strips caller Host.
- Hono's default request mode keeps Connection-nominated custom fields. Its strict mode strips them and rejects
  malformed token syntax. Gateway forwarding strips valid nominations and ignores invalid tokens; it does not expose
  Hono's strict-mode switch.
- Hono lets explicit init headers restore Proxy-Authorization. Gateway transport trust rejects/strips that hop
  credential.
- Undefined Authorization is a Hono init-overload rule. The gateway's equivalent omission is a declared credential
  policy, not support for undefined header values.
- Hono's mock returns an abort reason as a response body. Caller abort remains authoritative in the gateway, which joins
  disposal of a response returned after that abort.

Additional authored vectors preserve manual redirects, status text, repeated cookies, explicit credential admission,
eight exact Unicode request bytes and Content-Length, uncollected response streams, and downstream cancellation. A
Connection-nominated Content-Encoding vector records a further distinction: Hono drops encoding before checking whether
to remove compressed Content-Length, whereas the gateway remembers the original encoding and drops that stale length.
This added edge case is not attributed to the upstream test corpus.

[coverage.json](./coverage.json) maps every upstream registration line to executable local cases and its contract
disposition. No upstream proxy registration is omitted. Porting assertions establishes provenance, not a passed result;
the root qualification run records actual runtime and compiler results separately.
