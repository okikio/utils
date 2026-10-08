# `@okikio/telemetry`

An import fails after several steps. A final “failed” message alone cannot tell you which request it belonged to or what
happened just before the error. `@okikio/telemetry` gives diagnostic events consistent names and shared identifying
fields, and can retain a limited recent history to show when failure occurs.

A **reporter** receives diagnostic records. A **scope** attaches fields such as `request_id` to related records.
**Correlation** means using those fields to follow the same work across components. Telemetry observes work; it does not
decide whether the work succeeded, was authorized, or was durably stored.

```text
import.started (debug) -> bounded recent-history buffer
                                    |
import.failed (error) --------------> flush history + error -> reporter
```

The visual shows the demo's diagnostic delivery, not control of the import. Reporter failures are isolated from the
operation, and real applications choose destinations and redaction policy.

## Keep the events that explain a failed import

```ts runnable
import * as telemetry from '@okikio/telemetry';
const output = telemetry.memory();
const buffered = telemetry.buffer(output, { capacity: 2 });
const scope = telemetry.create(buffered, { fields: { request_id: 'request-1' } });
await scope.report({ name: 'import.started', level: 'debug' });
await scope.report({ name: 'import.failed', level: 'error' });
console.log(output.records.map((event) => event.name).join(','));
```

Expected output:

```text output
import.started,import.failed
```

## Read the mini-demo

The demo creates an in-memory reporter and a buffer with capacity two. Reporting `import.started` retains useful
history; reporting `import.failed` flushes that history and the error. The printed names are
`import.started,import.failed`, and both records carry `request_id: 'request-1'`. Capacity is per correlation key, not a
total bound on all keys; discard completed keys so a long-lived host does not accumulate them. Try inspecting
`output.records` after only the debug event to see the distinction between buffered history and delivered records. The
example does not send anything to a remote logging service.

`create()` returns a scope immediately. `scope.report()` returns `Promise<Event>` after creating the record and
attempting delivery. `scope.child(fields)` returns another scope that inherits its parent's fields and reporter. These
are normal objects and callbacks; they require no Context, global logger, or hidden async-local storage.

The useful contract is small:

```text
Event:    { kind: "telemetry-event", name, level, message, at, fields, fault?, error? }
Reporter: { report(event): void | Promise<void>, flush?(): void | Promise<void> }
Scope:    { report(input): Promise<Event>, child(fields): Scope, flush(): Promise<void> }
```

When you report an event, the scope combines shared fields with per-event fields, assigns defaults for severity and
time, projects unexpected errors into bounded diagnostic data, and calls the reporter. A scope isolates delivery
failures so a broken logging destination cannot turn a successful file save into a failed save. Invalid event inputs can
still reject; reporter isolation is not a guarantee that every call is valid. Calling a raw Reporter directly does not
add scope-level isolation.

The buffer is an optional reporter wrapper. It retains low-severity history in a ring per correlation key. A trigger
event delivers that key's retained records before the trigger. `capacity` bounds history per key, not the number of
keys; call `discard(key)` when completed work no longer needs its history. See the [contract reference](API.md) for
buffer key selection and explicit flush behavior.

## Add request and note IDs to a normal save function

Start without buffering when all you need is consistent log fields. This in-memory save still returns its ordinary
string ID. The child scope adds a note ID to the request fields, so the accepted record can be traced to both.

```ts runnable=save-note.ts
import * as telemetry from '@okikio/telemetry';
import type { Scope } from '@okikio/telemetry';
const output = telemetry.memory();
const log = telemetry.create(output, { fields: { request_id: 'request-1' } });
const notes = new Map<string, string>();
async function save(log: Scope, id: string, text: string): Promise<string> {
	notes.set(id, text);
	await log.child({ note_id: id }).report({ name: 'note.saved', fields: { characters: text.length } });
	return id;
}
console.log(await save(log, 'note-7', 'Remember the photo'));
const saved = output.records[0];
console.log(saved?.name, saved?.fields.request_id, saved?.fields.note_id);
```

```text output
note-7
note.saved request-1 note-7
```

The Map owns the saved state. The report helps diagnose that state; it is not a receipt for durable storage. A real
application can pass a LogTape adapter as the reporter without changing `save()`'s signature or return value.

- **Investigate a thumbnail failure:** observe [Queue](../queue/README.md) attempts and [Worker](../worker/README.md)
  requests using lifecycle adapters. Shared identifiers connect the diagnostics; the queue claim and Worker result
  remain the respective authorities.
