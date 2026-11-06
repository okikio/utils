> Research baseline, checked 2026-10-31. Statements about the supplied Utils source describe the checkpoint before this
> improvement package. See [the delivered capability status](./README.md) and [operations](../16-operations.md) for
> implemented changes and restrictions. Local research-workspace paths are provenance notes, not required runtime files.

# Inngest, Effect Workflow, and the uploaded Utils runtime

**Research date: 2026-10-31.** This is a source and contract comparison for improving the supplied Utilities workspace.
It is not a recommendation to replace its execution engine, a claim of feature parity, or a production reliability
benchmark.

## Findings that should drive the work

The uploaded Utils already has a substantial durable runtime: PostgreSQL admission, saved instructions, replay
compatibility checks, leased and fenced work, durable waits, child workflows, bounded execution providers, cancellation,
cleanup, and transactional receipts. The useful next work is to make those guarantees inspectable, close specific
lifecycle gaps, and test the real recovery paths. Reimplementing durable steps or adding a competing queue would
duplicate existing owners. [U1–U5]

Inngest is a useful reference for the service around execution: trigger routing, admission controls, run inspection,
recovery actions, deployment visibility, and explicit limits. Effect is a useful reference for composable typed
execution, durable suspension, child linkage, scoped resources, and distributed storage contracts. Neither makes
arbitrary external side effects exactly once. Their implementations also contain important contracts that Utils should
expose clearly rather than conceal behind familiar feature names. [I1–I4, E1–E7]

The most immediately useful Utils improvement is a bounded operator read surface for run discovery, saved instructions,
attempts, waits, and progress. It should read the existing durable authority. The current `client.get`, `wait`, `watch`,
`cancel`, and `repair` already have separate roles; preserve that separation. [U2–U4]

## 1. Exact generations and evidence

| System                       | Selected released source                                                                                                                        | What this establishes                                                                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inngest TypeScript SDK       | `inngest@4.26.2`, released 2026-10-29; commit `204e05e1aed3340f9991e72b60680e8375678703`                                                        | Source for step tools, checkpointing, function configuration, Connect, parallel groups, and experimental deferred functions.                                                                                       |
| Inngest server               | `v1.49.0`, released 2026-10-23; commit `28cb5336b6b59238cdb4166695742e5bbfb5cbcb`                                                               | Selected stable open source server. `v1.50.0-beta.1` exists, but is not the baseline. Cloud documentation is a separate service contract and may differ from raw server defaults.                                  |
| Effect                       | `effect@4.1.1`, released 2026-10-30; commit `bc492f0965dc0f6a83cefd141071c5ead10f7efa`                                                          | Current released monorepo generation. APIs are under `effect/workflow`, `effect/cluster`, and `effect/persistence`. Workflow and Cluster APIs are explicitly marked **unstable**, despite the stable core release. |
| Historical Effect references | `Effect-TS/effect-smol` latest inspected release `4.0.0-beta.98`, 2026-07-13; local guide snapshot refers to Effect 3 / `@effect/workflow` 0.18 | Historical context only. Neither establishes the current API or readiness.                                                                                                                                         |
| Uploaded Utils               | `utils(3).zip`, SHA-256 `5776ccf0726deb02f6ab865e73248ba53d7a2b5e9657feaf90ff06d0bd2fd7b2`; 1,246 original files                                | Comparison baseline is the supplied WIP source at `work/utils-upload`, not an assumed published package or remote main. The separate recovery candidate is identified below.                                       |

Release API responses and tag resolution supplied the pins; manifests corroborate SDK/Effect versions. Official live
docs were checked alongside the pinned implementations. The selected source files are saved under
`evidence/workflow-comparison/`; `pins.json` records versions, and `ast-contract-trace.json` records imports, public
exports, selected calls, and source SHA-256s for 33 TypeScript files. The AST parser reported zero syntax diagnostics.
This is static evidence, not execution testing of either competitor. [V1–V4]

The Utils comparison also incorporates the separate real PostgreSQL checks in `work/utils-probes/AUDIT.md`: four
recovery regressions fail on the upload and pass on the isolated candidate, whose 27-case execution suite passes. A
process-kill experiment proves one SQL receipt publication window on both versions. Those results do not establish
browser recovery, network-partition safety, database failover, or sustained load. [U5]

## 2. Inngest: actual capability contracts

### Execution, suspension, and capacity

`step.run` stores completed results under stable step identity. A resumed handler rebuilds its local state using those
recorded outputs; code outside steps can execute again. TypeScript v4 enables checkpointing by default: ordinary
sequential steps continue within one handler, while retries and parallel work fall back to standard orchestration. A
durable wait also requires a later invocation. Older descriptions saying every step always means a separate HTTP request
are incomplete for this generation. [I1, I2, IS1]

Checkpointing defaults to one result per checkpoint. `bufferedSteps` can reduce checkpoint traffic, but results still in
a worker's buffer can be lost on an abrupt exit and their work repeated. `maxRuntime` bounds a continuously
checkpointing request and should fit inside the host's timeout; it does not replace operation-level deadlines. [I2, IS1]

