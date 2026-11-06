> Research baseline, checked 2026-10-31. Statements about the supplied Utils source describe the checkpoint before this
> improvement package. See [the delivered capability status](./README.md) and [operations](../16-operations.md) for
> implemented changes and restrictions. Local research-workspace paths are provenance notes, not required runtime files.

# Temporal capability map and implications for Utils

Checked **2026-10-31 UTC**. Research handoff for improving the supplied Utils archive before further Crawl integration.
This document describes verified official documentation, the already audited utility snapshot, and proposed
checks requirements separately. No Temporal service was deployed or benchmarked for this research, and no utility
source was changed by this research task.

## Decision

Develop Utils as an embedded, explicit execution and recovery system for applications such as Crawl. A credible first
claim is a well-tested package with a small operational footprint, transactional acceptance/publication in the
application's PostgreSQL database, bounded placement across supported execution resources, and inspectable recovery. A
claim of complete Temporal parity, superior reliability, or lower total cost needs much more evidence.

Temporal already supports durable orchestration, durable Activities without a Workflow, worker threads, queue priority
and weighted fairness, deployment routing, Kubernetes rollout/autoscaling, and preview serverless execution and progress
streams. Therefore, “Temporal only schedules processes/containers,” “Temporal cannot run a single durable job,”
“Temporal has no fairness,” and “Temporal cannot manage worker compute” are inaccurate premises. The matrix below
records the narrower contracts and limits that matter.

## Sources, versions, and evidence contract

The official release pages identified these release pins:

| Component       | Release checked                               | Full commit identity                       | Checks                                                                                                                              |
| --------------- | --------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Temporal Server | `v1.32.1`, released 2026-10-08; marked Latest | `af08a5e5f2dd40f545f2afac7780daaa6987001e` | Release and commit metadata verified. Later-dated maintenance releases for older lines do not make them the highest current release. [T01] |
| TypeScript SDK  | `v1.25.0`, released 2026-10-27; marked Latest | `efafd16ef4533da24029277bd72caf564c7aa007` | Release and commit metadata verified. Several features in this release are explicitly experimental. [T02]                                  |

Most capability evidence is **rolling official documentation/API documentation**, not a frozen documentation revision. A
current documentation feature is not automatically proven available with every SDK, hosting plan, configuration, or the
release pins above. Preview/experimental labels and documented prerequisites are retained below. Attempts to inspect
selected SDK implementation files at their full commit through GitHub/raw URLs were blocked by the retrieval service; no
implementation audit of those files is claimed. The separate [source register](./temporal-sources.md) lists primary
URLs.

Local context comes from the supplied `build-workflows`, `use-okikio`, `deliver-software`, and `deno-software` guidance,
especially the separation of durable authority, local task control, placement, atomic publication, and cleanup. The
older utility reference's memory-only description is superseded for this upload by the actual utility audit
(research-workspace reference) and independent review (research-workspace reference). Those audits describe a tested
snapshot, not the subsequent improvement branch.

## Four concepts the API must keep distinct

1. **Asynchronous I/O concurrency:** a JavaScript task awaiting a network operation permits other work on its event
   loop. That alone preserves neither the task nor its side effects after process loss. It also does not execute
   CPU-bound JavaScript simultaneously on multiple cores.
2. **Durable orchestration suspension:** Temporal records decisions and outcomes, then reconstructs workflow state by
   deterministic replay. A waiting Workflow need not occupy an executing Workflow Task; a cached context can still
   consume memory. It does not serialize a live JavaScript stack, socket, browser, or OS thread. [T03], [T04], [T05]
3. **Activity checkpoint recovery:** an interrupted Activity attempt normally restarts its function. Its application
   code can use the last persisted heartbeat details or external checkpoints to avoid redoing completed portions.
   Heartbeat persistence is throttled, so the most recently submitted local heartbeat may not be available after a
   crash. [T12], [T13], [T14]
4. **Physical placement and interruption:** a queue, thread, process, container, or remote host describes where code
   runs and which resource owns it. It does not by itself establish durable progress or exactly-once effects. The
   TypeScript SDK already runs Workflow activations through a configurable thread pool. Cooperative cancellation and
   process termination provide different guarantees. [T06], [T09], [T17], [T18]