- **Trace a web request:** adapt [Service](../server/service/README.md) or [Gateway](../server/gateway/README.md)
  observer events to a scope. The host chooses LogTape sinks or an OpenTelemetry setup; importing this package does not
  install a tracing SDK.

## Build on the example

Start with a memory reporter to inspect behavior, then choose an explicit LogTape or OpenTelemetry adapter. Scope fields
attach correlation, and buffering can retain a bounded recent history until failure. Applications configure logging and
exporting. Telemetry is observation; it cannot authorize cancellation, settle a job or prove an authoritative effect was
accepted.

## Purpose

`@okikio/telemetry` gives reusable code one portable language for diagnostics: stable event names, severities,
correlation fields, bounded fault data, explicit scopes, reporter fan-out, and bounded failure-history buffering.

It does not configure a logger or tracing SDK. An application decides where records go and which runtime features are
available.

## Manual equivalent

### The problem without a telemetry contract

Ordinary code can log useful information directly:

```ts
console.debug('claim acquired', claim.id);
try {
	await run(claim);
} catch (error) {
	console.error('claim failed', error);
}
```

That is enough for one local function. It becomes difficult when the same work crosses an HTTP request, queue, Worker,
process, or workflow. Each module invents field names and messages, and a failure log no longer tells you which earlier
records belong to the same operation.

A manual structured implementation improves this, but every caller must repeat correlation, fault projection, sink error
isolation, and buffering policy:

```ts
const record = {
	event: 'queue.claim.acquired',
	request_id: requestId,
	trace_id: traceId,
	claim_id: claim.id,
};
await sink.write(record);
```

## Use the utility

A telemetry scope makes the correlation explicit. Explicit scopes work even in browsers and edge runtimes that do not
provide async-local context:

```ts
import * as telemetry from '@okikio/telemetry';

const output = telemetry.memory();
const request = telemetry.create(output, {
	fields: {
		request_id: 'req-42',
		service_id: 'account',
	},
});

const operation = request.child({ operation_id: 'account.get' });
await operation.report({
	name: 'service.request.started',
	level: 'debug',
});
```

The emitted record has one stable `name` for machines and a separate `message` for people. Changing prose later does not
require changing dashboards that group by `service.request.started`.

## Keep failure history without flooding normal logs

Use `buffer()` to retain bounded low-level history by correlation key. Error and fatal events flush that history
automatically:

```ts
const output = telemetry.memory();
const history = telemetry.buffer(output, { capacity: 64 });
const trace = telemetry.create(history, {
	fields: { trace_id: 'trace-123' },
});

await trace.report({ name: 'queue.claim.acquired', level: 'debug' });
await trace.report({ name: 'worker.request.started', level: 'trace' });

try {
	await remoteWork();
	history.discard('trace-123');
} catch (error) {
	await trace.report({
		name: 'worker.request.failed',
		level: 'error',
		error,
	});
}
```

Successful work can discard the retained history. A failed operation emits the preceding bounded records first, followed
by the failure.

## Execution contexts

`@okikio/context` owns operation identity, cancellation, deadlines, and clocks. Telemetry projects that identity; it
does not replace the context:

```ts
import * as context from '@okikio/context';
import * as telemetry from '@okikio/telemetry';

await using ctx = context.create({ id: 'import:42', traceId: 'trace-42' });
const scope = telemetry.create(reporter, {
	fields: telemetry.contextFields(ctx),
	now: () => ctx.clock.now().toString(),
});

await scope.report({ name: 'import.started', level: 'info' });
```

This keeps one clock and one operation identity across queues, workers, processes, workflows, and diagnostics.

## LogTape adapter

The optional LogTape adapter accepts an already-configured logger. The utility never calls `configure()`:

```ts
import { getLogger } from '@logtape/logtape';
import * as telemetry from '@okikio/telemetry';
import * as logtape from '@okikio/telemetry/logtape';

const scope = telemetry.create(
	logtape.reporter(getLogger(['app', 'account'])),
	{ fields: { service_id: 'account' } },
);

await scope.report({
	name: 'service.ready',
	level: 'info',
	message: 'Account service is ready.',
});
```

`logtape.run({ withContext }, fields, callback)` is an opt-in bridge to LogTape implicit contexts. The host supplies the
bridge, so this adapter does not import LogTape. Use it only when the host runtime configured context-local storage.
Explicit telemetry fields remain the portable baseline.

