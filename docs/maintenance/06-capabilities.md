# Choose the scenario before claiming reliability

A complete example teaches a utility's mental model. A boundary test checks what happens at a limit. A benchmark
compares costs under a defined workload. A deployment exercise checks the real host and its failure modes. Keep these
claims separate: a readable example and a fast local result cannot establish recovery after a process or database fails.

Use this page when adopting a package or maintaining its tests. Start with the README linked in its row, run
its complete task, then inspect the named tests. Every package has a role below, including focused subpaths that can be
missed when browsing only root exports. The table identifies representative boundaries and remaining checks;
it does not certify every package as stress-tested.

## Run the local contract before collecting timings

From the checkout, review `mise.toml`, run `mise trust`, `mise install`, and `mise run prepare -- --kind deps`. For the HTTP
workflows, the local checks are:

```sh
mise run test -- --suite docs
mise run test -- --runtime deno packages/http packages/server
deno task --cwd=packages/http bench:check
deno task --cwd=packages/server bench:check
```

The documentation gate compiles and runs marked programs through public workspace imports. Browser and database support
programs need their separate hosts; type-checking one does not mean that host ran. Package tests and benchmarks stay
inside each package. Larger integration, process-restart and end-to-end scenarios belong in root `tests/` and `bench/`.
The [testing guide](./01-testing.md) explains selection and resource ownership.

For timings, use a native operation when it answers the same question, or an independent implementation with a matching
contract. Name any reduced guarantees: a plain Map does not supply a lease, a raw iterator does not validate JSON, and a
router callback does not include network delivery. Check output equivalence before timing. Sweep input size, concurrency,
slow-consumer delay and failure position; report where a limit refuses work or latency/memory stops meeting your target.
Follow the [benchmark protocol](../benchmarks/01-running.md), retain raw receipts and run timing cases sequentially on an
otherwise idle host. Untimed checks establish fixture correctness, not a new speed result.

## Keep values and owned lifetimes predictable

| Package and starting task | Inspect a boundary case | Existing coverage and remaining deployment checks |
| --- | --- | --- |
| [context](../../packages/context/README.md): Save import progress across owners and revisions. | [persistent.test.ts](../../packages/context/persistent.test.ts), [migration.test.ts](../../packages/context/migration.test.ts) | Memory recovery is not process recovery. Custom I/O can delay cleanup; test the real persistence adapter. |
| [dispose](../../packages/dispose/README.md): Close acquired resources after both work and cleanup fail. | [run.test.ts](../../packages/dispose/run.test.ts), [once.test.ts](../../packages/dispose/once.test.ts) | Timeout stops waiting; it cannot stop an arbitrary disposer. Recording callbacks are not a real file/database failure test. |
| [duration](../../packages/duration/README.md): Express exact budgets and calendar retention. | [arithmetic.test.ts](../../packages/duration/arithmetic.test.ts) | Nanosecond representation does not imply nanosecond timers. Calendar results need a reference date and host timezone data. |
| [env](../../packages/env/README.md): Reject bad startup configuration without leaking values. | [resolve.test.ts](../../packages/env/resolve.test.ts), [diagnostics.test.ts](../../packages/env/diagnostics.test.ts) | Unknown-key detection needs a complete source inventory. Foreign validators and secret logging remain caller-owned. |
| [hash](../../packages/hash/README.md): Stream a bounded content receipt or authenticate bytes. | [stream.test.ts](../../packages/hash/stream.test.ts), [hmac.test.ts](../../packages/hash/hmac.test.ts), [SHA-2 boundaries](../../packages/hash/capabilities.test.ts) | Whole-input SHA-2 costs input-sized memory. Compact IDs need a collision policy; vectors do not test hostile-input resource use. |
| [collection](../../packages/collection/README.md): Patch structured settings and bound unique-row scans. | [change.test.ts](../../packages/collection/record/change.test.ts), [iterable.test.ts](../../packages/collection/iterable.test.ts) | Finite seeded properties do not prove all inputs. Bound both scanned rows and retained keys. |
| [result](../../packages/result/README.md): Stop an import on its first expected failure. | [aggregate.test.ts](../../packages/result/aggregate.test.ts), [async.test.ts](../../packages/result/async.test.ts) | Payloads remain borrowed. Async conversion does not supply cancellation, concurrency or persistence. |
| [schema](../../packages/schema/README.md): Validate recursive data and round-trip stored timestamps. | [recursion.test.ts](../../packages/schema/recursion.test.ts), [capabilities.test.ts](../../packages/schema/capabilities.test.ts) | Traversal budgets do not interrupt foreign callbacks. JSON Schema cannot express every JavaScript ownership rule. |
| [capability](../../packages/capability/README.md): Authorize a save and accept keyed effect announcements. | [batch.test.ts](../../packages/capability/effect/meter/batch.test.ts), [lifetime.test.ts](../../packages/capability/resource/lifetime.test.ts) | A mutation and effect acceptance are separate. Durable handoff needs a transaction/outbox and recipient deduplication. |
| [utils](../../packages/utils/README.md): Reach focused tools through the suite facade. | [mod.test.ts](../../packages/utils/mod.test.ts) | Forwarding has no independent lifecycle. Warm function identity does not establish cold import or bundle cost. |