Concurrency counts active code execution, including code outside steps. It does not count sleeping/waiting runs.
`sleep`, `sleepUntil`, `waitForEvent`, and an awaiting `invoke` release their execution slot; resumption must acquire
capacity again. The SDK's parallel requests can consume multiple slots. Function concurrency therefore does not
serialize entire business workflows that wait between steps. [I3]

Concurrency can use a CEL key and function, environment, or account scope, with at most two configured constraints.
Per-tenant limits do not themselves establish fair scheduling: the documented separate key-queue feature is
Enterprise/on request, and ordering is best effort. A shared scope/key with inconsistent ceilings is not one uniform
limit. [I3, I4]

| Control      | Exact purpose and tradeoff                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Throttle     | Limits run-start rate and queues excess work; backlog can grow.                                                                         |
| Rate limit   | Skips excess runs; it is a deliberately lossy admission choice.                                                                         |
| Debounce     | Replaces the pending triggering event and extends a quiet-period delay, with an optional maximum extension.                             |
| Batch events | Starts from count/timeout conditions, optionally partitioned by key, subject to plan and byte limits.                                   |
| Singleton    | Keeps one active run per key and either skips the newcomer or cancels the previous run. It differs from a one-step concurrency ceiling. |
| Priority     | Influences scheduling; it does not create capacity or strict total ordering.                                                            |

These are workflow configuration controls, not universal controls for every Inngest entrypoint. Current docs explicitly
exclude durable endpoints from several flow-control capabilities. Source exposes the options separately; a reliable
Utils design should do the same. [IS2, I3]

### Delivery, retries, time, and external effects

Events can trigger multiple matching functions. Cron triggers, timezone-tested schedules, and future event timestamps
cover recurring and delayed starts; durable sleeps cover delays after a run starts. DST and missed-run behavior need
explicit product decisions rather than a generic promise that cron runs at every local wall-clock instant. [I5, I6]

Event IDs and function idempotency expressions suppress duplicate execution for 24 hours. That is a bounded admission
dedupe window, not permanent business uniqueness. Debounce, batching, and function pausing have documented exceptions.
External calls still need stable provider keys, a transaction/outbox, or reconciliation when success can occur before a
step result is recorded. [I7]

Default retry behavior is four retries after the initial attempt, independently for failed steps; ordinary errors use
backoff and jitter. `NonRetriableError` stops retries, `RetryAfterError` controls timing, and exhausted errors can be
caught for fallback/compensation. `onFailure` or the failure system event can launch failure handling. The server's
`DefaultRetryCount = 4` corroborates the current docs; an SDK option comment saying default three is stale and should
not govern a comparison. [I8, IS2, IS3]

Start timeout limits queued time before the first attempt; finish timeout limits the run after it starts. Neither
forcibly terminates a step already executing, and capacity delays can delay observing a timeout. Cancellation events,
direct/bulk cancellation, and timeout cancellation stop continuation at execution contracts. Give each browser/API
operation its own deadline and cleanup owner. [I9]

`waitForEvent` combines an event name, timeout, and matching expression; multiple workflows may observe the same event.
Experimental `waitForSignal` targets a unique signal name and requires `onConflict: 'replace' | 'fail'`. Replacement
leaves the previous wait pending until its own timeout. Subsecond durable wait durations round up to one second in the
current SDK. Do not infer a general retained early-event inbox from the presence of event history; checks must
exercise delivery before wait registration. [IS4]

### Composition and lifecycle

`step.invoke` runs another named function and waits for its result; `step.sendEvent` can fan out to matching functions.
Invocation releases caller execution capacity while waiting. Child retry/output/timeout behavior and parent cancellation
must be treated as explicit contracts, not inferred from ordinary nested JavaScript calls. [I3, IS4]

`Promise.all`/`allSettled` model independent parallel steps. With default optimized parallelism, bare `Promise.race`
does not advance immediately when one branch settles; `group.parallel` selects early race behavior. **Losing steps are
not cancelled.** A losing event wait can keep the run running until its timeout. This is materially different from a
structured race that joins interrupted losers before returning. [I10, IS5]

Experimental `defer` is a typed independent follow-up function scheduled after the parent finalizes. It has its own
steps, retries, and controls; the parent does not wait for its result. Call-site validation is synchronous, invalid
calls are logged/skipped, and handles support aborting the registered follow-up. This is not the same contract as Utils
`defer`, which owns durable cleanup before a lifecycle obligation is considered complete. [I11, IS6]

The pinned internal `defer.md` contains stale TODOs: it says abort is future work, while the current engine emits
`DeferAbort`. It also identifies buffered-op delivery failure windows. Current code drains lazy operations before a
checkpoint request; do not cite the feature name as proof that every failure contract is already safe. This research did
not execute a failure reproduction for that beta path. [IS1, IS6]

