> Research baseline, checked 2026-10-31. This page describes the Utils source before the changes listed in
> [the comparison index](./README.md). See [operations](../16-operations.md) for the current procedures and limits.
> Local workspace paths show where the research ran. Utils does not need those files to run.

# 2026-10-31 capability baseline and original repair plan

## Scope and evidence

This inventory compares the preserved uploaded utility snapshot with the previous two-file recovery candidate. It is a
source audit and implementation contract, not a claim that all advertised capabilities have been tested in
production.

- Uploaded archive SHA-256: `5776ccf0726deb02f6ab865e73248ba53d7a2b5e9657feaf90ff06d0bd2fd7b2`.
- Preserved original: `/workspace/scratch/4add5c84a75a/work/utils-upload`; 1,246 original files, each recorded in
  `work/utils-upload-manifest.json`.
- Previous candidate: `/workspace/scratch/4add5c84a75a/work/utils-candidate`. Its only differences are the recovery
  candidate filters in `packages/storage/workflow/postgres/postgresjs.ts` and the corresponding
  `tests/workflows/execution.test.ts` regressions/local-database seam.
- Parent snapshot for this work: `okikio-utils-recovery-20261031T181556Z`. The parent registered
  `chat-20261031-183635-utils-engine`; source implementation will use `work/utils-engine` after shared contracts are
  agreed.
- Read-only AST inventory: `research/utils-improvement/capability-ast.json`, produced by `inspect-capabilities.mjs`. It
  records hashes, exports, 478 declarations, call names, test names and SQL statements across 22 runtime/test modules.
  TypeScript 6.0.3 parsed all 22 with zero syntax diagnostics.
- Previous executable evidence: all 27 PostgreSQL execution/wake-up tests passed on the recovery candidate. The
  strengthened real-process receipt experiment passed on original and candidate; its parent independently observed the
  committed receipt and business append before SIGKILL. Other evidence and limitations are in
  `work/utils-probes/AUDIT.md`.

No PostgreSQL server was started for this new inventory. No runtime source was modified during discovery.

The latest supplied `build-workflows`, `use-okikio`, Deno and engineering guides were used by purpose. Their dated
utility reference describes an older memory-only example; the actual supplied source now contains a real PostgreSQL
runtime. The source and executed evidence take precedence over assuming that the older example is the entire current
system.

## Current capability inventory