For Utils, a pause handle, an awaited checkpoint, a durable paused run, a released provider slot, and a killed process
must not share an ambiguous “paused” or “stopped” status.

## Capability matrix

“Established” below means a documented normal capability, not a reliability benchmark. Availability of individual
options remains version/configuration dependent.

### Execution, concurrency, placement, and capacity

| Capability                        | Temporal's actual contract and limits                                                                                                                                                                                                                                                                                                                | Implication for Utils / evidence required                                                                                                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable suspension and replay     | Event History records execution decisions and results. Replay must reproduce the same command sequence; completed recorded Activity results are reused. The system reconstructs state rather than restoring arbitrary live resources. [T03], [T04], [T05]                                                                                            | Keep I/O outside replay. Persist instruction identity, input/version compatibility, and outcome references. Demonstrate restart after each durable contract and reject incompatible history explicitly.                                             |
| JavaScript and threads            | `workflowThreadPoolSize` controls the SDK's Workflow activation threads and contexts. Activity concurrency settings are capacity controls; an asynchronous API is not evidence of parallel CPU execution. This research does not establish arbitrary per-Activity thread placement in the TypeScript SDK. [T06]                                      | Existing thread/process providers could offer convenient per-operation placement. Prove actual cross-thread execution, resource isolation, lost-worker recovery, and serialization constraints. “Uses threads” alone is not a differentiator.       |
| Task queues and pull dispatch     | Workers poll queues when able to accept work. Workflow and Activity tasks are durable; Query and Nexus tasks have different synchronous matching/retry behavior. Queue names route work to compatible workers; they are not OS scheduling primitives. [T07]                                                                                          | Define durable enqueue/claim independently from provider admission. A queue-accepted job is not necessarily executing or allocated a thread. Publish these distinctions in progress and metrics.                                                    |
| Resource slots and backpressure   | Workers have separate task slots, fixed/resource-based/custom tuning, and poller tuning. CPU/memory targets are not hard resource ceilings. Poller autoscaling is distinct from adding worker replicas. [T08], [T10]                                                                                                                                 | Model browser contexts, bytes in flight, CPU tasks, SQL publication, and remote-service budgets explicitly. Reserve control/finalizer capacity. Prove memory and queue bounds under downstream slowdown.                                            |
| Routing and affinity              | Queues support routing to suitable workers, including host-specific queues for local-resource affinity. Session support exists in some SDKs. Host affinity does not replicate a file or make a lost host recoverable. [T09]                                                                                                                          | Separate portable activities from host-bound browser/file lifetimes. A task requiring a lost local artifact must rebuild it or fail explicitly; placement metadata cannot substitute for durable artifact storage.                                  |
| Priority and weighted fairness    | Priority uses levels 1–5, default 3. Fairness uses weighted keys within priority levels. Both operate within queue partitions, not as strict global scheduling guarantees; running work is not preempted. Fairness is separately enabled: paid Cloud feature or self-hosted configuration. Existing version/backlog/restart limitations apply. [T11] | Define whether fairness is by tenant, origin, operation, or resource, and whether it bounds waiting time or only long-run share. Test retained ineligible rows, heavy tenants, mixed durations, retries, and control work. Do not claim uniqueness. |
| Standalone durable Activities     | Server 1.32 makes standalone Activities GA. They have durable IDs, retries/timeouts, handles, and visibility without a Workflow. A retry restarts function execution, optionally using heartbeat details. Multi-step orchestration still belongs in a Workflow. [T01], [T12]                                                                         | A durable single-job API is a useful baseline, not a unique feature. Separate command deduplication from business-effect idempotency and history-based orchestration.                                                                               |
| Local and asynchronous Activities | Local Activities run on the Workflow worker, bypass the normal Activity queue, and suit short idempotent work. They trade routing/rate-control characteristics for lower overhead. Asynchronous completion lets external code finish an Activity later; it does not remove deadlines or attempt identity. [T15], [T16]                               | Keep local fast paths and remote completion explicit. A callback or IPC acknowledgment must be tied to the active attempt and fenced against late completion.                                                                                       |