Function pause is an operational action, not a process freeze. It prevents new runs; the dashboard can pause existing
runs after their current step or cancel them, with a default seven-day cancellation policy for paused existing work.
Events received while paused are stored but do not run automatically when the function resumes. Recovering that interval
requires an explicit replay, subject to retained history. [I12]

### State, observability, history, deployment

Cloud provides run/step attempts, logs/traces, worker connection visibility, single reruns, selected-step reruns, and
bulk replay. A rerun creates a new run using available code; a selected-step rerun reconstructs earlier outputs.
Operator replay is an explicit new execution decision and can repeat side effects. [I13, I14]

Realtime uses authorized channels/topics. `step.realtime.publish` memoizes a completed publication; immediate
`inngest.realtime.publish` can repeat. Subscribers receive messages published while they are connected. Durable
publishing does not turn that transport into persisted client catch-up history. An application still needs authoritative
saved state for reconnects. [I15, IS4]

Compatible code changes reuse matching step IDs; renamed/new IDs execute as new work. Completed outputs may have an old
shape even when current code changes. Major incompatible changes should use a new function ID and deliberate routing
while old runs drain. This is not automatic deployment-version pinning of every active run. [I16]

Serve exposes an HTTP endpoint on the application's infrastructure. Connect uses outbound persistent connections,
heartbeats, reconnection, graceful drain, and HTTP fallback for result flushing. `maxWorkerConcurrency` limits active
steps per `instanceId`; it is distinct from function/account constraints. Rolling deployment can send eligible work to
multiple connected versions, so compatibility still matters. Neither method automatically creates CPU threads or
provisions containers. [I17, I18, IS7]

Cloud and self-hosting have different operational ownership. Self-hosting defaults include embedded Redis state/queue
with periodic SQLite snapshots; external services and durable storage configuration need deliberate production
deployment. Operators own database/queue monitoring and cleanup. Current self-host docs say old PostgreSQL
events/runs/traces are not automatically deleted. [I19]

### Current limits: distinguish service promises from implementation defaults

| Scope                        | Observed limits/contracts                                                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud platform documentation | 1,000 steps/run; 4 MiB return/step; 32 MiB total run state; step runtime ceiling two hours, subject to a shorter host timeout; sleeps at most one year within plan run length; at most 5,000 events/send.  |
| Cloud plan examples          | Free/Pro/Business: 5/100/500 concurrent steps; 24h/7d/14d trace-log retention; 30/90/366-day run length; event size 256 KiB/3 MiB/3 MiB. These are dated service limits, not Utils design targets.         |
| Selected open source server  | Default step limit 1,000, absolute configurable ceiling 10,000; default state 32 MiB; four retries; maximum retry count 20; maximum sleep/wait 366 days.                                                   |
| Differences to retain        | Live docs list event names at 256 characters; selected server constant is 512. Raw default event size is 512 KiB, while Cloud Free is 256 KiB. Do not combine them into a single supposed universal limit. |

The documented execution-count correction effective 2026-10-20 also makes an old cost estimate unsafe: measurement must
use current billed executions plus event, storage, and worker costs. No monetary parity conclusion is supported by this
research. [I20, IS3]

## 3. Effect 4 Workflow: actual capability contracts

### Durable primitives and engine ownership

`Workflow.make` defines a stable tag, payload/success/error schemas, and an idempotency-key function. It derives
execution identity from workflow identity and that key. `toLayer` registers a handler. `execute`, `poll`, `interrupt`,
and `resume` use a `WorkflowEngine`; definitions alone create neither persistence nor workers.
`WorkflowEngine.layerMemory` is process-local. `ClusterWorkflowEngine.layer` uses sharding and message storage for
executions, activity results, deferred completions, resumes, interrupts, and clock wakeups. [E1, E2, E3]

An `Activity` stores a completed encoded success/failure under activity name and attempt. Replay reuses the result. A
body that suspends before completing can execute again, including effects it performed before suspension.
`Activity.idempotencyKey` derives a stable operation key, optionally including attempt; including attempt is
inappropriate when retries must represent the same external write. [E4]

`DurableDeferred` is a named, schema-encoded completion. Awaiting an unresolved value suspends the workflow; completing
it records an exit and wakes/replays the waiting execution. Tokens encode workflow name, execution ID, and deferred name
in base64url JSON. They are addresses, not authentication or authorization. Application endpoints must validate the
caller and intended transition. [E5]

`DurableClock.sleep` has a crucial default: durations **at or below 60 seconds execute as an in-memory Activity**.
Longer durations schedule an engine clock and await its deferred. Setting `inMemoryThreshold: 0` forces nonzero short
waits onto the durable clock path. The short path can restart its sleep after interruption and does not provide the same
compute-release behavior as a parked long wait. [E6]

### Concurrency, placement, and durable delivery

Effect fibers and combinators provide local concurrency and interruption. Cluster adds distributed entities, shard
ownership, persisted messages/replies, and runner health/locks. These are different resources. A semaphore or fiber
concurrency setting is not automatically a cross-process tenant limit. [E3, E8]

