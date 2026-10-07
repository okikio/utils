# Public HTTP composition vectors

These cases port the observable middleware behavior from Hono v4.13.5,
[`src/compose.test.ts`](https://github.com/honojs/hono/blob/06880c4a2b04de9dd74217f26dd831209b9c01f1/src/compose.test.ts),
commit `06880c4a2b04de9dd74217f26dd831209b9c01f1`. The upstream MIT notice is retained in `UPSTREAM-LICENSE`.
`coverage.json` reviews every one of that source's 32 lexical test registrations. Thirty have executable public HTTP
projections; two only inspect an unfinished private Context and have explicit incompatibility decisions. A linked
projection does not mean the original private test passed.

`tests/hono-compose.test.ts` runs published `Hono` and real Utils `@okikio/server/http` applications against independent
literal values: the exact six-step onion order, short-circuit order, headers, bodies, status codes, thrown error
instance, final state, and continuation count. It does not import Hono's private `compose` or mock either library's
dispatcher. Shared layer functions provide inputs; the adapters only translate each library's public middleware
arguments and response protocol.

Hono owns a Context and its response slot; Utils passes native Request values and returns Response values. The Hono
adapter assigns `context.res` explicitly when middleware replaces a downstream response. Per-request observations use a
WeakMap and do not add a production state API. The identity case records the actual Context or Request received at each
boundary, rather than comparing a copied fixture identity. Promise-return checks record the actual public `next` return
values without a promise-producing adapter. Nested Hono route registration and nested Utils Fetch composition retain
order and count, while their generic composition APIs remain different.

Tests which previously returned undefined at the end of a private stack now supply a finite HTTP terminal response. The
no-next order case returns an owned 401 response. Repeated-next rejection retains Hono's original Error/message
assertions, while Utils asserts TypeError and exactly one terminal call without fixing diagnostic wording.
Error-recovery cases tell Hono's public error callback to rethrow so upstream middleware owns recovery; wire
error-mapping cases instead use each library's normal public mapper. These adaptations and their exact source lines are
recorded per registration.

Every finite response is consumed. Replacements discard the abandoned response. Owned promise gates replace incidental
timers and are released in `finally`; the stalled-terminal case joins its request and all observation promises, with a
generous test timeout for regression containment. No listener, external network, ambient credential, or background timer
is required.

The registry records source correspondence and applicability. Runtime and type qualification are separate receipts;
creating or checking the registry is not a passing runtime result.