### Recovery, deadlines, effects, and control

| Capability                       | Temporal's actual contract and limits                                                                                                                                                                                                                                                                                               | Implication for Utils / evidence required                                                                                                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activity retries                 | Activities normally retry with exponential backoff. Default attempts are unlimited within configured deadlines; Workflow Execution retries are not enabled by default. Workflow Task retry is a separate mechanism. [T14]                                                                                                           | Distinguish infrastructure retry, application failure, attempt retry, and whole-run restart. Bound attempts or elapsed time deliberately; show the chosen policy in inspection output.                                                        |
| Timeouts                         | Queue wait, one attempt, the entire Activity including retries, and heartbeat liveness have separate deadlines. Workflow task, run, and execution-chain timeouts also differ. A deadline closing authoritative work does not prove remote code has stopped. [T13], [T19]                                                            | Store absolute durable deadlines. Define scheduling delay separately from execution duration; do not reset a business deadline on every retry or restart. Test clock/late-result behavior.                                                    |
| Heartbeats/checkpoints           | Heartbeats report liveness and optional recoverable details. Calls can be throttled before transmission; retry code must interpret the last persisted checkpoint itself. A heartbeat is not a transaction with an unrelated external write. [T13]                                                                                   | A checkpoint must name the durable outputs it proves. Distinguish submitted, persisted, and committed progress. Crash after output write and before/after checkpoint to prove reconciliation.                                                 |
| Cancellation acknowledgment      | Cancellation is cooperative. For normal Activities, delivery is tied to heartbeating; cancellation mode controls whether the Workflow waits for acknowledgment. Returning a cancellation result does not necessarily mean Activity code or an external effect has ceased. [T17]                                                     | Separate cancellation requested, authority revoked, provider stopped, cleanup complete, and terminal settlement. Define precisely what `Task.done` guarantees.                                                                                |
| Termination and forced shutdown  | Workflow termination closes the execution without running Workflow cleanup. Forced SDK worker shutdown can require process exit and skips ordinary cleanup. Neither is rollback of outside effects. [T06], [T18]                                                                                                                    | Report incomplete cleanup and possible external effects after forced termination. A thread or process kill is an isolation tool, not a compensation protocol.                                                                                 |
| Persisted Workflow pause         | Current Workflow pause is **Pre-release**, with Cloud invitation or self-hosted feature prerequisites. It blocks new dispatch; in-flight Activities continue. Timers/deadlines advance. Signals can be accepted, while Queries/Updates are rejected. Child Workflows are not automatically paused. [T20]                            | A persisted Utils pause can be valuable if its exact semantics are clearer and tested. Define intake, timers, inflight work, deadlines, children, cancellation, and cleanup explicitly before implementation.                                 |
| Activity operator controls       | Activity pause/reset/update operations are **Public Preview**, with version/flag prerequisites; standalone cancellation/termination/deletion have a different GA contract. Activity pause mainly prevents retries; heartbeating work can receive a pause-specific cancellation. Schedule-to-close continues advancing. [T21], [T22] | Separate administrative rescheduling from workflow-driven behavior. Never silently turn a live attempt into a resumable checkpoint. Operator commands need durable identity, conflict behavior, audit, and safe stale-attempt handling.       |
| External effects and idempotency | Activity execution can repeat after an effect committed but before completion was recorded. Stable idempotency keys, transactional domain storage, or reconciliation remain the application's responsibility. A unique run or successful replay does not establish exactly-once arbitrary HTTP effects. [T23]                       | Preserve the current same-database fenced transaction/receipt contract. For S3/HTTP/browser actions use provider idempotency, content-addressed writes, an outbox, or explicit reconciliation. State the effect contract for every guarantee. |
| Reset, compensation, and cleanup | Reset creates a new execution from a history point; it does not reverse previous external effects. Cancellation-aware cleanup and application compensation can be modeled, but termination cannot execute that cleanup. [T17], [T18]                                                                                                | Retrying or resetting an operation requires a new attempt identity without losing the stable business-effect key. Durable cleanup and local resource disposal need separate owners and failure reporting.                                     |

### Composition, long-lived work, schedules, and deployment