The selected cluster workflow engine releases idle completed/suspended entities after ten seconds, so they do not occupy
resident-entity slots for the default general entity idle period. Deferred wake handlers release their RPC concurrency
permit while waiting, but pending requests still consume mailbox capacity. A branch still doing work can keep a workflow
active even when a sibling is durably parked. This is a more precise contract than “every await releases all capacity.”
[E3, E5]

`DurableQueue.process` offers a schema-encoded payload with a stable ID and deferred token; a worker processes it and
completes that token. `makeWorker` provides an explicit concurrency count, default one. It composes with
`PersistedQueue` stores: memory, Redis, or SQL. Queue delivery is explicitly at least once; a successful side effect
followed by a lost acknowledgement can be delivered again. [E7, E9]

The current queue source has per-acquisition claim fencing and lock renewal. A lapsed claim may still settle until
another poll actually reclaims it; lease expiry and ownership revocation are not identical events. The Redis source
documents an incompatible older claim format: stop old workers and let locks expire before upgrading on the same prefix.
This is a concrete example of why rolling compatibility needs a deployment contract. [E9]

Workflow activity calls use the workflow's cluster entity/shard group. `ShardGroup` can route classes of work and
runners can advertise available/assigned groups. `DurableQueue` offers a separate worker handoff. Effect also has local
Worker/RPC modules, but Workflow does not automatically turn each activity into a dedicated OS thread, process, or
container. [E3, E8, E10]

### Retries, timeouts, interruption, and children

`Activity.retry` updates `CurrentAttempt` while applying Effect retry behavior; persisted results are addressed by
name/attempt. Interruption retry and persistence retry have separate owners. Typed domain failures, defects,
interruptions, and suspended results remain distinct. Ordinary `Effect.sleep`/retry timing is not automatically a
durable timer. For a long durable backoff or timeout, compose named durable clocks/deferred results and define which
recorded outcome wins. [E2–E6]

Normal `interrupt` records the workflow interrupt signal; it is not an OS kill. `interruptUnsafe` explicitly warns that
it may skip compensation or orphan children. `SuspendOnFailure` parks a failure for explicit operator resume; automatic
deferred/child wakes do not silently clear that failure suspension in the selected cluster engine. `resume` is not
“restart a completed run”; it resets a suspended execution conditionally against its recorded reply. [E1–E3]

Awaited child workflows, discarded children, and detached children have distinct linkage. A discarded child returns its
execution ID yet normally retains parent wake/interruption linkage. `discard: true, detached: true` removes that linkage
while retaining parent metadata for observability. The source explicitly warns against later awaiting a detached
execution because its completion will not wake that parent. [E1]

Parallel composition is available through Effect combinators. `Activity.raceAll` and `DurableDeferred.raceAll` record a
durable race result; source tests include successful winner replay, ignoring one failed contender while another can
succeed, and interruption of losing activities. Do not equate that with Inngest's non-cancelling race, or assume
interruption undoes already-completed external effects. [E4, E5, E11]

`Workflow.addFinalizer` observes the workflow terminal outcome; body-level finalizers do not necessarily observe a
deposited workflow interrupt. `withCompensation` supports compensation registered for top-level workflow effects, not
arbitrary nested activities. Owner abandonment skips durable finalizers while releasing owner-local resources so another
owner can replay. These semantics need explicit tests around crashes and handovers, not only graceful `dispose`. [E1,
E3]

### Schedules, state, operations, and retention

`ClusterCron` uses persisted entity messages plus singleton initial scheduling. With
`calculateNextRunFromPrevious: true`, missed runs catch up serially; failed work blocks later runs until successful or
stale enough to skip. The default computes next time from now; `skipIfOlderThan` defaults to one day. Utils needs an
equally explicit overlap/misfire policy if it adds recurring scheduling. [E12]

`poll` returns optional `Complete`/`Suspended` results, not a full searchable operations database. Execution/activity
spans and cluster metrics are implemented, but a managed workflow dashboard, customer progress feed, audit views,
admission policy service, and autoscaler do not follow from those primitives. Their design and hosting remain
application work. [E1–E3, E8]

There is no general workflow deployment-version field or continue-as-new operation in the inspected public Workflow
surface. Durable identity includes workflow/activity/deferred names and persisted schema expectations. Keeping
compatible handlers available, choosing new identity for incompatible changes, migrating persisted data, and bounding
long histories remain deployment design work. [E1, E2]

Queue retention is implemented separately: opt-in `PersistedQueue.layerCleanup` defaults to retaining completed entries
for 30 days and retaining failures indefinitely unless configured otherwise. Deleting a completed queue entry also ends
its dedupe protection. This is not a general Workflow history-retention service. SQL message storage exposes clear/reset
operations and dedicated migration layers; `makeEncodedStorage` avoids runtime DDL but requires pre-applied migrations.
[E9, E13]

