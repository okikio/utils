# `@okikio/telemetry`

An import fails after several steps. A final “failed” message alone cannot tell you which request it belonged to or what
happened just before the error. `@okikio/telemetry` gives diagnostic events consistent names and shared identifying
fields, and can retain a limited recent history to show when failure occurs.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

**Telemetry** is information your program emits so you can understand its execution. A log describes an event, a trace
connects timed steps of one operation, and a metric summarizes many observations, such as a request count. None of these
is the saved business record itself: a “saved” log can be emitted before a database commit later fails.

Start with a reporter you can inspect locally. Add a collector only when another service needs to receive and store
those observations. The application chooses destinations, redaction and shutdown; reusable utilities do not configure
those global policies on import.

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

## Keep the events that explain a failed import

Keep the start event in a small history buffer, then report the import failure. The error flushes its recent history to
the memory reporter with the same request ID, making the preceding work inspectable.

These examples use the current experimental source checkout, not an assumed registry release. From the `utils`
repository root, review `mise.toml`, run `mise trust`, then `mise install` and `mise run prepare -- --kind deps`.
Save the following module as `example.ts` and run `mise exec -- deno run example.ts`.
[Checkout prerequisites](../../README.md#work-on-the-repository) explain installing Mise.

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

## Follow buffered history into the error report

The demo creates an in-memory reporter and a buffer with capacity two. Reporting `import.started` retains useful
history; reporting `import.failed` flushes that history and the error. The printed names are
`import.started,import.failed`, and both records carry `request_id: 'request-1'`. `capacity` bounds each key; `maximumKeys` and `maximumRecords` independently bound all retained history. Oldest history
is evicted at those global limits. Discard completed keys to release their history earlier. Try inspecting
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
event delivers that key's retained records before the trigger. `capacity` bounds history per key, `maximumKeys` bounds retained correlations, and `maximumRecords` bounds all retained
records. Call `discard(key)` when completed work no longer needs its history. See the [public source contracts](./mod.ts)
for buffer key selection and explicit flush behavior.

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

- **Investigate a thumbnail failure:** observe [Queue](../scheduler/queue/README.md) attempts and
  [Worker](../worker/thread/README.md) requests using lifecycle adapters. Shared identifiers connect the diagnostics;
  the queue claim and Worker result remain the respective authorities.
- **Trace a web request:** adapt [Service](../server/service/README.md) or [Gateway](../server/gateway/README.md)
  observer events to a scope. The host chooses LogTape sinks or an OpenTelemetry setup; importing this package does not
  install a tracing SDK.

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

## Choose a destination and collection owner

Start with a memory reporter to inspect behavior, then choose an explicit LogTape or OpenTelemetry adapter. Scope fields
attach correlation, and buffering can retain a bounded recent history until failure. Applications configure logging and
exporting. Telemetry is observation; it cannot authorize cancellation, settle a job or prove an authoritative effect was
accepted.

## Observation timestamps and cleanup diagnostics

The lightweight event API stamps an observation with canonical UTC millisecond text using the native Date formatter.
This simple formatting path parses no calendar text and schedules no work; it does not require the Temporal fallback for
a telemetry-only import. Context-aware operations keep their supplied clocks. Elapsed instrumentation uses the host's
performance clock independently from event timestamps.

Fault projection retains the own fields of native AggregateError and SuppressedError values, including nested cleanup
failures. The existing limits on depth, entries, and text still apply, cycles become markers, and inherited fields or
accessor getters are not executed to inspect those diagnostics.

## Keep a failing display from changing the observed work

A progress display can throw while the underlying state update succeeds. The observation adapter contains that
subscriber failure and reports it separately. The state cell retains mutation authority; observation borrows its stream.

```ts runnable=observe-failure.ts
import { create } from '@okikio/context/state';
import { observe } from '@okikio/telemetry/observe';

using progress = create(0);
const diagnostics: unknown[] = [];
const display = observe(progress.reader.changes, {
	onError: (error) => {
		diagnostics.push(error);
	},
});
using subscription = display.subscribe({
	next: () => {
		throw new Error('Display unavailable.');
	},
});
progress.set(1);
console.log(progress.reader.get());
console.log(diagnostics.length);
```

```text output
1
1
```

The first output is authoritative state; the second counts the independent subscriber diagnostic. Closing this
subscription does not close the borrowed cell. Keep callbacks short: containing their failures does not move them to a
background thread or bound their CPU time.

## Follow one operation across several owners

A failed import needs correlated operation events; a service needs request observations; a worker pool needs lifecycle
diagnostics. Each observation describes work owned elsewhere.

Use the portable reporter for events, choose LogTape or JSON for delivery, and select lifecycle or Server adapters for
existing observations. Open Node or OpenTelemetry collection explicitly.

The application configures logging and exporters. Subscriber failures do not become authoritative operation failures,
and a trace does not prove a database commit.

## Export service diagnostics from Node

For Node services and background workers, use
[`@okikio/telemetry/node`](https://github.com/okikio/utils/blob/main/docs/telemetry/04-setup.md). Call
`open({ service, endpoint })`, pass its `sink` and `storage` to native LogTape `configure()`, then start work. At
shutdown, join application work, call LogTape `reset()`, and close the collection. This exports logs, traces, and
operational metrics. Imports start no collection. Profiles remain runtime-specific.

The [complete setup](https://github.com/okikio/utils/blob/main/docs/telemetry/04-setup.md) includes shutdown. The
[signal guide](https://github.com/okikio/utils/blob/main/docs/telemetry/03-design.md) lists exactly which utility
operations are observed automatically. The event reporters below remain useful for explicit destinations and bounded
diagnostic history.

## Choose an entry point

Use the table to find a focused import for the job you need. Contract links open the exact public source, including its
options and types.

| Import                              | Use it to                                                                | Exact contract                   |
| ----------------------------------- | ------------------------------------------------------------------------ | -------------------------------- |
| `@okikio/telemetry`                 | Use the package entry shown in the complete examples above.              | [Contract](./mod.ts)             |
| `@okikio/telemetry/types`           | Import public types for this capability; this entry does not start work. | [Contract](./types.ts)           |
| `@okikio/telemetry/logtape`         | Send portable events to LogTape; applications configure its sinks.       | [Contract](./logtape.ts)         |
| `@okikio/telemetry/otel`            | Read active trace correlation without configuring an SDK.                | [Contract](./otel.ts)            |
| `@okikio/telemetry/server`          | Translate Server lifecycle observations into telemetry.                  | [Contract](./server.ts)          |
| `@okikio/telemetry/events` | Import lifecycle event types without importing a running pool, worker, service, or gateway. Producers also re-export their original type names. | [Contract](./events.ts) |
| `@okikio/telemetry/lifecycle`       | Translate queue, pool, Worker, and process lifecycle events.             | [Contract](./lifecycle.ts)       |
| `@okikio/telemetry/json`            | Write bounded JSON Lines to a caller-owned destination.                  | [Contract](./json.ts)            |
| `@okikio/telemetry/node`            | Open Node-specific collection explicitly.                                | [Contract](./node.ts)            |
| `@okikio/telemetry/instrument`      | Describe portable instrumentation without installing a backend.          | [Contract](./instrument.ts)      |
| `@okikio/telemetry/otel/instrument` | Bind portable instrumentation to OpenTelemetry and LogTape.              | [Contract](./otel/instrument.ts) |
| `@okikio/telemetry/observe`         | Publish read-only observations without transferring work authority.      | [Contract](./observe.ts)         |

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

## Bound JSON delivery to a slow writer

```ts
import * as telemetry from '@okikio/telemetry';
import { queued } from '@okikio/telemetry/json';
await using output = queued({
	write: (line) => console.log(line.trimEnd()),
	maximumBytes: 4096,
	maximumRecords: 64,
	maximumQueuedBytes: 131072,
	overflow: 'drop-oldest',
});
output.report(telemetry.event({ name: 'import.finished', fields: { rows: 12 } }));
await output.flush();
```

`report` returns after admission. `maximumBytes` limits each projected line; `maximumQueuedBytes` counts exact UTF-8
bytes, including LF, across the active write and waiting lines. It excludes caller Events, temporary projection memory,
JavaScript string overhead and the sink's own buffers. Stats expose these charged bytes and records, dropped lines and
sink-error count. JSON redaction is the same as the direct reporter, before queue admission. Raw Events and live Errors
are not retained in this queue.

`drop-newest` discards incoming lines at capacity. `drop-oldest` evicts waiting lines in order, never the active write;
when the active write prevents admission, it discards the incoming line. A line larger than the total byte budget is
dropped without evicting other waiting lines. `reject` throws before retaining an excess line. For caller backpressure,
use the ordinary JSON reporter and await each `report`; the queue does not retain blocked producers or add an unlimited
wait list.

Writes run one at a time. `flush` joins writes until delivery becomes idle, then calls the optional borrowed destination
flush. Concurrent flush callers share one promise. New lines admitted while the destination flush is running wait for
that flush to finish and belong to a later flush. A continuing producer can delay flush; `close` seals admission first,
joins all admitted writes and flushes them. Repeated close preserves the same outcome. Disposal calls close and leaves
the borrowed destination open.

Sink failures do not stop later writes. The queue retains one first failure and an error count; flush and close reject
with that original value after attempting remaining delivery and destination flush. Observation does not settle
application work. A stalled writer can stall joined shutdown: this API cannot cancel a borrowed write or prove remote
receipt. Do not call queue flush/close from inside its write or destination-flush callback. The Node/OTel collection
keeps its existing exporter queue; this JSON owner is selected explicitly and installs no global configuration.

## Measure delivery and retention limits

The focused benchmarks measure 1–10,000 unique keys, bounded history and queued JSON writes. The benchmark compares
against direct noop reporting or direct writes. Queue and retention policies add guarantees. Count caps do not establish
an exact heap-byte bound.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
deno task --cwd=packages/telemetry test
deno task --cwd=packages/telemetry bench:check
deno task --cwd=packages/telemetry bench
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.

## Read further

The [Telemetry guide](https://github.com/okikio/utils/blob/main/docs/telemetry/01-guide.md) explains the model, manual
alternatives, and composition.

The [observability design](https://github.com/okikio/utils/blob/main/docs/telemetry/03-design.md) explains current event
reporting, tracing, metrics, and profiling limits.