| Capability                   | Temporal's actual contract and limits                                                                                                                                                                                                                                                            | Implication for Utils / evidence required                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signals                      | Signals durably deliver data to a Workflow without returning the handler's business result. Service acceptance and handler completion are different events. [T24]                                                                                                                                | Expose accepted versus consumed versus processed. Test signal-before-wait, duplicate command delivery, signals racing completion, and restart with pending handlers.                                                                      |
| Queries and Updates          | Queries read state without adding history and require a responding worker. Updates can validate before acceptance and return durable handler results. Async handlers can interleave at awaits; application invariants still need coordination. [T24]                                             | Do not treat an in-memory observer as a durable query/update API. Define read consistency and command-result retention; schema-check external commands and persisted values.                                                              |
| Child Workflows              | Child start and completion are distinct waits. Parent-close policies include terminate, request cancellation, and abandon; default termination is consequential. Child cancellation and routing have explicit options. [T25]                                                                     | Bound fan-out and define ownership. Prove parent loss, child completion before parent parking, cancellation propagation, and orphan handling. Preserve child identity through parent replay.                                              |
| Continue-As-New              | A completed run hands explicit state to a fresh run with the same Workflow ID, different Run ID, and fresh history. Application code must carry needed state and finish handlers appropriately; it is not a stack snapshot. [T26]                                                                | Current audited Utils rejects this instruction. A real implementation needs atomic chain advancement, state/identity rules, input compatibility, dedupe across contracts, and bounded replay/history. A convenience loop is insufficient. |
| Schedules and backfill       | Schedules are separate durable objects. They support overlap policies, catch-up windows, pause, triggering, and backfill. Backfill starts eligible historical occurrences now, subject to policy; deleting/pausing a schedule does not cancel runs already started. [T27], [T28]                 | Durable timers are not a full scheduling product. Define timezone/DST, missed-run policy, overlap, catch-up bounds, occurrence identity, and edit/delete races before claiming schedule parity.                                           |
| History and payload limits   | Workflow history and pending operations are bounded; long-lived jobs need batching, child runs, or continuation. Large artifacts belong outside history. Current Cloud limits are summarized separately below. [T29]                                                                             | Establish explicit input/history/output limits and typed rejection. Measure replay cost and retained-record scans. Retention configuration without a collector is not actual storage lifecycle management.                                |
| Worker versioning            | Deployment versions support pinned and auto-upgrading Workflows, current/ramping versions, and draining. Pinned runs require their compatible workers to remain available. Auto-upgrading code still needs replay compatibility. [T30], [T31]                                                    | A fingerprint mismatch that safely blocks is useful, but not a complete upgrade mechanism. Document compatibility strategy, migration/roll-forward, and an operator path for blocked runs.                                                |
| Rollouts and compute scaling | The Kubernetes Worker Controller is **GA** and manages per-version deployments, rollout gates, draining, and HPA/KEDA resources. Serverless Workers support Lambda/Cloud Run in **Public Preview**, with other provider maturity differing. [T32], [T33]                                         | The existing providers do not establish container launch or autoscaling. Keep a clear provider contract now; add topology management only with a real controller, metrics, drain behavior, and failure tests.                             |
| Cross-service orchestration  | Nexus exposes synchronous/asynchronous operations across service contracts and namespaces, with retry and cancellation contracts. Some operation kinds are still pre-release. Its deduplication and workflow-start semantics do not make arbitrary downstream effects exactly once. [T34], [T35] | A future remote provider/domain service needs authenticated capability, timeout, cancellation, idempotency, and result contracts. Copying a local PostgreSQL transaction token over IPC is not a valid authority bridge.                  |

### Progress, operations, resilience, and security