| Area                            | Implemented behavior                                                                                                                                                                                                                                                                   | Actual gap or checks limit                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acceptance and identity         | `client.trigger/submit`, `client.in(tx)`, stable namespace/scope/definition/key dedupe, saved policy and input fingerprints, real transaction participation through `postgres.begin`. Workers need not be online.                                                                      | No public searchable run listing or durable event-trigger orchestration service. The service still owns authorization.                                                                                                                                                                                                                                                                                         |
| Durable suspension              | `serve::advanceWork` runs `replay`, saves eligible branch instructions, and calls `store.park` when pending. `park` checks completion under the run lock before choosing ready/waiting. The advance returns, releases local context, clears renewal and decrements `activationCount`.  | This already releases active workflow capacity. It must not be replaced with a promise held open during a long wait. A specific stress test with many parked runs and a one-slot worker remains useful.                                                                                                                                                                                                        |
| Waits and resumption            | Relative/absolute timers, named event waits, early-event retention, event identity/conflict detection, timeout/cancel arbitration, child waits, branch controls, notification hints plus polling/deadline recovery.                                                                    | No general durable arbitrary JavaScript suspension. Deprecated custom waits and generic workflow effects are rejected. Generic schedules/cron, update handlers and replay campaigns are separate missing contracts.                                                                                                                                                                                            |
| Local pause                     | Task and local workflow `Pause` gates stop cooperative checkpoints, share pause state across local branches and reject promptly on cancellation.                                                                                                                                       | Pause retains the live operation and its resources. It is not durable parking and cannot reclaim a slot while that invocation may still execute. There is no persisted operator pause/resume on saved runs.                                                                                                                                                                                                    |
| Active capacity                 | Separate activation/activity/finalizer counts in `serve`; one recovery loop; SQL host capacity under an advisory transaction lock; pool maxima; per-engine capacity and cleanup reservations. Counts are released when the owned promise settles, including cleanup.                   | Public `Serving.state()` exposes only aggregate active count. There is no queue age/depth inspection or tenant fairness contract. Per-engine admission is checked before asynchronous invocation; reservation timing merits a real regression before claiming exact per-engine admission under delayed invocation.                                                                                             |
| Queue fairness                  | SQL workflow claims use `FOR UPDATE SKIP LOCKED`; jobs discover bounded candidates then lock owner before job. Recovery candidate filtering was repaired for expired claims and due waits.                                                                                             | `take` examines the first 32 candidates before skipping locked owners, so a locked prefix can exclude otherwise eligible later jobs. Workflow ordering uses original `created`, not the time the run re-entered readiness. Cleanup scans still include blocked children/parents that may repeatedly consume a bounded batch. These are source-grounded risks, not newly reproduced failures in this inventory. |
| Cancellation and repair         | Saved cancellation, guarded claims, attempt deadlines, revoked siblings, durable cleanup, finalizers, blocked state and audited repair with expected epoch/extra-attempt budget.                                                                                                       | No durable operator pause/resume; no broad replay/redrive API. Cancellation is distinct from compensation and external-effect reconciliation.                                                                                                                                                                                                                                                                  |
| Stale workers                   | Host generation and expiry, claim generation/sequence/epoch, strict native claim identity, run-before-job locking, lease renewal, abandonment and stale-completion rejection.                                                                                                          | A write that acquired permission locks first may finish after wall-clock lease expiry; existing tests intentionally specify this transaction ordering. No claim of distributed exactly-once external side effects is justified.                                                                                                                                                                                |
| Progress                        | `task.ProgressEffect` is automatically selected; custom effects may be selected explicitly. `store.report` checks current claim, sequence/generation and history bytes. One latest record per run/job/effect survives restart.                                                         | Progress reports are observations, not committed business checkpoints. A retry may report a lower counter. Intermediate reports may be overwritten.                                                                                                                                                                                                                                                            |
| Progress observation            | `client.watch` polls saved snapshots, emits changed revisions once per subscription, supports child subtrees, reports truncation beyond 1,000 slots, and completes at terminal/blocked state. Observer cancellation does not cancel work.                                              | It emits progress values, not every lifecycle transition. It is not a cursor-based durable event stream, total order or exactly-once subscription. No public attempt/wait/history inspection exists beyond `get` state/result/reason/progress.                                                                                                                                                                 |
| Logging, traces and metrics     | Existing OTel/LogTape integration: saved W3C trace parent, submit/advance/attempt/write spans, retry/receipt notices, `utils.operation.count`, `.duration`, `.active` and `utils.event.count`. Host explicitly configures exporters. Telemetry failure cannot repeat application work. | There is no saved operator timeline for ordinary transitions, queue-depth/oldest-age metric, detailed capacity state, or recovery-action metric. Do not describe the package as having no observability.                                                                                                                                                                                                       |
| Continuation                    | Public `workflow.continue(input)` constructs a `continue` command. The local interpreter surfaces `ContinueAsNewError`.                                                                                                                                                                | `serve::plan` rejects it as `unsupported_instruction`. No atomic saved continuation, current-generation link or client follow-chain behavior exists. Public authoring is not runtime implementation.                                                                                                                                                                                                           |
| Retention                       | Policy records positive dedupe/results/audit durations. Instructions, events and progress share a per-run history budget.                                                                                                                                                              | There is no pruning method, terminal completion timestamp, retention worker or tombstone/chain retention contract. Completed rows/receipts/audit accumulate. History limits currently block rather than roll over.                                                                                                                                                                                             |
| Migration                       | `postgres.migrate` serializes migrators with advisory transaction lock `776161003`, applies idempotent DDL and checks schema version one. `store.check` verifies version/required columns.                                                                                             | The full DDL, including ALTER and trigger replacement, runs on every invocation. Migration overlapping another checks's active worker caused a real deadlock. Migrator serialization already exists and does not itself prevent this overlap.                                                                                                                                                           |
| Threads/processes and authority | Real worker/process providers reconstruct local resources, use checked transports/reverse calls, pool execution hosts, retain leases through cleanup and expose pool stats/drain.                                                                                                      | Durable remote bindings reject declared admission requirements without an explicit authority bridge; `postgres.transactions/receipts` are rejected remotely. Store-owned SQL claim authority must remain local or become a separately designed domain write service. No container launcher/autoscaler is implemented.                                                                                          |

### Specific source anchors

- Durable save/park/release: `packages/workflow/serve.ts::advanceWork`, `serve::launch`,
  `packages/workflow/replay.ts::replay`, `packages/storage/workflow/postgres/postgresjs.ts::Store.park`.
- Capacity and fairness: `serve::eligible/loop`, `packages/workflow/engines.ts::bind`,
  `Store.#capacity/activate/take/recover`, `packages/activity/worker.ts::create`,
  `packages/activity/process.ts::create`.
- State and progress: `packages/workflow/execution.ts::SnapshotType/ProgressType/ExecutionStore`,
  `packages/workflow/client.ts::ClientType/client`, `Store.get/report/send`.
- Existing telemetry: `packages/telemetry/instrument.ts::span/notice/measure`, `serve::advance/attempt`,
  `Store.transaction/getReceipt`.
