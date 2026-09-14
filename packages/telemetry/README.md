`@okikio/telemetry`
===================

Purpose
-------

`@okikio/telemetry` gives reusable code one portable language for diagnostics:
stable event names, severities, correlation fields, bounded fault data, explicit
scopes, reporter fan-out, and bounded failure-history buffering.

It does not configure a logger or tracing SDK. An application decides where
records go and which runtime features are available.

Manual equivalent
-----------------

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

That is enough for one local function. It becomes difficult when the same work
crosses an HTTP request, queue, Worker, process, or workflow. Each module invents
field names and messages, and a failure log no longer tells you which earlier
records belong to the same operation.

A manual structured implementation improves this, but every caller must repeat
correlation, fault projection, sink error isolation, and buffering policy:

```ts
const record = {
  event: 'queue.claim.acquired',
  request_id: requestId,
  trace_id: traceId,
  claim_id: claim.id,
};
await sink.write(record);
```

Use the utility
---------------

A telemetry scope makes the correlation explicit. Explicit scopes work even in
browsers and edge runtimes that do not provide async-local context:

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

The emitted record has one stable `name` for machines and a separate `message`
for people. Changing prose later does not require changing dashboards that group
by `service.request.started`.

Keep failure history without flooding normal logs
-------------------------------------------------

Use `buffer()` to retain bounded low-level history by correlation key. Error and
fatal events flush that history automatically:

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

Successful work can discard the retained history. A failed operation emits the
preceding bounded records first, followed by the failure.

Execution contexts
------------------

`@okikio/context` owns operation identity, cancellation, deadlines, and clocks.
Telemetry projects that identity; it does not replace the context:

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

This keeps one clock and one operation identity across queues, workers,
processes, workflows, and diagnostics.

LogTape adapter
---------------

The optional LogTape adapter accepts an already-configured logger. The utility
never calls `configure()`:

```ts
import { getLogger, withContext } from '@logtape/logtape';
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

`logtape.run({ withContext }, fields, callback)` is an opt-in bridge to LogTape
implicit contexts. The host supplies the bridge, so this adapter does not import
LogTape. Use it only when the host runtime configured context-local storage.
Explicit telemetry fields remain the portable baseline.

OpenTelemetry adapter
---------------------

`@okikio/telemetry/otel` reads an already-active OpenTelemetry span through a
small structural API. It does not import or install a context manager, SDK, tracer
provider, exporter, or auto-instrumentation:

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
```

The host owns the OpenTelemetry dependency and configuration. If there is no active
span, `otel.active({ context, trace })` returns an empty record. The portable core
remains independent of OpenTelemetry.

Server lifecycle adapters
-------------------------

`@okikio/telemetry/server` turns import-safe Service and Gateway observer events
into the same telemetry record shape. The server utilities remain unaware of
LogTape, OpenTelemetry, or a vendor backend:

```ts
import * as telemetry from '@okikio/telemetry';
import * as serverTelemetry from '@okikio/telemetry/server';

const Diagnostics = service.observer.define({
  id: 'accounts.diagnostics',
  description: 'Observe account requests.',
});
const scope = telemetry.create(reporter, { fields: { deployment_id: 'blue' } });

const runtime = service.create(compiled, {
  host,
  observers: [serverTelemetry.service(Diagnostics, scope)],
});
```

The same adapter exposes `serverTelemetry.gateway()` for Gateway observer
definitions. Service and Gateway continue to own their lifecycle events; the
adapter only projects those events for diagnostics.

Lifecycle stream adapters
-------------------------

Queue, Pool, Worker, Process, and process-channel already expose authoritative
observable event streams. `@okikio/telemetry/lifecycle` supplies callbacks that
translate those events without changing their state machines:

```ts
import * as lifecycle from '@okikio/telemetry/lifecycle';

using queueLogs = jobs.events.subscribe(
  lifecycle.queue(scope, { queue_id: 'research' }),
);
using workerLogs = worker.events.subscribe(
  lifecycle.worker(scope, { worker_id: worker.id }),
);
```

A queue claim expiry becomes `queue.claim.expired`; a Worker transport fault
becomes `worker.request.faulted`; a failed process exit becomes `process.exited`
with error severity. Payloads are not copied into telemetry fields.

The adapter returns an ordinary callback. Subscription ownership remains with
the caller and the source utility.

What belongs elsewhere
----------------------

| Area | Owner |
| --- | --- |
| operation cancellation, deadline, clock | `@okikio/context` |
| safe bounded arbitrary fault projection | `@okikio/fault` |
| durable business/usage measurement | `@okikio/meter` |
| event records, correlation, failure-history mechanics | `@okikio/telemetry` |
| LogTape sinks, levels, redaction, files | application host |
| OpenTelemetry SDK/exporters/auto-instrumentation | application host |
| Sentry/Grafana/vendor configuration | application host |

Composition with lifecycle utilities
------------------------------------

Queue, pool, Worker, and process utilities already expose lifecycle event
streams. A host can subscribe to those streams and translate each authoritative
state transition into a stable telemetry event without making telemetry part of
the state machine:

```ts
using subscription = jobs.events.subscribe((event) => {
  void scope.report({
    name: `queue.${event.type.replaceAll('-', '.')}`,
    level: event.type === 'claim-expired' ? 'warning' : 'debug',
    fields: 'itemId' in event ? { item_id: event.itemId } : {},
  });
});
```

The event stream remains authoritative for queue state. Telemetry remains
observational and can fail without changing the queue result.

Source guide
------------

1. `types.ts` defines the portable event, reporter, scope, and buffering contracts.
2. `mod.ts` implements explicit scopes, fault projection, fan-out, memory recording, and bounded failure history.
3. `logtape.ts` adapts a host-configured LogTape logger.
4. `otel.ts` extracts active OpenTelemetry correlation only.
5. `server.ts` and `lifecycle.ts` adapt existing import-safe/lifecycle event contracts.
6. `*.test.ts` prove field isolation, bounded buffering, fan-out, adapters, and no-SDK behavior.
