# Workflow engine capabilities and delivery plan

This comparison was checked on 2026-10-31 against official documentation, selected pinned source, and the supplied Utils
checkpoint. It maps product capabilities as well as execution primitives. It does not claim that all three competing
systems were deployed, benchmarked, or failure-tested in this task.

The Utils engine uses PostgreSQL to decide which work it can accept, record state changes as they commit, and
let an operator inspect saved runs. It can split long work into a fixed number of runs and keeps related records
until their retention periods end. The comparison also records fixes for scheduling failures the tests reproduced.
These features are useful for Crawl. To compare speed, cost, or reliability with Temporal, Inngest, or Effect
Workflow, test the workload that matters to the application.

## Read the complete maps

- [Temporal](./temporal.md), with [52 primary sources](./temporal-sources.md): execution and placement, scheduling,
  priorities/fairness, retries, heartbeats, signals/queries/updates, children, continuation, versioning, progress,
  testing, cloud/self-hosted operations, security, recovery, and cost drivers.
- [Inngest and Effect Workflow](./inngest-effect.md): durable steps and replay, concurrency/flow control, triggers,
  cancellation, realtime delivery, deployment/versioning, persistence, cluster placement, clocks/queues, and operating
  responsibilities. The map separates released primitives from a managed service product.
- [Utils before these changes](./baseline-audit.md): AST trace, implemented contracts, missing features, and the
  implementation decisions that led to this package. This baseline is historical evidence; the table below describes the
  delivered candidate.

Research identities are Temporal Server 1.32.1 and TypeScript SDK 1.25.0, Inngest SDK 4.26.2 and server 1.49.0, and
Effect 4.1.1. Current Effect Workflow/Cluster APIs are marked unstable even though the Effect core release is stable.
Temporal documentation is rolling; preview and configuration-gated features are labeled in its map. Release identity
does not imply a source audit of every implementation. The research files state the actual inspected source scope.

## What the comparison changes

Temporal already supports worker thread pools, task routing, standalone activities, resource-aware worker tuning, queue
priority and weighted fairness, and a Kubernetes Worker Controller. Its fairness is not preemption of an already running
Activity. Threads alone cannot distinguish Utils.

Inngest releases step capacity while a run durably sleeps or waits. Its current TypeScript v4 checkpointing can execute
sequential steps in one handler and checkpoints eagerly by default. Describing it as one separate HTTP invocation per
step in every case would compare against an outdated model. Realtime publish memoization and disconnected-subscriber
history are different guarantees; a durable publish does not by itself promise catch-up delivery to a later subscriber.

Effect supplies typed concurrency, interruption and scoped resources, durable workflow primitives, persistence and
cluster integration. Those primitives do not imply a bundled operating console, tenant policy system, retention service,
or managed deployment. Its default short-clock optimization also differs from forcing every wait into durable storage.
The pinned-source map records those details.

These findings favor a precise goal for Utils: make an embedded engine easier to integrate and operate for our
workloads, with strong local transaction semantics and explicit placement/control behavior. Measure the result against
the actual alternatives instead of treating a feature name as proof of an advantage.

## Delivered capability status

| Capability                         | Candidate behavior                                                                                             | Checks or remaining limit                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Durable acceptance and dedupe      | Namespace/scope/definition/key identity, immutable input/policy fingerprints, transactional acceptance         | Retention eventually releases keys; permanent business identity belongs to the application.                      |
| Activity retries and stale workers | Saved attempt budgets, deadlines, leases, host/claim generations, guarded results and receipts                 | External effects need an accepting idempotent sink or an application-owned reconciliation/outbox contract.       |
| Capacity release while waiting     | Saved timer/event/child waits release activation slots; unrelated work can run                                 | Ordinary awaited I/O and local Task pause retain an invocation slot.                                             |
| Thread/process placement           | Explicit existing provider bindings, borrowed pools/resources, per-engine admission                            | No arbitrary stack migration or preemption; no container provisioner.                                            |
| Provider capacity                  | Reservation begins before asynchronous preflight and ends after complete settlement                            | Coordinator counts are not CPU, memory, or fleet utilization.                                                    |
| Bounded recovery fairness          | Inactive/locked owner filtering before limits; diagnosed blocked cleanup children no longer consume every scan | No weighted tenant scheduling or per-tenant rate policy yet.                                                     |
| Durable operator pause/resume      | Audited physical-run control with an independent compare-and-set revision                                      | Active work can settle; child controls do not automatically inherit ordinary parent pause.                       |
| Cancellation/repair                | Existing cancellation and audited attempt repair; pending continuation remains an immutable exit intent        | Unsupported replacement of a terminal failed cleanup child is refused explicitly.                                |
| Progress                           | Fenced latest report per job/effect and existing Observable observation                                        | Intermediate replaced report bodies are not a durable append log.                                                |
| Lifecycle history                  | Transactional per-run run/job/operator events, exact resumable cursors, truthful migration baselines           | Metadata only; active-run timeline growth is outside replay historyBytes.                                        |
| Inspection                         | Bounded run/jobs/attempts/waits/progress/history/queue/host reads with consistent per-call snapshots           | App owns authentication, authorization, response-byte budgets and UI.                                            |
| Continuation                       | Fresh physical run/input/history, stable chain/family, cleanup before atomic successor visibility              | Finite root chains only; same definition; rejects nested/child/successor use and configured business finalizers. |
| Retention                          | Explicit terminal-family pruning, all preservation windows, one total row deletion budget                      | Conservatively preserves a whole live family; host-generation tombstones are not pruned.                         |
| Schema upgrades                    | Serialized version checks, no-DDL current-version path, maintenance guard for real upgrades                    | Requires drained old writers; not a mixed-version rolling deployment system.                                     |
| Logs/traces/metrics                | Existing LogTape/OpenTelemetry plus inspectable lifecycle state                                                | Export durability and log retention belong to configured application destinations.                               |
| Schedules and triggers             | Durable waits and explicit event delivery already exist                                                        | Cron overlap, catch-up, backfill, singleton/debounce/batching and schedule administration remain separate work.  |
| Version deployment                 | Exact definition versions and replay-conflict checks                                                           | No managed ramping, pinned build rollout, replay compatibility service, or fleet controller.                     |
| HA and disaster recovery           | Worker replacement over an authoritative PostgreSQL database                                                   | No measured multi-region RPO/RTO, database failover or production availability claim.                            |
| Cost competitiveness               | Bounded payloads, explicit concurrency/retention, existing receipt reuse                                       | No comparative unit-cost result yet.                                                                             |

