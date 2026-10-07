# `@okikio/worker`

Call a standard Worker with validated, correlated requests instead of a hand-built postMessage listener. Correlation,
reverse calls, cancellation and shutdown need distinct authority even when messages race.

## Run a complete example

The explicit polyfill imports let this example run when the host lacks Temporal or disposal globals. An existing native
implementation is preserved.

```ts runnable=main.ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as worker from '@okikio/worker';
import { z } from 'zod';
await using ctx = context.create({ id: 'thread-owner' });
await using thread = worker.open(ctx, {
	module: new URL('./thread.ts', import.meta.url),
	protocol: worker.protocol({ request: z.string(), response: z.string() }),
});
console.log(await thread.request(ctx, 'hello'));
```

Expected output:

```text output
HELLO
```

Worker module, saved as `thread.ts`:

```ts support=thread.ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as worker from '@okikio/worker';
import { z } from 'zod';
worker.serve({
	protocol: worker.protocol({ request: z.string(), response: z.string() }),
	run: (request) => request.toUpperCase(),
});
```

## Build on the example

Save the second module beside the first. Start with request/result, then add notices for progress and reverse calls for
host-owned policy. A notice is not completion. Transfer lists move ownership of transferable data; they do not move
arbitrary resources. Pause is cooperative and requires handler checkpoints. Cancellation can stop waiting for a schema,
but an external validator still owns its resources. The parent owns Worker shutdown; each realm needs its own optional
polyfill imports.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Purpose

`@okikio/worker` provides a validated correlated protocol over standard Worker threads. The generic package owns request
IDs, request and response validation, expected failures, transfer lists, cancellation, protocol invalidation,
cooperative shutdown, and final termination.

The default opener uses the Web `Worker` constructor. Tests or another host can inject a `WorkerFactory`, while
Deno-specific permission policy remains on the explicit `@okikio/worker/deno` subpath. This keeps the root usable
anywhere the standard Worker contract is available without embedding one runtime's options in the public model.

Use this utility only when the runtime resource is a Worker thread. A media or analysis package should still name the
concrete resource it exposes to its callers.

## Start here

Define the wire contract first, serve it inside the Worker, then open a caller-owned handle in the parent.

```ts
import * as worker from '@okikio/worker';

const MediaProtocol = worker.protocol({
	request: RequestSchema,
	response: ResponseSchema,
	failure: FailureSchema,
});

const handle = worker.open(ctx, {
	module: new URL('./media-thread.ts', import.meta.url),
	protocol: MediaProtocol,
});

const result = await handle.request(requestCtx, request);
```

Each request carries a unique ID and a serialized context snapshot. The Worker creates local cancellation state for that
request and returns exactly one result, expected failure, or fault. Unknown IDs, duplicate active IDs, malformed
envelopes, and invalid response data invalidate the Worker because request correlation can no longer be trusted.

Cancellation before dispatch prevents a request from being sent. Cancellation after dispatch sends a cancel envelope and
rejects the local request. A late response for a recently cancelled ID is ignored for a bounded period so one
cooperative cancellation does not invalidate a healthy Worker.

## Serve the same protocol inside the Worker

```ts
await using server = worker.serve({
	protocol: MediaProtocol,
	async run(request, ctx, control) {
		await control.checkpoint();
		return convert(request, ctx);
	},
});

await server.closed;
```

The parent and Worker share the same protocol definition. Cancellation crosses the message seam as a control frame; the
utility does not pretend an `AbortSignal` itself is transferable.

## Cancellation and progress

The request Context remains the cancellation authority. The Worker receives a serializable Context snapshot plus
protocol control messages rather than a transferred `AbortSignal`:

```ts
await using requestCtx = context.child(ctx, { id: 'thumbnail-42' });

const pending = handle.request(requestCtx, { assetId: '42' }, {
	id: 'thumbnail-42',
});

context.cancel(requestCtx, new Error('caller stopped waiting'));
await pending; // rejects with the cancellation reason
```

If the protocol declares notices, Worker code can call `control.notify(...)` for progress. Notices are observations
only. The validated terminal response or declared failure remains authoritative.

## Runtime-specific opening

`worker.open()` constructs a standard module Worker unless the caller supplies `create`. `@okikio/worker/deno` wraps the
same generic opener and adds Deno's Worker permission option during construction. Request correlation, validation,
lifecycle, and shutdown still remain in `@okikio/worker`.

`handle.stop()` asks the Worker server to stop cooperatively. If the Worker does not acknowledge shutdown before
`shutdownMs`, the generic owner terminates the raw Worker. Disposing the handle follows the same path, so explicit stop
and resource cleanup remain coordinated.

## Convenience and the manual equivalent

| Convenience         | Manual equivalent                                                                                                                                   | Concrete value                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `worker.protocol()` | define request/response/notice/call schemas and message discriminants yourself                                                                      | one typed cloneable wire contract |
| `worker.open()`     | create correlation maps, post messages, transfer values, link cancellation, validate replies, surface failures/faults, and stop the Worker manually | one owned Worker client lifetime  |
| `worker.serve()`    | install message listeners, validate requests, execute handlers, encode expected failures/faults, and reply with correlation IDs                     | one server-side protocol loop     |

`@okikio/worker` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics with
Worker.postMessage(), correlation IDs, a pending-request Map, and explicit termination/error cleanup.

The utility standardizes that protocol and its cancellation/result behavior without owning scheduling or durable
attempts.

## Replies and protocol failures

Worker-side implementations use `reply()` to create a correlated response for the current request instead of
hand-assembling protocol envelopes. Expected host-side failures are:

- `WorkerProtocolError` for malformed or mismatched protocol messages.
- `WorkerFailureError` for a declared remote failure response.
- `WorkerFaultError` for an unexpected remote fault.
- `WorkerStoppedError` when the owned Worker terminates before a pending request settles.

## Unexpected faults

Unexpected thrown values are projected through `@okikio/fault` before they cross the Worker message seam. That
projection is bounded, detects cycles, and does not intentionally invoke accessor-backed diagnostic fields. Expected
declared failures still use `@okikio/failure` and remain a separate protocol branch.

## Source guide

Start with this README, then use the source in this order when you need more detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*.test.ts` files show edge cases, cancellation, invalid input, and lifecycle behavior as executable examples.
4. Read internal implementation files only when you need the exact state transition or performance-sensitive loop.

The README is the primary user documentation. It intentionally stays close to the public source instead of maintaining a
separate hand-written API reference.