Selected cluster defaults include 10,000 resident entities, mailbox capacity 4,096, storage read batch 1,024, shard
refresh ten seconds, shard expiry 35 seconds, and 300 shards/group. These are tunable implementation defaults, not
certified throughput, latency, or cost limits. [E8]

`ClusterSchema.WithTransaction` can put supported SQL handler writes and a successful persisted reply in the same
storage transaction. Failure replies are persisted after rollback. Streaming chunks and deferred replies have different
contracts, and unsupported storage implementations do not gain transactions from the annotation. An
HTTP/browser/object-store write still needs idempotency/reconciliation. [E10, E14]

## 4. Concrete comparison to the uploaded Utils

| Capability               | Verified upload contract                                                                                                                           | Gap or decision for improvement                                                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable acceptance       | Scoped dedupe key, validated input, saved policy; `client.in(tx)` can share supported native transactions.                                         | Preserve conflicting-content rejection. Expose acceptance policy/identity in inspection; do not reduce it to a transient enqueue.                                                                                                               |
| Replay                   | Instructions carry saved identity/fingerprints; incompatible replay blocks.                                                                        | Add operator explanation of mismatch and code/definition identity; test mixed-version deployments.                                                                                                                                           |
| Crash recovery           | Run/job locks, host generation, claim renewal and fencing, saved attempt outcomes.                                                                 | Keep the two reproduced recovery-eligibility fixes; stress many retained terminal/blocked owners and multiple claimants.                                                                                                                        |
| Wait capacity            | PostgreSQL `park` releases activation count; timer/event state survives worker loss.                                                               | Verify capacity with real hosts under thousands of parked runs, simultaneous wakeups, and cancellation. Do not label this missing.                                                                                                              |
| Local pause              | Shared cooperative `Pause` gate stops at checkpoints; in-flight indivisible work continues and its slot stays owned.                               | Durable pause/resume is a separate missing command/state/policy. Decide after-active-work vs cancel, races, deadlines, drain, and admission behavior.                                                                                           |
| Durable events           | Run/event/key address, retained early delivery, schema validation, identical duplicate acceptance, changed duplicate conflict, DB-clock deadlines. | This is a single logical wait delivery, not broadcast subscriptions or an event broker. Add authenticated transport separately; `client.send` currently commits its own transaction.                                                            |
| Timers/schedules         | Saved relative and absolute sleeps; recovery scan handles due deadlines.                                                                           | Cron calendars, timezone/misfire/overlap/backfill policy are not established. Add only if needed by consumers.                                                                                                                                  |
| Retry/failure            | Saved per-definition attempt/deadline/recovery policies; typed transient/permanent dispositions; repair grants bounded extra attempts.             | Expose why work retried, blocked, or exhausted. Test ambiguous effects and shutdown races independently of ordinary retry.                                                                                                                      |
| Children/fan-out         | Saved child results, discard/independent cancellation modes, bounded parallel/map/race/retry, child admission budgets.                             | Document parent/child completion obligations and testing fan-out capacity; compare actual loser cleanup rather than promising generic race parity.                                                                                           |
| Cleanup                  | Durable `defer`, policy requirement and reserved finalizer/control capacity.                                                                       | Prove cancellation plus cleanup exhaustion, orphan recovery, and no success before required cleanup. Inngest's similarly named background defer is not a substitute.                                                                            |
| Continue-as-new          | Public instruction exists in local model. Durable `serve::plan` has no continue intent and rejects it.                                             | Implement atomic generation handoff plus queryable lineage, compatible definition/input, dedupe/cancellation rules and history budgets, or clearly reject it at readiness. This is a concrete missing durable path.                             |
| SQL side effects         | Claim-bound transactions and receipts; process-crash receipt test passes in the tested commit window.                                              | Keep remote browser/API writes outside the claim of SQL atomicity. Require stable artifact IDs and reconciliation.                                                                                                                              |
| Thread/process placement | Explicit engines and affinity, required/preferred/allowed choices, thread and process providers, bounded pools.                                    | Remote policies requiring local PostgreSQL transaction/receipt capabilities are rejected. Claims cannot simply cross process/thread contracts. No container provisioner/autoscaler is established.                                              |
| Admission and fairness   | Root/child/successor/finalizer budgets and host capacities already exist.                                                                          | Per-tenant global active-work constraints, throttling, priority and fair scanning need a deliberate durable policy owner. Do not add lossy rate limits implicitly.                                                                              |
| Progress                 | One saved latest report per job/effect, fenced by claim/generation; monotonic within the reporting generation. `watch` polls revisions.            | Preserve snapshot semantics. Maximum 1,000 reports/subtree; fast intermediate reports may be skipped. Retries can reset counts. No durable event replay is implied.                                                                             |
| Inspection/history       | `get` reads one known reference; `wait` returns terminal value/error; `repair` exists.                                                             | Missing bounded public run discovery and instruction/attempt/wait/history queries. Add these first; avoid requiring operators to know SQL or reconstruct a run from logs.                                                                       |
| Lifecycle observation    | Saved states distinguish completed/failed/cancelled/blocked; progress watch terminates on those states.                                            | Progress watch is not a lifecycle snapshot stream. A future lifecycle watch should start from a saved snapshot and support explicit cursors/versions if it promises replay.                                                                     |
| Telemetry                | OTel + LogTape, W3C traceparent handoff, workflow submit/advance/attempt spans, operation duration/count/active and event metrics.                 | Add queue depth/oldest eligible age, parked/active counts, host/provider capacity, lease loss, retry debt, recovery delay and cleanup backlog. Do not replace existing telemetry.                                                               |
| Retention                | Dedupe/result/audit minimum preservation durations are saved in policy.                                                                            | No automatic run deletion service or terminal `finished_at` yet. Define cleanup eligibility, unfinished descendants, receipts, dedupe tombstones, and audit preservation before deleting anything.                                              |
| Migration/deployment     | Readiness checks, explicit PostgreSQL migrations, worker registration/health/shutdown contracts.                                                   | Migration repeatedly executes DDL despite advisory locking. A concurrent checks reproduced migration/active-worker deadlock. Separate deployment migration authority and test upgrades; namespaces do not isolate shared schema changes. |