| Capability                          | Temporal's actual contract and limits                                                                                                                                                                                                                                                                                                       | Implication for Utils / evidence required                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visibility and search               | Visibility provides indexed filtering/counting and custom Search Attributes. The index is eventually consistent; search results are unsuitable as the sole transactional acceptance/uniqueness authority. Search Attributes are metadata outside payload-codec protection. [T36], [T37]                                                     | Provide direct authoritative inspection by run/attempt ID separately from dashboards/search. Prevent sensitive content entering labels/search metadata. Explicitly expose index lag where relevant.                                                |
| Logs, metrics, tracing              | SDK/platform telemetry supports operational metrics and tracing propagation across workflow relationships. Logs, spans, and approximate counters are observations, not durable business outcomes or a billing ledger. [T38]                                                                                                                 | Correlate command, logical run, execution run, attempt, provider, artifact, and receipt. Expose queue age, heartbeat age, retry cause, cleanup state, and outstanding ownership. Persist business progress separately.                             |
| Durable progress streams            | Workflow Streams is **Public Preview**. It offers offset-based reconnects and durable workflow-backed events, with modest fan-out. Publisher buffering needs flushing; retries of an Activity can create distinct publishers. Truncation can advance lagging readers; workflow closure can precede delivery of the last event. [T39], [T40] | A typed, bounded progress log with explicit gaps, acknowledgments, terminal outcome, and post-completion reads could be useful. This needs end-to-end delivery tests; “Temporal has no progress stream” is no longer accurate.                     |
| Testing and replay                  | Temporal supports time-skipping tests, Activity test contexts, worker/client integration tests, and replay against captured histories. Replay detects command compatibility; it does not simulate every network, storage, process, or provider failure. [T41]                                                                               | Combine deterministic tests with real-process/real-database failures. A test must observe the intended contract independently and include a negative control against false passes.                                                                 |
| Self-hosting and embedded operation | Self-hosting requires operating service components, persistence, visibility, upgrades, and security. Temporal also documents embedding its Go server. The SQLite embedding example is for development/testing, not a production multi-node architecture. [T42], [T43], [T44]                                                                | Potential advantage: an application-native JS/TS library using an existing PostgreSQL system. Measure actual deployment/upgrade complexity; do not claim Temporal has no embedded option.                                                          |
| Cloud and operator responsibility   | Cloud manages the Temporal service, while application worker code, external effects, and much deployment behavior remain the customer's concern; the serverless preview adds supported compute lifecycle integration. A service SLO is distinct from end-to-end application availability. [T33], [T45], [T46]                               | State the supported topology and ownership. A library cannot promise service availability without a defined database, worker, backup, restore, monitoring, and operational model.                                                                  |
| Regional resilience                 | Cloud documents three-AZ service operation and optional asynchronous active/passive multi-region/multi-cloud replication with one active writer. Worker regional deployment remains necessary. Self-hosted multi-cluster replication is documented as experimental and requires operational failover handling. [T45], [T47]                 | Local lease recovery is not regional HA. Database failover, replication loss, split authority, regional routing, and external-effect reconciliation require separate test.                                                                |
| Security and access control         | Cloud supports TLS, client authentication, access roles, and optional client-side payload encryption. Self-hosted TLS/authorization must be configured; the default no-op authorizer is permissive. Payload encryption does not conceal every routing/search field. [T37], [T48], [T49], [T50]                                              | Define trust contracts for local/thread/process/remote providers and operator commands. Enforce namespace and capability authorization where the API crosses a trust contract. Never put credentials in durable inputs or diagnostics by accident. |
| Audit, retention, and cost          | Cloud control-plane audit logs do not cover every workflow data-plane operation. Retention, archival/export, application audit, and cost accounting are distinct. Cloud action consumption can increase with retries and activity/history operations. [T29], [T51], [T52]                                                                   | Persist operator changes and business receipts independently. Compare all-in cost per successfully completed workload, including retries, DB/storage/egress, idle capacity, cleanup, and operating effort. No measured cost advantage exists yet.  |

## Concrete limits relevant to Crawl-shaped work

These are current **Cloud** limits from [T29], not universal constants for every self-hosted deployment:

| Boundary                      | Documented value                                                              | Design consequence                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Workflow history              | Hard limit 51,200 events or 50 MB; warnings at 10,240 events or 10 MB         | Use bounded crawl batches and deliberate continuation/children.                       |
| Payload / transaction message | Payload 2 MB; gRPC/history transaction 4 MB                                   | Store page bodies, WARC/WACZ, screenshots, and extraction bundles externally.         |
| Pending operations            | 2,000 per supported operation category; documentation recommends 500 or fewer | A million-URL crawl is not a million simultaneous child/activity commands in one run. |
| Signals and Updates           | 10,000 Signals per run; 10 in-flight and 2,000 total Updates                  | Progress/control channels also consume bounded resources.                             |
| Closed-run retention          | Default 30 days; configurable 1–90 days                                       | Application artifact and receipt retention need their own policy.                     |

