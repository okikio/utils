# `@okikio/worker`

An application needs to analyze a large file without putting all of that work in its main JavaScript execution thread. A
standard Worker runs another module in a separate execution environment. `@okikio/worker` lets the parent call that
module with validated requests, receive the matching result, and own shutdown without writing its own message protocol.

A **protocol** describes the request and response shapes. **Correlation** matches each response to its request. A Worker
can provide CPU parallelism when the host supports it; message transfer and setup still have costs, so the small text
demo teaches the communication boundary rather than demonstrating a speedup.

```text
Parent module                         Worker module
open(thread.ts) --------------------> serve(protocol)
request: title + report text + ID --> validate -> count words and paragraphs
matching summary + same ID <--------- validate response -> settle this request
await using ends -------------------> cooperative stop / bounded termination
```

Read across each row as a message crossing the boundary, then down as the lifecycle. The Worker owns its local
execution; the parent owns the handle and shutdown. This diagram omits progress notices and reverse calls, which have
separate meanings from a terminal response.

## Summarize a report in a separate module

A document screen can send report text to an analysis module and receive a small summary for display. Save the parent
and Worker modules below together. This fixture is deliberately short so its counts are inspectable. The same handler
can analyze a larger text; choose a Worker when isolating that CPU work is worth module startup and message-copy costs.

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
	protocol: worker.protocol({
		request: z.object({ title: z.string(), text: z.string() }),
		response: z.object({
			title: z.string(),
			words: z.number().int().nonnegative(),
			paragraphs: z.number().int().nonnegative(),
			characters: z.number().int().nonnegative(),
		}),
	}),
});
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

Worker module, saved as `thread.ts`:

```ts support=thread.ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as worker from '@okikio/worker';
import { z } from 'zod';
worker.serve({
	protocol: worker.protocol({
		request: z.object({ title: z.string(), text: z.string() }),
		response: z.object({
			title: z.string(),
			words: z.number().int().nonnegative(),
			paragraphs: z.number().int().nonnegative(),
			characters: z.number().int().nonnegative(),
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

## Read the mini-demo

The first paragraph has five words and the second has four. The handler counts whitespace-separated chunks as words,
blank-line-separated blocks as paragraphs, and JavaScript string code units as characters. Those are explicit display
rules, not language-aware word segmentation. An empty report returns zero words and paragraphs. Both modules validate
the request and summary shapes, and the parent uses the inferred fields directly to render the result.

The benefit is a separate analysis module with a checked request/result boundary. The utility supplies validation,
request IDs, matching Promise settlement, and owned shutdown around standard Worker messaging. A plain function call is
sufficient when the report is small and isolation is unnecessary. This fixture makes no speedup claim. A host must
supply the standard Worker contract or an appropriate factory.

The ordinary call is `await thread.request(ctx, input)`. With these schemas it takes `{ title, text }` and resolves to
`{ title, words, paragraphs, characters }`; there is no additional result container. The Context supplies cancellation,
identity, and a serializable clock/deadline snapshot. `await using thread` owns shutdown when the block ends. It is the
Worker handle, not the summary object, that needs disposal.

| Contract                                              | Why it exists                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `WorkerProtocol<Request, Response>`                   | Request and response schemas shared in meaning by the parent and Worker.               |
| `WorkerHandle.request(ctx, input): Promise<Response>` | Ordinary async call; it validates both sides and matches the response to this request. |
| `run(request, ctx, control)`                          | The Worker-side function returning your response value or Promise.                     |
| `control.checkpoint(): Promise<void>`                 | An explicit place for cooperative pause to wait for resume.                            |
| Request envelope                                      | `{ type: 'request', id, context: snapshot, request: validatedInput }`.                 |
| Result envelope                                       | `{ type: 'result', id, response: validatedOutput }`.                                   |

The parent validates input, assigns a request ID, and remembers its pending Promise before sending a message. The Worker
reconstructs a local Context, validates input, calls `run()`, validates the output, and sends a result with the same ID.
The parent resolves that one Promise. Cancellation uses a control message and local AbortController in the receiving
realm; an AbortSignal is not sent as a transferable object. The [contract reference](API.md) includes the failure,
notice, and reverse-call envelopes when you need them.

## Keep results attached to the report that requested them

While the first parent's handle is open, it can send several reports using the same protocol. The utility assigns each
call a request ID; each Promise receives the matching summary. `Promise.all()` returns the summaries in input order, so
a screen can keep its report list in that order even if a later request returns first.

This extension continues the parent module above with its existing `thread` and `ctx`:

```ts
const reports = [
	{ title: 'Photo notes', text: 'Ada keeps the family photo.' },
	{ title: 'Date notes', text: 'Lin records its date.' },
];
const summaries = await Promise.all(reports.map((report) => thread.request(ctx, report)));
console.log(summaries.map((summary) => `${summary.title}: ${summary.words} words`).join('\n'));
// Photo notes: 5 words
// Date notes: 4 words
```

One Worker still runs its JavaScript on one execution thread. Multiple outstanding requests exercise correlation; they
do not create additional CPU threads or guarantee that two synchronous analyses run in parallel.

- **Analyze uploaded files:** combine a [Context](../context/README.md) for cancellation with this protocol for the
  analysis request. Transferable buffers can move across the boundary when ownership is deliberately transferred;
  ordinary resource handles and AbortSignals do not become transferable merely by being in a request.
- **Reuse several analysis threads:** let [Pool](../pool/README.md) own Worker handles and
  [Concurrency](../concurrency/README.md) limit admitted analysis calls. Add [Queue](../queue/README.md) for pending
  logical work; the Worker itself supplies neither durable attempts nor cross-machine placement.

## Build on the example

Save the second module beside the first. Start with request/result, then add notices for progress and reverse calls for
host-owned policy. A notice is not completion. Transfer lists move ownership of transferable data; they do not move
arbitrary resources. Pause is cooperative and requires handler checkpoints. Cancellation can stop waiting for a schema,
but an external validator still owns its resources. The parent owns Worker shutdown; each realm needs its own optional
polyfill imports.

## Purpose

`@okikio/worker` provides a validated correlated protocol over standard Worker threads. The generic package owns request
IDs, request and response validation, expected failures, transfer lists, cancellation, protocol invalidation,
cooperative shutdown, and final termination.

The default opener uses the Web `Worker` constructor. Tests or another host can inject a `WorkerFactory`, while
Deno-specific permission policy remains on the explicit `@okikio/worker/deno` subpath. This keeps the root usable
anywhere the standard Worker contract is available without embedding one runtime's options in the public model.

Use this utility only when the runtime resource is a Worker thread. A media or analysis package should still name the
concrete resource it exposes to its callers.

## Know what happens when a message is invalid or late

Each request carries a unique ID and a serialized context snapshot. The Worker creates local cancellation state for that
request and returns exactly one result, expected failure, or fault. Unknown IDs, duplicate active IDs, malformed
envelopes, and invalid response data invalidate the Worker because request correlation can no longer be trusted.

Cancellation before dispatch prevents a request from being sent. Cancellation after dispatch sends a cancel envelope and
rejects the local request. A late response for a recently cancelled ID is ignored for a bounded period so one
cooperative cancellation does not invalidate a healthy Worker.

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

Read the [generated API reference](API.md) for the complete exported contracts and field descriptions.