Sources for the table are the original upload's
`workflow/{client,serve,execution,types,pause,engines,affinity,events,replay}.ts`, `postgres/workflow/postgresjs.ts`,
workflow guides, and the separately recorded runtime audit. Statements about absence refer to these public surfaces and
adapter paths, not every possible application someone could build around them. [U1–U5]

## 5. Recommended implementation sequence and acceptance gates

### First: make existing authority inspectable

Add bounded read capabilities to the owning execution/store interfaces and PostgreSQL adapter, then expose them through
the client. Keep inspection separate from mutating `cancel`/`repair`. Prefer the minimum coherent surface: find runs
within an authorized scope; inspect a known run's instruction history, job attempts, waits, progress and parent/child
lineage; return explicit pagination/truncation. Reuse existing schemas for saved data and add new schemas only for newly
serialized query/result contracts. [U2–U4]

The read contract should answer: what was accepted; which definition/policy applies; what is ready, active, waiting or
blocked; which attempt owns permission; when the next deadline/retry is due; which outcomes were recorded; what cleanup
is outstanding; and which operator action is permitted. Include stable identities and persisted ordering, not just
formatted messages. Treat progress as observation, not proof of completed business work.

Required tests should cover namespace/scope isolation, keyset pagination with concurrent inserts, invalid/cross-scope
cursors, bounded page sizes, parallel branches, failed/abandoned/repaired attempts, unresolved/timed-out/received waits,
retries resetting progress, terminal runs and empty results. Do not return database-native dates, bigints, or
implementation rows accidentally. A read should not acquire execution claims, create resources, or advance recovery.
Prove that with public client calls against PostgreSQL, and retain source-matched portable tests for data validation.

### Then: close lifecycle gaps in small owned changes

| Work package                | Required behavior and proof                                                                                                                                                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable pause/resume        | Persist requested/settled pause separately; define whether new admission is paused; release execution capacity after park; preserve pending timers/events; fence late completion. Test active work, parked wait, expiry, event delivery, repair, cancellation, restart and resume races.  |
| Continue-as-new             | One atomic transition commits the current generation and successor identity/input; no orphan successor or double successor. Follow the logical run for observation/cancel while preserving each generation's audit. Kill before/after commit and prove one successor and bounded history. |
| Durable scheduling/fairness | Select eligible work before bounded scan limits; enforce stable tenant/domain constraints across hosts; keep control/finalizer progress under saturation. Test hot-tenant backlogs, due-wait storms, retries and old retained rows.                                                       |
| Retention/compaction        | Terminal timestamp, explicitly eligible history deletion, preserved required receipts/dedupe/lineage. Verify unfinished children/finalizers and operator audit cannot be removed; replay/dedupe behavior after expiry must be documented.                                                 |
| Deployment contracts        | Pre-applied migrations; compatible mixed workers or an explicit stop/drain upgrade; recorded definition versions; lost DB connection/host takeover drills. Include the real thread/process path and bounded force termination.                                                            |

These are separate work packages, not a mandate to add all competitor controls immediately. The next ZIP should identify
what is implemented, what passed, and what remains rejected/unsupported. It should preserve the upload provenance and
include a focused changelog and reproducible commands. No competitor performance or availability claim is justified
until workload-level results measure correctness, recovery delay, memory, throughput, external duplicate behavior and
cost.

## Source register

### Versions