The [operations guide](../16-operations.md), [continuation guide](../15-continuation.md), and
[inspection guide](../../postgres/03-inspection.md) document usable APIs. Tests accompany every changed persisted
contract. The delivery report records executed results separately from source-only analysis and remaining gates.

## Remaining work, in dependency order

### 1. Test the operational envelope

Keep the committed-write-before-kill receipt test, continuation transaction fault injection, real provider recovery,
capacity-release pressure test, stale-claim assertions, and migration lock tests as required regression coverage. Extend
the workload gradually across realistic payload sizes, fan-out, wait durations, and activity distributions. Record
queue-age percentiles, recovery delay, duplicate attempts, duplicate committed business writes, memory, open
connections, database/WAL bytes and operations per completed item. Run a long soak with resource plateaus and bounded
cleanup, then database disconnect/failover and rolling process replacement. A successful short local load is one
checks point, not a production envelope.

Gate: no lost accepted work, no duplicate effects for the tested sink contract, explicit terminal/blocked outcomes,
bounded resource use, and reproducible recovery within an agreed workload-specific target.

### 2. Finish general lifecycle semantics

Design child/successor continuation with chain-aware parent waits, cancellation and progress aggregation; define
business finalization per physical segment versus logical chain before adding either. Define explicit redrive or
replacement for terminal failed cleanup children. Design bounded live operational history/export with cursor-expiry
semantics, plus permanent logical command identity independent of retained execution history where needed.

Gate: crash tests at every transfer of ownership, stable logical identity, no abandoned completion obligations, and
explicitly bounded retention/continuation costs. Do not relax the existing rejection rules until those contracts exist.

### 3. Add admission and scheduling policy

For Crawl, prioritize per-origin concurrency and rate limits, tenant fairness, retry-backoff budgets and queue-age
visibility. Separate rate limiting that rejects excess requests from throttling that queues them. Add priorities,
weighted tenant admission, schedule overlap/catch-up rules and backfill controls only with starvation and overload
tests. Repeatedly ready older workflows also need an explicit admission-order policy; creation-time order is not a
general fairness guarantee.

Gate: a noisy tenant or origin cannot indefinitely delay an eligible quieter one, and overload remains visible and
bounded without losing already accepted work.

### 4. Add deployment compatibility and fleet operation

Build saved-history replay checks and schema migration fixtures into release test. Define supported N/N-1
worker compatibility, rollout/drain/rollback behavior, and queue routing before adding a container controller. Keep host
placement separate from compute provisioning. Preserve host-generation fencing when designing tombstone cleanup;
deleting a registration must not recreate a previously issued generation.

Gate: a mixed-deployment drill either continues compatible work or blocks incompatibility explicitly, with no stale
worker committing after replacement and no assumed safe online schema upgrade.

### 5. Make the solution operable

Build an authorized operator API and UI over the inspector and control contracts. Include progress, elapsed time, queue
age, attempts, blocked reason, continuation segments, exact affected reference, and auditable decisions. Add safe
replay/redrive previews, search attributes, alerts and retention policies at the service layer. A tenant scope in a
query is not a substitute for application authorization. Avoid returning secret-bearing input or error bodies by
default.

Gate: an operator can diagnose and recover the supported failure modes without hand-editing engine tables; every
unsupported case has a clear diagnosis and application-level recovery procedure.

### 6. Return to Crawl with measured requirements

Use this utilities package through a pinned dependency or explicit checkout. Stress the actual crawler with a fixed,
versioned corpus covering slow responses, redirects, robots policies, dynamic rendering, repeated URLs, extraction
failures, rate limits, large documents and interrupted sinks. Reuse published Intelligence registry, facts and extractor
packages where their verified contracts fit. Do not copy their internals into Crawl without a concrete missing
capability.

Connect product requirements from the earlier Firecrawl/Tavily work to measured outputs: successful useful documents,
citation/provenance quality, search/research relevance, freshness, extraction accuracy, resumability and support effort.
The existing Crawl exploration remains the integration starting point; this package is the prerequisite utilities work.

Gate: the Crawl end-to-end checks uses the actual repaired package, and the capability/cost report distinguishes
the engine, fetch/render/extract pipeline, search/research solution, and deployment costs.

## How to establish a cost or reliability advantage

Use the same workload, correctness requirements, retry/sink contract and service envelope for each option. Compare cost
per useful completed document or research task, including compute, database, storage/WAL, browser/proxy/network,
orchestration charges, observability retention, retries and operator time. Report p50/p95/p99 completion and recovery
delay, data quality and duplicate consequences alongside cost. Price/plan inputs need rechecking at measurement time.

An embedded transaction can avoid a separate application-outbox handoff when the business write and workflow receipt
share one database transaction. That is a concrete architectural opportunity. It does not make arbitrary third-party
HTTP effects exactly once, eliminate database operations, or prove lower total cost. Start with the Crawl workload and
publish measured comparisons once the checks gates above are met.