## OpenTelemetry adapter

`@okikio/telemetry/otel` reads an already-active OpenTelemetry span through a small structural API. It does not import
or install a context manager, SDK, tracer provider, exporter, or auto-instrumentation:

```ts
import { context, trace } from '@opentelemetry/api';
import * as telemetry from '@okikio/telemetry';
import * as otel from '@okikio/telemetry/otel';

const scope = telemetry.create(reporter, {
	fields: {
		...telemetry.traceFields(otel.active({ context, trace })),
		request_id: 'req-42',
	},
});
await scope.report({ name: 'account.read', fields: { account_id: 'account-7' } });
```

The host owns the OpenTelemetry dependency and configuration. If there is no active span,
`otel.active({ context, trace })` returns an empty record. The portable core remains independent of OpenTelemetry.

## Server lifecycle adapters

`@okikio/telemetry/server` turns import-safe Service and Gateway observer events into the same telemetry record shape.
The server utilities remain unaware of LogTape, OpenTelemetry, or a vendor backend:

```ts
import * as telemetry from '@okikio/telemetry';
import * as serverTelemetry from '@okikio/telemetry/server';

const Diagnostics = service.observer.define({
	id: 'accounts.diagnostics',
	description: 'Observe account requests.',
});
const scope = telemetry.create(reporter, { fields: { deployment_id: 'blue' } });

await using runtime = service.create(compiled, {
	host,
	observers: [serverTelemetry.service(Diagnostics, scope)],
});
const response = await runtime.fetch(new Request('https://example.test/accounts/account-7'));
console.log(response.status);
```

The same adapter exposes `serverTelemetry.gateway()` for Gateway observer definitions. Service and Gateway continue to
own their lifecycle events; the adapter only projects those events for diagnostics.

## Lifecycle stream adapters

Queue, Pool, Worker, Process, and process-channel already expose observable lifecycle event streams.
`@okikio/telemetry/lifecycle` supplies callbacks that translate those events without changing their state machines:

```ts
import * as lifecycle from '@okikio/telemetry/lifecycle';

using queueLogs = jobs.events.subscribe(
	lifecycle.queue(scope, { queue_id: 'research' }),
);
using workerLogs = worker.events.subscribe(
	lifecycle.worker(scope, { worker_id: worker.id }),
);
```

A queue claim expiry becomes `queue.claim.expired`; a Worker transport fault becomes `worker.request.faulted`; a failed
process exit becomes `process.exited` with error severity. Payloads are not copied into telemetry fields.

The adapter returns an ordinary callback. Subscription ownership remains with the caller and the source utility.

## What belongs elsewhere

| Area                                                  | Owner               |
| ----------------------------------------------------- | ------------------- |
| operation cancellation, deadline, clock               | `@okikio/context`   |
| safe bounded arbitrary fault projection               | `@okikio/fault`     |
| durable business/usage measurement                    | `@okikio/meter`     |
| event records, correlation, failure-history mechanics | `@okikio/telemetry` |
| LogTape sinks, levels, redaction, files               | application host    |
| OpenTelemetry SDK/exporters/auto-instrumentation      | application host    |
| Sentry/Grafana/vendor configuration                   | application host    |

## Composition with lifecycle utilities

Queue, pool, Worker, and process utilities already expose lifecycle event streams. A host can subscribe to those streams
and translate each authoritative state transition into a stable telemetry event without making telemetry part of the
state machine:

```ts
using subscription = jobs.events.subscribe((event) => {
	void scope.report({
		name: `queue.${event.type.replaceAll('-', '.')}`,
		level: event.type === 'claim-expired' ? 'warning' : 'debug',
		fields: 'itemId' in event ? { item_id: event.itemId } : {},
	});
});
```

The queue retains authority for its state and result. Its events and telemetry reports are observations; a missed report
does not change the queue result.

## Source guide

1. `types.ts` defines the portable event, reporter, scope, and buffering contracts.
2. `mod.ts` implements explicit scopes, fault projection, fan-out, memory recording, and bounded failure history.
3. `logtape.ts` adapts a host-configured LogTape logger.
4. `otel.ts` extracts active OpenTelemetry correlation only.
5. `server.ts` and `lifecycle.ts` adapt existing import-safe/lifecycle event contracts.
6. `*.test.ts` prove field isolation, bounded buffering, fan-out, adapters, and no-SDK behavior.