These limits do not establish a recommended Utils limit. Choose Utils bounds from replay latency, SQL contention,
storage growth, memory, and required operational behavior, then test them with realistic Crawl input sizes.

## What the supplied Utils snapshot already establishes

The audited archive is `utils(3).zip`, SHA-256 `5776ccf0726deb02f6ab865e73248ba53d7a2b5e9657feaf90ff06d0bd2fd7b2`. The
original upload was preserved; the prior candidate changes two files. Local audit (research-workspace reference)

| Area                   | Evidence currently available                                                                                                                                                                                                                                               | Remaining contract                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Durable runtime        | PostgreSQL acceptance, saved instructions, jobs/attempts, lease generations, timers/events, child/branch waits, cancellation, and durable cleanup exist.                                                                                                                   | Existence is not proof under every race or deployment topology.                                                                                                                |
| Recovery starvation    | Two scans could spend their entire limited batch on rows owned by inactive runs. Four new real-SQL regressions failed on the original and passed on the candidate; candidate execution suite passed 27 cases.                                                              | Large-table cost, multi-host contention, and fairness of all other scans remain untested.                                                                                   |
| Transactional receipts | An independent parent connection observed one committed business append plus matching receipt while the first attempt remained unfinished. After `SIGKILL`, a replacement process completed with one total append, and duplicate command acceptance returned the same run. | This passed on both original and candidate. It proves a specific same-database publication contract, not the repair's necessity or arbitrary remote exactly-once effects.      |
| Real placement         | Source contains local, thread, and process providers; the execution suite includes process paths.                                                                                                                                                                          | The three provider conformance steps used in-memory transports. Real-thread behavior, all provider failure modes, browser workloads, and containers are not thereby tested. |
| Publication authority  | Local guarded PostgreSQL transaction/receipt support exists. Remote policies requiring those capabilities are explicitly rejected.                                                                                                                                         | A remote authority bridge or domain write service would need a separate design.                                                                                                |
| Long-lived runs        | Saved replay and history limits exist; continuation was explicitly unsupported in the audited snapshot.                                                                                                                                                                    | Retention policy storage is not automatic collection. Continuation, upgrades, retention, and replay cost need implementation/test.                                    |

The receipt test itself was strengthened after independent review: independent pre-kill DB observation, canonical
import provenance, and bounded/error-preserving cleanup. Its final reviewed SHA-256 is
`88d29b8c7f073729cdf7318c6963d7dd9799cbfdd4088a6436be8e9027d30a4d`. Premature-gate and wrong-checkout negative probes
reject. One dedicated disposable database must run one checks at a time because the runner installs shared
schema. Independent review (research-workspace reference)

## Credible differentiators to pursue as hypotheses

| Hypothesis                                               | Why it may matter for Crawl                                                                                                                      | Evidence needed before advertising it                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application-native atomic acceptance and publication     | Crawl already needs a domain database. Acceptance plus queued work, or domain mutation plus fenced receipt, can share that database transaction. | Failure injection before/after commit, rollback, stale-writer rejection, duplicates, DB failover, and correct application use of the public API.            |
| One clear task/control API across supported resources    | Developers can select local execution, a real thread, or a process without reimplementing terminal-state and cleanup semantics.                  | Conformance across real providers for values/errors, cancellation acknowledgment, bounded shutdown, crash, capacity release, and restart.                   |
| Durable progress with explicit delivery semantics        | Crawl needs pages discovered/fetched/published, durable artifact references, retries, and meaningful partial results.                            | Runtime schemas, stable event identity, cursors, explicit truncation/gaps, reconnect, bounded storage, terminal outcome, and post-completion consumption.   |
| Resource-aware admission close to the application        | Browser contexts, host memory, SQL capacity, and per-origin politeness have different constraints.                                               | Measured throughput/tail latency and memory bounds under mixed loads, tenant pressure, slow origins, retries, and cleanup.                                  |
| Lower operational burden for a defined workload envelope | A Node/Deno application plus an existing database may be easier to operate than a separate orchestration platform for modest deployments.        | Clean extracted-package install/run, upgrade/rollback/restore exercises, deployment component counts, and total cost per accepted quality-tested result. |

