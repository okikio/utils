# Call code in another execution environment

A text-analysis module can run in a Worker while its caller waits for a summary. The client sends checked input, matches
the reply to that request, and keeps cancellation and shutdown tied to the caller. A late reply must never complete a
different request.

A Web Worker is not a durable job worker. It isolates execution, but process loss still loses local state. Saved
workflow workers use a queue and recovery store.

## Send text to a Worker and read its summary

Keep the two named files together. The Worker counts the supplied text, while the main program owns the Worker and
awaits its reply. The printed word, paragraph, and character counts are results from that actual request.

After `mise run prepare -- --kind deps`, run the main file with `mise exec -- deno run --allow-read main.ts`.

Save the companion module with its shown filename beside the main program. The example runner writes both files before
launching the Worker.

```ts support=thread.ts
import * as worker from '@okikio/worker/thread';
import * as schema from '@okikio/schema';
worker.serve({
	protocol: worker.protocol({
		request: schema.object({ title: schema.string(), text: schema.string() }),
		response: schema.object({
			title: schema.string(),
			words: schema.number({ integer: true, minimum: 0 }),
			paragraphs: schema.number({ integer: true, minimum: 0 }),
			characters: schema.number({ integer: true, minimum: 0 }),
		}),
	}),
	run(request) {
		const text = request.text.trim();
		return {
			title: request.title,
			words: text.match(/\S+/gu)?.length ?? 0,
			paragraphs: text.length === 0 ? 0 : text.split(/\n\s*\n/u).length,
			characters: request.text.length,
		};
	},
});
```

The main file opens that companion module and sends the text. Awaiting the request gives the checked summary; leaving
the owned scope closes the Worker.

```ts runnable=main.ts
import * as context from '@okikio/context';
import * as worker from '@okikio/worker/thread';
import * as schema from '@okikio/schema';
await using ctx = context.create({ id: 'thread-owner' });
// The session owns the thread. Scope exit waits for its cleanup; the module runs in that thread.
await using thread = worker.open(ctx, {
	module: new URL('./thread.ts', import.meta.url),
	protocol: worker.protocol({
		request: schema.object({ title: schema.string(), text: schema.string() }),
		response: schema.object({
			title: schema.string(),
			words: schema.number({ integer: true, minimum: 0 }),
			paragraphs: schema.number({ integer: true, minimum: 0 }),
			characters: schema.number({ integer: true, minimum: 0 }),
		}),
	}),
});
// Only checked data crosses the boundary. The caller's context carries cancellation for this request.
const summary = await thread.request(ctx, {
	title: 'Family photo notes',
	text: 'Ada keeps the family photo.\n\nLin records its date.',
});
console.log(`${summary.title}: ${summary.words} words in ${summary.paragraphs} paragraphs`);
console.log(`${summary.characters} characters`);
```

Expected output:

```text output
Family photo notes: 9 words in 2 paragraphs
50 characters
```

## Choose a native opener without changing the protocol

`@okikio/worker/thread` provides a validated correlated protocol over standard Worker threads. The generic package owns
request IDs, request and response validation, expected failures, transfer lists, cancellation, protocol invalidation,
cooperative shutdown, and final termination.

The default opener uses the Web `Worker` constructor. Tests or another host can inject a `WorkerFactory`, while
Deno-specific permission policy remains on the explicit `@okikio/runtime/deno/worker` subpath. This keeps the root
usable anywhere the standard Worker contract is available without embedding one runtime's options in the public model.

Use this utility only when the runtime resource is a Worker thread. A media or analysis package should still name the
concrete resource it exposes to its callers.

## Know what happens when a message is invalid or late

Each request carries a unique ID and a serialized context snapshot. The Worker creates local cancellation state for that
request and returns exactly one result, expected failure, or fault. Unknown IDs, duplicate active IDs, malformed
envelopes, and invalid response data invalidate the Worker because request correlation can no longer be trusted.

Cancellation before dispatch prevents a request from being sent. After dispatch, cancellation sends a cancel envelope
and retains the pending request until the Worker confirms that validation, execution, encoding and request cleanup have
settled. The request then rejects with `ContextCancelledError`; a progress message is not that confirmation.

`cancelMs` bounds this cooperative wait. If the Worker cannot confirm release, the parent retires it and the request
rejects with `WorkerStoppedError`, retaining the cancellation cause. The host adapter must join actual termination
before its capacity can be reused. A termination or cleanup failure remains a failure; requesting cancellation alone
does not establish that the host stopped. See [completion includes cleanup](../packages/worker/thread/README.md#completion-includes-cleanup).

## Serve the same protocol inside the Worker

This extension sketch assumes an application-owned `MediaProtocol` and `convert()` function. Use the complete report
pair above when learning only the request/result path.

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

The parent and Worker share the same protocol definition. Cancellation travels to the Worker as a control message; the
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

`worker.open()` constructs a standard module Worker unless the caller supplies `create`. `@okikio/runtime/deno/worker`
wraps the same generic opener and adds Deno's Worker permission option during construction. Request correlation,
validation, lifecycle, and shutdown still remain in `@okikio/worker/thread`.

`handle.stop()` asks the Worker server to stop cooperatively. If the Worker does not acknowledge shutdown before
`shutdownMs`, the generic owner terminates the raw Worker. Disposing the handle follows the same path, so explicit stop
and resource cleanup remain coordinated.

## Replies and protocol failures

Worker-side implementations use `reply()` to create a correlated response for the current request instead of
hand-assembling protocol envelopes. Expected host-side failures are:

- `WorkerProtocolError` for malformed or mismatched protocol messages.
- `WorkerFailureError` for a declared remote failure response.
- `WorkerFaultError` for an unexpected remote fault.
- `WorkerStoppedError` when the owned Worker terminates before a pending request settles.

## Unexpected faults

Unexpected thrown values are projected through `@okikio/result/fault` before they are sent back in a Worker reply. That
projection is bounded, detects cycles, and does not intentionally invoke accessor-backed diagnostic fields. Expected
declared failures still use `@okikio/result/failure` and remain a separate protocol branch.

Read the [public source](../packages/worker/thread/mod.ts) for the complete exported contracts and field descriptions.

## Decide which bookkeeping to keep in your application

| Convenience         | Manual equivalent                                                                                                                                   | Concrete value                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `worker.protocol()` | define request/response/notice/call schemas and message discriminants yourself                                                                      | one typed cloneable wire contract |
| `worker.open()`     | create correlation maps, post messages, transfer values, link cancellation, validate replies, surface failures/faults, and stop the Worker manually | one owned Worker client lifetime  |
| `worker.serve()`    | install message listeners, validate requests, execute handlers, encode expected failures/faults, and reply with correlation IDs                     | one server-side protocol loop     |

The same behavior can be built with Worker.postMessage(), correlation IDs, a pending-request Map, and explicit
termination/error cleanup.

The utility standardizes that protocol and its cancellation/result behavior without owning scheduling or durable
attempts.