## Keep work bounded and recover it deliberately

| Package and starting task | Inspect a boundary case | Existing coverage and remaining deployment checks |
| --- | --- | --- |
| [activity](../../packages/activity/README.md): Run a checked job locally, in a Worker, subprocess or HTTP service; let remote work call its original authority. | [activity-providers.test.ts](../../tests/activity-providers.test.ts), [duplex.test.ts](../../packages/activity/http/duplex.test.ts), [durable HTTP control](../../tests/workflows/http-control.test.ts), [browser/container matrix](../../tests/workflows/duplex-browser.test.ts), [TLS/nginx matrix](../../tests/workflows/duplex-proxy.test.ts), [Worker/process stop faults](../../tests/activity-cleanup.test.ts) | Finite provider checks do not establish saturation or durable replay. HTTP sessions are temporary; lost results need authoritative reconciliation. The matrix fails unavailable engines explicitly. Native Node trust and nginx termination have real-host checks. Browser CA installation, encrypted upstreams, mTLS and production replica routing still need deployment checks. |
| [pool](../../packages/pool/README.md): Share sessions, retire unsafe ones and join drain. | [pressure.test.ts](../../packages/pool/pressure.test.ts), [reuse.test.ts](../../packages/pool/reuse.test.ts) | Local borrower pressure is not production capacity. The adapter must reset actual transaction/session state. |
| [scheduler](../../packages/scheduler/README.md): Bound slow ordered work and fence stale queue completion. | [map.test.ts](../../packages/scheduler/concurrency/map.test.ts), [admission.test.ts](../../packages/scheduler/capacity/admission.test.ts) | Slot limits do not count payload bytes. Uncooperative work can delay cancellation; memory queues lose state on exit. |
| [storage](../../packages/storage/README.md): Persist admitted notes and guarded SQL receipts. | [mod.test.ts](../../packages/storage/state/mod.test.ts), [web.test.ts](../../packages/storage/state/web.test.ts) | SQL note, saved-progress and Counter examples ran against PostgreSQL 18.3; real integration tests passed. The [physical failover drill](./07-recovery.md) adds synchronous promotion with same-process recovery on Postgres.js 4.0.0. The [continuous-write and COMMIT-reply drills](./07-recovery.md#keep-writes-running-while-the-primary-is-unavailable) add finite 2/8-producer pressure and receipt reconciliation; the separate [lease and two-hour soak drills](./07-recovery.md#keep-permission-alive-during-a-long-database-run) check renewable permission and longer store lifetimes. |
| [workflow](../../packages/workflow/README.md): Recover completed steps, progress and continued runs. | [serve.test.ts](../../packages/workflow/serve.test.ts), [dispatch.test.ts](../../packages/workflow/dispatch.test.ts) | PostgreSQL process-kill recovery and SQL assemblies ran against PostgreSQL 18.3. The [promotion drill](./07-recovery.md) checks saved receipts and pending work. Arbitrary external writes are not exactly once; automatic fleet failover remains untested. |
| [worker](../../packages/worker/README.md): Replace a lost Worker generation and decide whether to resubmit. | [supervisor.test.ts](../../packages/worker/supervisor.test.ts), [mod.test.ts](../../packages/worker/thread/mod.test.ts) | One controlled replacement is finite evidence. Native queue memory, CPU speedup and uncertain writes need separate test. |
| [task](../../packages/task/README.md): Control bounded imports and observe their latest progress. | [group.test.ts](../../packages/task/group.test.ts), [combine.test.ts](../../packages/task/combine.test.ts) | Control is cooperative and process-local. Progress is a snapshot; it is not the terminal-result authority or an event log. |

## Carry requests, user input and observations across hosts

| Package and starting task | Inspect a boundary case | Existing coverage and remaining deployment checks |
| --- | --- | --- |
| [authz](../../packages/authz/README.md): Check a gallery batch and explain denials within bounds. | [mod.test.ts](../../packages/authz/permission/mod.test.ts), [explain.test.ts](../../packages/authz/permission/explain.test.ts) | One logical batch does not establish remote-provider consistency or latency. Test the real policy engine and failure policy. |
| [format](../../packages/format/README.md): Stream contact rows into an awaited bounded sink. | [cancellation.test.ts](../../packages/format/csv/cancellation.test.ts), [inspect.test.ts](../../packages/format/sitemap/inspect.test.ts) | Parser/sink checks do not make an import atomic. Partial writes, rollback and aggregate concurrent memory need an application owner. |
| [hono](../../packages/hono/README.md): Mount a checked health service in familiar Hono routes. | [mod.ts](../../packages/hono/mod.ts) | The adapter does not own listeners or all Hono middleware combinations. Test the deployed host and response cleanup. |
| [http](../../packages/http/README.md): Admit forms/webhooks and stream bounded records/events. | [replay.test.ts](../../packages/http/webhook/replay.test.ts), [events.test.ts](../../packages/http/events.test.ts) | Forms buffer a complete bounded body. PostgreSQL/TCP greeting replay survived actual host death; finite reader-pressure and configured nginx checks are described in the [fault drills](./07-recovery.md). Application retention, production concurrency, ingress and TLS still need deployment checks. |
| [input](../../packages/input/README.md): Preview a real file and edit a native form control. | [expansion.test.ts](../../packages/input/expansion.test.ts), [ownership.test.ts](../../packages/input/ownership.test.ts) | Browser examples were exercised; physical devices, permission prompts and cross-browser behavior still need target-host checks. |
| [query](../../packages/query/README.md): Bind a continuation to its authorized scope and page PostgreSQL rows through unique-target joins. | [cursor.test.ts](../../packages/query/cursor.test.ts), [postgres.test.ts](../../packages/query/postgres.test.ts), [real SQL ordering](../../tests/workflows/query-postgres.test.ts) | Enforce target uniqueness and a final immutable non-null unique sort key in the database. A valid token is not authorization; nullable composite predicates still need representative query-plan checks. |
| [runtime](../../packages/runtime/README.md): Launch a permission-scoped child and own native resources. | [file-policy.test.ts](../../packages/runtime/deno/file-policy.test.ts), [port.test.ts](../../packages/runtime/deno/port.test.ts) | Capability inspection does not acquire permission. Test deployment OS behavior, process death and filesystem durability. |
| [streams](../../packages/streams/README.md): Read split UTF-8 JSON Lines, await batches and stop early. | [framing.test.ts](../../packages/streams/framing.test.ts), [cancellation.test.ts](../../packages/streams/cancellation.test.ts) | Bounds do not include every provider allocation. Cancellation is cooperative; test slow and stalled actual upstreams. |
| [telemetry](../../packages/telemetry/README.md): Observe an import with bounded retained history and export. | [bounds.test.ts](../../packages/telemetry/bounds.test.ts), [queue.test.ts](../../packages/telemetry/queue.test.ts) | Observations are not billing or completion authority. Collector/backend outages, concurrent load and retention need deployment tests. |
| [server](../../packages/server/README.md): Validate notes, observe readiness and host a real MCP tool. | [runtime.test.ts](../../packages/server/service/runtime.test.ts), [mod.test.ts](../../packages/server/http/mod.test.ts) | The [MCP example](../../examples/mcp/README.md) checks a real client/server conversation on Deno, Node and Bun as well as a direct Fetch call. External AI clients and sustained deployment load need their own tests. The [fault drills](./07-recovery.md) add finite reader pressure and real nginx/gateway streaming. |

## Follow one HTTP request through the harder cases

The [POST/form/webhook workflow](../server/09-http-input.md) keeps the greeting result while checking malformed input,
byte overflow, repeated fields, File rejection, signature tampering and duplicate admission. Its liveness and readiness
checks are separate, and readiness does not automatically reject traffic on other routes.

The [streaming workflow](../server/10-http-streaming.md) then reads to completion, cancels early, joins cleanup and
resumes from a feed-scoped cursor. It rejects expired, future and foreign cursors before creating the body. Existing SSE
unit tests vary UTF-8 and CR/LF splits, bound raw events and expose stalled cancellation separately. JSONL tests exercise
bodyless responses, pre-pull cancellation, late cleanup failures and invalid JSON values. The separate PostgreSQL/TCP integration adds a durable greeting log, real host SIGKILL, fresh-process replay,
live-tail append, output refusal and cursor rejection. It checks bounded batches and cleanup. Separate [fault drills](./07-recovery.md) add sampled process memory, finite reader pressure, nginx buffering and physical PostgreSQL promotion; none establishes production capacity. The finite documentation log itself remains in-memory.

The [MCP workflow](../server/11-mcp.md) uses pinned server/client SDK packages for actual discovery, a successful tool
call, schema rejection and host/origin rejection. It does not infer MCP sessions or transport replay from generic SSE
support. A deployed AI workflow needs its own protocol/client version, authentication, tool authorization, body/connection
admission, upstream cancellation and durable-job policy.

Before promising a production streaming service, test the actual proxy and host with slow readers, readers that vanish,
oversized chunks, failures after headers, unavailable upstreams and shutdown during pending work. For durable replay,
kill the owner between append, delivery and client acknowledgement. Measure retained bytes and active connections while
checking that recovery neither skips events nor grows queues without a bound. Record the exact workload and limits;
do not translate one passing loopback test into a production capacity claim.

## Test durable work with its real storage

The SQL note, saved-progress and Counter assemblies were executed against a separate disposable PostgreSQL 18.3
database. Their observed outputs show one business write after duplicate admission, progress after reopening and a
Counter reaching its final value through continuation. Separately, the real PostgreSQL integration suite exercises
process death, rollback, receipt reuse, fencing, timer recovery, cancellation and readiness. Memory-store reconstruction
alone still demonstrates only retained object state. Use the [operations guide](../workflows/16-operations.md) for isolated databases,
real worker interruption, continuation and the bounded pressure suite. Never point those fixtures at application data.

For local browser behavior, keep the actual form, file and teardown checks separate from device claims. Permission
prompts, clipboard policy, directories, gamepads and cross-browser differences require a target-browser/device matrix.
For telemetry, local collector delivery and joined shutdown do not establish remote retention, billing authority or
behavior during backend outages.

## Preserve the evidence and refresh its meaning

The [streaming/proxy/failover drills](./07-recovery.md) retain unique runs under `.tmp/tests/recovery/`. The initial in-process failover failure and follow-up verification remain under the preserved initial failover run; the 4.0.0 upgrade and same-process recovery evidence are under `.tmp/artifacts/postgres-inprocess-20261105/`. The original failure remains preserved.

The source-readability and real-database follow-up lives under `.tmp/artifacts/source-readability-20261104/`, including
per-function review ledgers, before copies, failing/passing regression logs, PostgreSQL test output and the three
executed SQL example outputs. These records supplement the earlier pass; they do not rewrite its results.

Local records for the earlier documentation pass live under `.tmp/artifacts/docs-repairs-20261104/`: `completion-*.json` records per-page repairs,
`stress-*.json` records exact source/test cases and gaps, and `capabilities.json` combines the 27 package owners. They are
local evidence, not dependencies required by a fresh checkout. Native test receipts live under `.tmp/tests/native/`.
The earlier audit and byte-for-byte before copies remain available; the [artifact guide](./05-artifacts.md) explains
which outputs are local history and which fixtures belong in source control.

When an API or test changes, update its README scenario, this package row and the claimed proof together. Preserve old
receipts with their source checkpoint. A new passing run can supersede an old conclusion; it cannot change what the old
run actually tested. Human readers should still try the task: compilation and an agent review do not prove comprehension.