Each is a product hypothesis. None proves a universal advantage over Temporal, and none requires reproducing Temporal
Cloud, Nexus, every SDK, or multi-region infrastructure inside the first utility ZIP.

## Contracts to settle before pause or continuation implementation

### Persisted pause/resume

Use a durable run-control state distinct from the local task's cooperative pause. Specify:

- **Linearization:** the database transaction that acknowledges pause and the exact dispatch/claim decisions it
  excludes. Recheck under the same authority used for claim or advancement; enumeration alone is not permission.
- **In-flight policy:** allow already-authorized attempts to finish, request cooperative interruption, or invalidate
  publication authority. Do not combine these silently. Resume must not revive an invalidated attempt's lease.
- **Timers and deadlines:** either wall-clock deadlines continue, as in Temporal's documented pause, or the system
  explicitly persists adjusted deadlines. Pausing cannot accidentally reset a retry or business deadline.
- **Inputs and descendants:** define whether events/commands are accepted while paused and whether children continue.
  Acceptance, processing, and resulting activity dispatch need separate rules.
- **Control and cleanup:** cancel/inspect/resume must remain available, and control/finalizer work must not deadlock
  behind paused normal capacity. Terminal completion may legitimately race pause; document the outcome.
- **Operator result:** report requested, durable paused, and drained/quiescent separately if the product offers them.
  “Paused” must not imply every OS task stopped unless that stronger condition is independently observed.

Checks should race pause against claim, replay advancement, event arrival, timer maturity, result commit, lease
expiry, cancellation, and resume, including a fresh process reading the durable state. A test that only sees a local
promise blocked is insufficient.

### Durable continuation

Define a logical workflow identity and distinct execution-run identities. Atomically close the old run and create/link
the successor with explicit carried state. Specify who owns incoming events, dedupe keys, deadlines, child references,
receipts, progress cursors, and retention across the contract. Freeze or drain active handlers/branches according to an
explicit rule; do not drop them.

Checks must cover crashes before/after the transition commit, duplicate continuation requests, two competing
owners, observers reconnecting with the old handle, late events/results, replay with changed code, and bounded history
over many successive runs. The API should reject unsupported live state rather than imply it can serialize arbitrary
in-memory resources.

## Tests required before using the local ZIP

| Gate                            | Required proof                                                                                                                                                                                     | Scope classification                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Artifact and runtime provenance | Hash the source/archive, extract into a fresh path, resolve public exports to that path, install from its lock/config, and run supported Node/Deno consumer paths. Record actual runtime versions. | Required for a complete reviewable ZIP.                                            |
| Durable authority               | Acceptance, rollback, leases/generations, stale completion, loss of notifications, and restart from a genuinely new process. Observe durable state independently.                                  | Required baseline.                                                                 |
| Effects and receipts            | Same-transaction publication and receipt; negative duplicate/stale-owner probes; explicit strategy for nontransactional effects.                                                                   | Required baseline; remote exactly-once is not a claim.                             |
| Pause/continuation              | Implement only the chosen contracts above and test contract races and crash recovery. Keep unsupported states explicit.                                                                            | Required if included in the new API or documentation.                              |
| Real execution resources        | Actual worker-thread and child-process consumers, serialized errors/results, capacity release, forced loss, cancellation, and cleanup.                                                             | Required for each advertised provider.                                             |
| Queues and long-lived storage   | Fair recovery selection with retained inactive rows; bounded admission; realistic table/history growth; measured scans/replay; defined retention behavior.                                         | Required for documented bounds; sustained production scale remains later evidence. |
| Progress and operator control   | Authoritative run/attempt inspection, durable control commands, auditable transitions, reconnectable progress, explicit gaps/terminal result.                                                      | Required for advertised operator/progress features.                                |
| Upgrades and compatibility      | Replay old saved histories under intended changes, refuse incompatible data deliberately, document recovery/migration.                                                                             | Required for compatibility claims.                                                 |
| Infrastructure resilience       | Database restart/failover, multi-host contention, container placement/autoscaling, regional failover, network partitions, and actual browser stress.                                               | Separate topology checks; do not infer from local SQL/process tests.        |