- Continuation: `packages/workflow/mod.ts::continueRun/ContinueAsNewError`,
  `packages/workflow/types.ts::WorkflowContinueCommand`, `serve::plan`.
- Retention/migration: `packages/workflow/execution.ts::PolicySchema`,
  `packages/storage/workflow/postgres/schema.ts::migration`, `postgresjs.ts::migrate/check/#exit/#settled` and
  terminal-state writes.
- Remote authority: `serve` policy validation, `packages/workflow/engines.ts::bind`, `Store.#guard/#claims`.

Several older overview paragraphs incorrectly list durable `defer` as unsupported. `serve::plan`, cleanup scope storage
and consumer tests demonstrate that it is implemented. Correct those paragraphs during delivery rather than rebuilding
working cleanup.

## Recommended first package

Deliver **safe maintenance and inspectable saved execution** on top of the working durability core: migration fast
path/ownership, explicit bounded retention, persisted admission pause/resume, useful saved-state inspection, lifecycle
observation and detailed worker capacity. Include focused fairness repairs only when real PostgreSQL tests reproduce
them. This is real runtime work with observable application behavior, while leaving the existing placement, receipts and
replay machinery intact.

Do not bundle a superficially implemented continue-as-new into this first contract. It changes logical identity, result
following, cleanup, cancellation, admission reservations and retention together. Specify that feature separately and
implement it after those choices are explicit.

### 1. Migration ownership and a no-DDL current-version path

Retain the existing migrator lock. Introduce a real schema revision/ledger for the new fields and a read-only fast path
when that revision is already applied; do not rerun trigger replacement during every worker's startup. Bootstrap and
upgrade remain explicit caller operations. Startup checks and registration must not silently start an old incompatible
worker during an upgrade.

For an actual upgrade, require maintenance ownership: stop admissions/claims, drain workers, apply the migration once,
then start compatible workers. A bounded active-host refusal and a registration/migration coordination lock can enforce
the new-code path, but neither proves an online upgrade against uncooperative old workers or long in-flight
transactions. Keep those limits visible.

Affected files: `postgres/workflow/schema.ts`, `postgresjs.ts::migrate/check/register`; public version/check
documentation. Tests: current revision performs no DDL, two fresh migrators serialize, an upgrade is refused with active
new-code hosts, startup cannot cross an in-progress upgrade, and failure rolls back schema/version publication together.
Reproduce the prior shared-migration failure before claiming its operating scenario is resolved.

### 2. Persisted pause/resume as admission control

Use an orthogonal saved flag/revision, not another overloaded run state. Proposed shared type:
`ControlType { paused: boolean; revision: number }`, exposed in snapshots. Proposed methods:
`pause(ref, { actor, reason, revision })` and `resume(ref, same)` returning the new control value.

The control revision must be separate from `epoch`: increasing epoch would revoke active claims and change pause into
cancellation/recovery. Define run-local admission pause precisely: do not claim another workflow advance or ordinary
activity job; already claimed work may finish, events/timers may save readiness, and cancellation plus
cleanup/finalizers may settle. Resume permits future claims; it does not rerun completed steps. Child runs are
independently addressed unless an explicit family-control contract is added.

Record actor/reason/control action transactionally in the existing audit facility. Use a compare-and-set revision to
reject a stale operator command. Decide and test repeated desired-state idempotence. Terminal runs must not be revived.

Affected files: `execution.ts` types/schema, `client.ts`, `postgresjs.ts::pause/resume/activate/take/next`, `schema.ts`;
generated facade exports only if a new subpath is introduced. Tests: pause survives a fresh client/worker; already
claimed work can publish once and settle; queued work stays queued; event/timer readiness remains saved while paused;
resume runs exactly once; cleanup/cancel still settle; stale revisions and wrong namespace/ref are rejected.

### 3. Real retention with a total deletion budget

Add `finished_at` when a run becomes terminal after required cleanup/finalization. Do not use acceptance time as
completion time. Backfill legacy terminal rows conservatively to migration time so the upgrade does not immediately
delete evidence whose actual completion time is unknown.

Select a family only when every remaining member is terminal and past every member's `max(dedupeMs, resultsMs, auditMs)`
preservation deadline. Keep live children, blocked finalizers and incomplete parents protected. Hold the family root
lock so concurrent pruning calls do not mutate the same family independently.

Expose adapter maintenance explicitly, for example `StoreType.prune({ limit }) -> { deleted, runs, families, more }`.
`limit` must bound **total deleted rows across all dependent tables and run rows**, not just the number of candidate
roots. Delete progress, receipts, attempts, instructions, cleanup records, events and audits before jobs/runs according
to foreign keys. If the budget runs out, commit the partial expired-data cleanup and continue on another invocation;
keep run rows until their dependents are gone. These families are already terminal and outside all promised retention
windows, so they must not gain new executable children.

