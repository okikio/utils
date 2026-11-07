# Observe execution without owning its outcome

When a contact import fails, retain its preceding steps with the same request ID. A reporter is the destination
callback; a scope adds shared identifying fields to each record. Logs describe individual events, a trace joins steps
across an operation, metrics summarize many operations, and a CPU profile samples where time was spent.

The portable entry supplies diagnostic events, buffering, JSON output, and LogTape bridging. For a Node service, the
[collection setup](./04-setup.md) also connects logs, traces, and operational metrics to an explicit endpoint. The
application opens that collection and joins its shutdown; importing the portable reporter starts no exporter.

For ordinary reporting, a destination and a scope are sufficient. This complete program attaches one request ID and
prints the delivered event. After the [checkout setup](../../README.md#work-on-the-repository), save it as
`report-note.ts` at the root and run `mise exec -- deno run report-note.ts`. It needs no Context, collector, buffer or
global configuration:

```ts runnable=report-note.ts
import * as telemetry from '@okikio/telemetry';
const output = telemetry.memory();
const log = telemetry.create(output, { fields: { request_id: 'request-1' } });
await log.report({ name: 'note.saved' });
console.log(output.records[0]?.name, output.records[0]?.fields.request_id);
```

```text output
note.saved request-1
```

The memory reporter keeps records for inspection; a long-lived application must clear it or select another destination.
The next example adds buffering because it wants debug history only when an error occurs. Those retention settings are
an optional delivery policy, rather than prerequisites for emitting a diagnostic event.

## Retain the events that explain a failed import

Attach a request ID to the import events and retain recent history until an error occurs. The output shows which records
reach the destination. Application code still owns whether the import succeeds or fails.

From the checkout root, review `mise.toml`, run `mise trust`, `mise install` and `mise run prepare -- --kind deps`. Save this as
`example.ts` and run `mise exec -- deno run example.ts`. No collector or network permission is needed.

```ts runnable
import * as telemetry from '@okikio/telemetry';
const output = telemetry.memory();
// Retain a bounded recent history, then flush it when the failure makes that history useful.
const buffered = telemetry.buffer(output, { capacity: 2, maximumKeys: 64, maximumRecords: 1024 });
// Attach the request ID once so both events can be traced to the same operation.
const scope = telemetry.create(buffered, { fields: { request_id: 'request-1' } });
await scope.report({ name: 'import.started', level: 'debug' });
await scope.report({ name: 'import.failed', level: 'error' });
console.log(output.records.map((event) => event.name).join(','));
```

Expected output:

```text output
import.started,import.failed
```

The buffer holds diagnostic history, not a queue of business jobs. A retained event has not reached the reporter;
flushing detaches that history before attempting delivery, so a reporter failure does not put it back.

| State or action | Where the record is | What it means |
| --- | --- | --- |
| Retained | In a bounded history for one key | Waiting for a trigger or explicit flush. |
| Pending delivery | Detached from history; reporter call is in progress | Retention counters no longer include it. |
| Delivered | The reporter call has returned | The destination accepted the call; durable storage depends on that reporter. |
| Evicted | Removed because a retention limit was reached | Diagnostic history was lost; `dropped` increases. |
| Discarded | Explicitly removed with `discard(key)` | The caller no longer needs that history; `dropped` does not increase. |

An error or fatal event triggers that key's history delivery, then its own delivery. Scope-level isolation protects
business results from reporter failure; it cannot make a failed destination retain the record. None of these states
proves that the import's business write committed.

## Compare explicit reporting with ordinary logging

Ordinary code can log useful information directly:

```ts
console.debug('import started', importId);
try {
	await importContacts();
} catch (error) {
	console.error('import failed', error);
}
```

That is enough for one local function. It becomes difficult when the same work crosses an HTTP request, queue, Worker,
process, or workflow. Each module invents field names and messages, and a failure log no longer tells you which earlier
records belong to the same operation.

A manual structured implementation improves this, but every caller must repeat correlation, fault projection, sink error
isolation, and buffering policy:

```ts
const record = {
	event: 'import.started',
	request_id: requestId,
	trace_id: traceId,
	import_id: importId,
};
await sink.write(record);
```

## Choose the diagnostic records callers can rely on

`@okikio/telemetry` gives reusable code one portable language for diagnostics: stable event names, severities,
correlation fields, bounded fault data, explicit scopes, reporter fan-out, and bounded failure-history buffering.

It does not configure a logger or tracing SDK. An application decides where records go and which runtime features are
available.

## Attach an operation ID to related events

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
const history = telemetry.buffer(output, { capacity: 64, maximumKeys: 64, maximumRecords: 1024 });
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

## Observe what retention pressure discards

This independent program keeps only one import's diagnostic history. Save it as `history-pressure.ts` and run
`mise exec -- deno run history-pressure.ts`. Starting the second import evicts the first import's retained debug record.

```ts runnable=history-pressure.ts
import * as telemetry from '@okikio/telemetry';
const output = telemetry.memory();
const history = telemetry.buffer(output, {
	capacity: 2,
	maximumKeys: 1,
	maximumRecords: 2,
	key: (event) => String(event.fields.import_id),
});
const first = telemetry.create(history, { fields: { import_id: 'contacts-1' } });
const second = telemetry.create(history, { fields: { import_id: 'contacts-2' } });
await first.report({ name: 'import.started', level: 'debug' });
await second.report({ name: 'import.started', level: 'debug' });
console.log(JSON.stringify(history.stats()));
await second.report({ name: 'import.failed', level: 'error' });
console.log(output.records.map((event) => event.fields.import_id + ':' + event.name).join(','));
console.log(JSON.stringify(history.stats()));
```

```text output
{"keys":1,"records":1,"dropped":1}
contacts-2:import.started,contacts-2:import.failed
{"keys":0,"records":0,"dropped":1}
```

The error flush releases that key's history before delivery. Eviction loses diagnostic history deliberately; it must
never remove authoritative import state. `stats().dropped` counts capacity eviction, not application completion or
explicit discard. These limits count records and keys, not exact heap bytes; large event fields need projection limits
as well. The memory destination itself retains delivered events for inspection and needs a separate retention policy
in a long-lived host. A real destination may fail: scopes isolate reporter delivery failures, while invalid authored
event inputs still reject.

The following sections are integration reference. They show where an existing Context, logger, service or queue can
supply diagnostic fields; those application-owned values are not prerequisites for the complete import programs above.

## Execution contexts

`@okikio/context` owns operation identity, cancellation, deadlines, and clocks. Telemetry projects that identity; it
does not replace the context:

```ts
import * as context from '@okikio/context';
import * as telemetry from '@okikio/telemetry';

await using ctx = context.create({ id: 'import:42', traceId: 'trace-42' });
// Use the Context identity and clock for this import event.
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

// Attach the service identity to the readiness event.
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

// Combine the active span identity with this request ID for the account-read event.
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
// Attach deployment identity to every lifecycle record projected by this observer.
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

For a Node application that needs provider setup and export, use [the explicit collection adapter](./04-setup.md). It
returns a borrowed LogTape sink and owns provider shutdown. It does not wrap LogTape configuration.

## What belongs elsewhere

| Area                                                  | Owner                                                           |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| operation cancellation, deadline, clock               | `@okikio/context`                                               |
| safe bounded arbitrary fault projection               | `@okikio/result/fault`                                          |
| durable business/usage measurement                    | `@okikio/capability/effect/meter`                               |
| event records, correlation, failure-history mechanics | `@okikio/telemetry`                                             |
| LogTape sinks, levels, redaction, files               | application host                                                |
| SDK lifecycle                                         | application-owned collection, or existing application providers |
| Third-party auto-instrumentation                      | application host                                                |
| Sentry/Grafana/vendor configuration                   | application host                                                |

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

The paths below are relative to the [package directory](../../packages/telemetry).

1. `types.ts` defines the portable event, reporter, scope, and buffering contracts.
2. `mod.ts` implements explicit scopes, fault projection, fan-out, memory recording, and bounded failure history.
3. `logtape.ts` adapts a host-configured LogTape logger.
4. `otel.ts` extracts active OpenTelemetry correlation only.
5. `server.ts` and `lifecycle.ts` adapt existing import-safe/lifecycle event contracts.
6. `*.test.ts` prove field isolation, bounded buffering, fan-out, adapters, and no-SDK behavior.

## Emit bounded JSON Lines

`reporter` from `@okikio/telemetry/json` writes one event through an explicit destination. It excludes live Error
objects and filters common credential field names. Supply `redact(text)` for secrets in messages, URLs and fault
strings; field-name filtering cannot infer those secrets. The byte budget limits accepted encoded output, not every
temporary projection allocation. Hosts own destination ordering, flush and close.

The LogTape adapter still accepts an already-configured logger. Reusable packages do not install or configure another
logging runtime; use the application's resolved LogTape instance for configuration and emission.

## Set global retention and projection limits

`buffer(target, { maximumKeys, maximumRecords, capacity })` requires finite global bounds. `capacity` still caps each
key (default 64). New keys evict the oldest retained key; record pressure evicts the oldest retained record. `stats()`
exposes keys, records and capacity drops. Flush/discard release retained references and do not count as drops. These are
count limits, not an exact heap-byte budget; concurrent flush calls can also hold delivery snapshots.

Fields and fault snapshots use Collection JSON copy limits: depth 128, 1,000,000 expanded nodes and 16,777,216 UTF-16
units in keys/strings by default. `create(..., { projection })` and the fourth `event` argument can lower these limits.
Cycles, sparse arrays, accessors, symbols and non-data objects reject before emission. This stricter JSON contract
replaces the earlier permissive sparse-array projection. Shared references are copied by value and count each time. A
scope's reporter failure remains observational; invalid authored fields remain caller errors.