The current evidence justifies improving this implementation and shipping a transparent, independently testable local
artifact. It does not establish production readiness, measured superiority over Temporal, a complete
scheduler/control-plane product, arbitrary code preemption, generic exactly-once effects, or multi-region/container
orchestration.

[T01]: https://github.com/temporalio/temporal/releases
[T02]: https://github.com/temporalio/sdk-typescript/releases/tag/v1.25.0
[T03]: https://docs.temporal.io/workflows
[T04]: https://docs.temporal.io/encyclopedia/event-history/event-history-typescript
[T05]: https://docs.temporal.io/workflow-definition
[T06]: https://typescript.temporal.io/api/interfaces/worker.WorkerOptions
[T07]: https://docs.temporal.io/task-queue
[T08]: https://docs.temporal.io/develop/worker-performance
[T09]: https://docs.temporal.io/task-routing
[T10]: https://docs.temporal.io/develop/worker-performance/runtime-tuning
[T11]: https://docs.temporal.io/develop/task-queue-priority-fairness
[T12]: https://docs.temporal.io/standalone-activity
[T13]: https://docs.temporal.io/encyclopedia/detecting-activity-failures
[T14]: https://docs.temporal.io/encyclopedia/retry-policies
[T15]: https://docs.temporal.io/local-activity
[T16]: https://docs.temporal.io/activity-execution
[T17]: https://docs.temporal.io/develop/typescript/workflows/cancellation
[T18]: https://docs.temporal.io/encyclopedia/workflow/cancellation-and-termination
[T19]: https://docs.temporal.io/develop/typescript/workflows/timeouts
[T20]: https://docs.temporal.io/encyclopedia/workflow/workflow-pause
[T21]: https://docs.temporal.io/activity-operations
[T22]: https://docs.temporal.io/activity-operations/pause
[T23]: https://docs.temporal.io/activity-definition
[T24]: https://docs.temporal.io/develop/typescript/workflows/message-passing
[T25]: https://docs.temporal.io/develop/typescript/workflows/child-workflows
[T26]: https://docs.temporal.io/develop/typescript/workflows/continue-as-new
[T27]: https://docs.temporal.io/schedule
[T28]: https://docs.temporal.io/develop/typescript/workflows/schedules
[T29]: https://docs.temporal.io/evaluate/cloud/limits
[T30]: https://docs.temporal.io/worker-versioning
[T31]: https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning
[T32]: https://docs.temporal.io/production-deployment/worker-deployments/kubernetes-controller
[T33]: https://docs.temporal.io/serverless-workers
[T34]: https://docs.temporal.io/nexus
[T35]: https://docs.temporal.io/nexus/operations
[T36]: https://docs.temporal.io/visibility
[T37]: https://docs.temporal.io/search-attribute
[T38]: https://docs.temporal.io/develop/typescript/platform/observability
[T39]: https://docs.temporal.io/workflow-streams
[T40]: https://docs.temporal.io/develop/typescript/workflows/workflow-streams
[T41]: https://docs.temporal.io/develop/typescript/best-practices/testing-suite
[T42]: https://docs.temporal.io/self-hosted-guide
[T43]: https://docs.temporal.io/self-hosted-guide/deployment
[T44]: https://docs.temporal.io/self-hosted-guide/embedded-server
[T45]: https://docs.temporal.io/cloud/high-availability
[T46]: https://docs.temporal.io/cloud/slo
[T47]: https://docs.temporal.io/self-hosted-guide/multi-cluster-replication
[T48]: https://docs.temporal.io/evaluate/cloud/security
[T49]: https://docs.temporal.io/cloud/manage-access
[T50]: https://docs.temporal.io/self-hosted-guide/security
[T51]: https://docs.temporal.io/cloud/audit-logs
[T52]: https://docs.temporal.io/evaluate/cloud/actions