Do not delete application business tables or hide a foreign-key refusal from an application reference. Do not start
pruning automatically inside `serve`. Document that after dedupe retention and completed deletion, a repeated command
key may create new work; application-level permanent idempotency remains the application's responsibility.

Affected files: `postgresjs.ts::StoreType/prune`, terminal state transitions, `schema.ts` timestamp/indexes, PostgreSQL
module exports if needed. Tests: every preservation window; legacy backfill; active/blocked family protection; child
protection; exact shared row budget over repeated calls; interrupted/resumed pruning; concurrent pruners; namespace
isolation; receipt/attempt FK ordering; and command identity behavior before and after expiry. Query cost and
oldest-family fairness need realistic retained-history fixtures, not merely a single completed row.

### 4. Inspection and observation without pretending to have an event log

Build on `get`, progress snapshots and telemetry. Add a bounded public inspection view of saved waits, current/recent
attempts, history usage/limits and control state. Expose explicit truncation or a stable cursor for each independently
ordered collection. Raw input/error payloads should remain excluded by default.

Add a lifecycle snapshot observer separately from the existing `watch` progress feed, with clear polling/snapshot
semantics, cancellation ownership and terminal/blocked behavior. Expose activation/activity/finalizer counts and
configured capacities in `Serving.state`, and per-engine admitted counts if needed. Metric labels must remain fixed
categories rather than run IDs, URLs or customer IDs; those identifiers belong on logs/spans.

Do not call this a durable event stream: adding an append-only lifecycle timeline requires its own
ordering/cursor/retention/transactional publication contract. Existing repair audit plus saved instructions/attempts can
support inspection immediately.

Affected files: `execution.ts`, `client.ts`, `serve.ts`, `engines.ts`, `postgresjs.ts::get/inspect`, relevant
client/serve and real SQL operation tests, `docs/workflows/12-progress.md` and a new operations guide.

### 5. Fairness regressions before more query changes

Reproduce three independent risks in an isolated database: a locked prefix of job candidates; a prefix of cleanup
records whose parent/child is blocked; and older repeatedly ready workflows versus a newer ready workflow. Also exercise
provider admission when asynchronous pre-invocation work is delayed. Fix only demonstrated defects with stated
scheduling semantics. Preserve run-before-job locking and count active work through actual provider cleanup.

The previous two owner-state recovery fixes stay in the new base. Their successful tests do not establish the fairness
of every other bounded scan.

## Continuation contract to design next

Existing successor admission provides reusable pieces; atomic job acceptance, stable keys, family identity and bounded
reservations; but is not an implementation of continue-as-new.

Before implementation choose:

1. A stable logical chain identity and a separate execution/generation identity.
2. How the predecessor records `continued` and the exact next reference atomically without pretending it produced a
   final business result.
3. Whether `get`, `wait`, `watch`, cancel and pause follow the logical chain or inspect one generation, and how callers
   opt into each.
4. Cleanup/finalizer and outstanding-child behavior at rollover; initially requiring no outstanding independent work may
   be safer than silently abandoning it.
5. Input validation, policy/version compatibility, bounded successor admission and concurrent duplicate-continuation
   handling.
6. Retention of old-generation history, receipts and chain links while a later generation remains live. Conservative
   whole-family retention protects links but does not bound storage for an infinite chain.
7. Crash points before/after successor acceptance, predecessor transition, cursor update and cleanup.

A credible continuation implementation likely affects `types.ts`, `mod.ts`, `execution.ts`, `replay.ts`, `serve.ts`,
`client.ts`, `postgresjs.ts`, `schema.ts` and package/type/docs tests. A new `submit` call or an in-memory loop would
not meet the advertised contract.

## Delivery and evidence plan

Use the new isolated engine tree and preserve both earlier snapshots. Coordinate shared schema/types/adapter ownership
before edits. Run migrations once in a dedicated disposable database; do not parallelize independent checks
processes that each migrate the same schema.

First establish meaningful failing real-SQL tests for each new contract, then implement and run the focused SQL suite
plus neighboring recovery/notification/cancellation tests. Use real fresh worker processes for restart controls and real
thread/process providers for placement claims. Record exact versions: prior environment was Node 24.22.1, Deno 2.9.8,
TypeScript 6.0.3/TypeScript-native 7.0.2 and PostgreSQL 18.3, which differs from the uploaded mise pins.

The final ZIP should include complete source and tests/docs, no installed dependencies or temporary database, an
explicit version/source manifest, exact verification commands/results and a runnable local example. Validate the
extracted delivered ZIP itself using its own dependency resolution. Keep source-level capability, executed tests,
load/failover evidence and still-unimplemented roadmap items distinct.