- **V1:** [Inngest SDK release 4.26.2](https://github.com/inngest/inngest-js/releases/tag/inngest%404.26.2);
  [pinned manifest](https://github.com/inngest/inngest-js/blob/204e05e1aed3340f9991e72b60680e8375678703/packages/inngest/package.json).
- **V2:** [Inngest server release 1.49.0](https://github.com/inngest/inngest/releases/tag/v1.49.0).
- **V3:** [Effect release 4.1.1](https://github.com/Effect-TS/effect/releases/tag/effect%404.1.1);
  [pinned manifest](https://github.com/Effect-TS/effect/blob/bc492f0965dc0f6a83cefd141071c5ead10f7efa/packages/capability/effect/package.json);
  [current API with unstable designation](https://effect.website/docs/v4/api/effect/workflow/WorkflowEngine).
- **V4:** [Historical effect-smol beta](https://github.com/Effect-TS/effect-smol/releases/tag/effect%404.0.0-beta.98);
  [official v4 migration](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md).

### Inngest official documentation

- **I1:** [Durable workflows](https://www.inngest.com/docs/durable-execution/durable-workflows).
- **I2:** [Checkpointing](https://www.inngest.com/docs/durable-execution/guides-and-advanced/checkpointing).
- **I3:** [Step concurrency](https://www.inngest.com/docs/durable-execution/flow-control/concurrency).
- **I4:** [Multi-tenancy](https://www.inngest.com/docs/durable-execution/flow-control/multi-tenancy).
- **I5:** [Events and triggers](https://www.inngest.com/docs/durable-execution/guides-and-advanced/events-and-triggers).
- **I6:**
  [Schedules and delayed starts](https://www.inngest.com/docs/durable-execution/guides-and-advanced/events-and-triggers/schedules-and-delayed-starts).
- **I7:** [Idempotency](https://www.inngest.com/docs/durable-execution/guides-and-advanced/idempotency).
- **I8:** [Error handling](https://www.inngest.com/docs/durable-execution/guides-and-advanced/error-handling);
  [retry timing](https://www.inngest.com/docs/durable-execution/guides-and-advanced/error-handling/retries).
- **I9:**
  [Timeouts and cancellation contracts](https://www.inngest.com/docs/durable-execution/guides-and-advanced/cancellation/timeouts).
- **I10:** [Parallel steps and races](https://www.inngest.com/docs/durable-execution/primitives/group-parallel).
- **I11:** [Deferred background functions](https://www.inngest.com/docs/durable-execution/primitives/defer).
- **I12:**
  [Pause and resume functions](https://www.inngest.com/docs/platform-and-operations/pause-and-resume-functions).
- **I13:** [Manage and recover](https://www.inngest.com/docs/platform-and-operations/manage-and-recover).
- **I14:** [Rerun a run](https://www.inngest.com/docs/platform-and-operations/rerun-a-run);
  [bulk replay](https://www.inngest.com/docs/platform/replay).
- **I15:** [Realtime delivery semantics](https://www.inngest.com/docs/realtime/overview).
- **I16:** [Versioning](https://www.inngest.com/docs/durable-execution/guides-and-advanced/versioning).
- **I17:** [Connect](https://www.inngest.com/docs/durable-execution/deploying-functions/connect).
- **I18:** [Deploying functions](https://www.inngest.com/docs/durable-execution/deploying-functions).
- **I19:** [Self-hosting](https://www.inngest.com/docs/self-hosting).
- **I20:** [Dated Cloud and platform limits](https://www.inngest.com/docs/durable-execution/limits).

### Inngest pinned source

- **IS1:**
  [Execution engine](https://github.com/inngest/inngest-js/blob/204e05e1aed3340f9991e72b60680e8375678703/packages/inngest/src/components/execution/engine.ts).
- **IS2:**
  [Function options and checkpoint selection](https://github.com/inngest/inngest-js/blob/204e05e1aed3340f9991e72b60680e8375678703/packages/inngest/src/components/InngestFunction.ts).
- **IS3:**
  [Server constants](https://github.com/inngest/inngest/blob/28cb5336b6b59238cdb4166695742e5bbfb5cbcb/pkg/consts/consts.go).
- **IS4:**
  [Step tools, signals, invocation, realtime](https://github.com/inngest/inngest-js/blob/204e05e1aed3340f9991e72b60680e8375678703/packages/inngest/src/components/InngestStepTools.ts).
- **IS5:**
  [Group tools](https://github.com/inngest/inngest-js/blob/204e05e1aed3340f9991e72b60680e8375678703/packages/inngest/src/components/InngestGroupTools.ts).
- **IS6:**
  [Deferred function](https://github.com/inngest/inngest-js/blob/204e05e1aed3340f9991e72b60680e8375678703/packages/inngest/src/components/DeferredFunction.ts);
  [internal design note, partly stale](https://github.com/inngest/inngest-js/blob/204e05e1aed3340f9991e72b60680e8375678703/packages/inngest/src/components/execution/defer.md);
  [server finalization](https://github.com/inngest/inngest/blob/28cb5336b6b59238cdb4166695742e5bbfb5cbcb/pkg/execution/executor/finalize.go).
- **IS7:**
  [Connect implementation](https://github.com/inngest/inngest-js/blob/204e05e1aed3340f9991e72b60680e8375678703/packages/inngest/src/components/connect/index.ts);
  [Connect contracts](https://github.com/inngest/inngest-js/blob/204e05e1aed3340f9991e72b60680e8375678703/packages/inngest/src/components/connect/types.ts).

### Effect pinned source and official explanation

All E1–E13 source links use released commit `bc492f0965dc0f6a83cefd141071c5ead10f7efa`.

- **E1:**
  [Workflow](https://github.com/Effect-TS/effect/blob/bc492f0965dc0f6a83cefd141071c5ead10f7efa/packages/capability/effect/src/workflow/Workflow.ts).
- **E2:**
  [WorkflowEngine](https://github.com/Effect-TS/effect/blob/bc492f0965dc0f6a83cefd141071c5ead10f7efa/packages/capability/effect/src/workflow/WorkflowEngine.ts).
- **E3:**
  [ClusterWorkflowEngine](https://github.com/Effect-TS/effect/blob/bc492f0965dc0f6a83cefd141071c5ead10f7efa/packages/capability/effect/src/cluster/ClusterWorkflowEngine.ts).
- **E4:**
  [Activity](https://github.com/Effect-TS/effect/blob/bc492f0965dc0f6a83cefd141071c5ead10f7efa/packages/capability/effect/src/workflow/Activity.ts).
- **E5:**
  [DurableDeferred](https://github.com/Effect-TS/effect/blob/bc492f0965dc0f6a83cefd141071c5ead10f7efa/packages/capability/effect/src/workflow/DurableDeferred.ts).
- **E6:**
  [DurableClock](https://github.com/Effect-TS/effect/blob/bc492f0965dc0f6a83cefd141071c5ead10f7efa/packages/capability/effect/src/workflow/DurableClock.ts).
- **E7:**
  [DurableQueue](https://github.com/Effect-TS/effect/blob/bc492f0965dc0f6a83cefd141071c5ead10f7efa/packages/capability/effect/src/workflow/DurableQueue.ts).
- **E8:**
  [ShardingConfig](https://github.com/Effect-TS/effect/blob/bc492f0965dc0f6a83cefd141071c5ead10f7efa/packages/capability/effect/src/cluster/ShardingConfig.ts).
- **E9:**
  [PersistedQueue](https://github.com/Effect-TS/effect/blob/bc492f0965dc0f6a83cefd141071c5ead10f7efa/packages/capability/effect/src/persistence/PersistedQueue.ts).
- **E10:**
  [ClusterSchema transaction and routing annotations](https://github.com/Effect-TS/effect/blob/bc492f0965dc0f6a83cefd141071c5ead10f7efa/packages/capability/effect/src/cluster/ClusterSchema.ts).
- **E11:**
  [Cluster workflow regression tests, inspected but not run here](https://github.com/Effect-TS/effect/blob/bc492f0965dc0f6a83cefd141071c5ead10f7efa/packages/capability/effect/test/cluster/ClusterWorkflowEngine.test.ts).
- **E12:**
  [ClusterCron](https://github.com/Effect-TS/effect/blob/bc492f0965dc0f6a83cefd141071c5ead10f7efa/packages/capability/effect/src/cluster/ClusterCron.ts).
- **E13:**
  [SQL message storage/migrations](https://github.com/Effect-TS/effect/blob/bc492f0965dc0f6a83cefd141071c5ead10f7efa/packages/capability/effect/src/cluster/SqlMessageStorage.ts);
  [SQL runner storage](https://github.com/Effect-TS/effect/blob/bc492f0965dc0f6a83cefd141071c5ead10f7efa/packages/capability/effect/src/cluster/SqlRunnerStorage.ts).
- **E14:**
  [Official explanation of idempotency, transactions, and the remaining external-write gap](https://effect.website/blog/module-of-the-week/cluster-idempotency).

### Supplied Utils evidence

- **U1:** `work/utils-upload/packages/workflow/README.md`, `mod.ts`, `types.ts`, `replay.ts`, `serve.ts`.
- **U2:** `work/utils-upload/packages/workflow/client.ts`, `execution.ts`, `pause.ts`, `engines.ts`, `affinity.ts`.
- **U3:** `work/utils-upload/packages/storage/workflow/postgres/postgresjs.ts` and its public adapter entry;
  `docs/workflows/11-events.md`, `12-progress.md`, `13-execution.md`, `14-consumers.md`.
- **U4:** `work/utils-upload/packages/activity/{local,worker,process,remote}.ts`; existing workflow
  execution/event/recovery/consumer tests; `work/utils-ast-trace.json`.
- **U5:** `work/utils-probes/AUDIT.md`, `candidate-changes.json`, `utils-regression-baseline.log`,
  `utils-regression-candidate.log`, `utils-candidate-execution.log`, `utils-checks-baseline.json`,
  `utils-checks-candidate.json`.

No Utils, Crawl, or remote repository source was changed for this comparison. No competitor SDK, service, or cluster was
executed. Source inspection, existing Utils runtime evidence, and proposed acceptance gates remain explicitly separate.
