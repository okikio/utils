> Research baseline, checked 2026-10-31. This page describes the Utils source before the changes listed in
> [the comparison index](./README.md). See [operations](../16-operations.md) for the current procedures and limits.
> Local workspace paths show where the research ran. Utils does not need those files to run.

# Temporal primary-source register

Checked **2026-10-31 UTC**. Companion to [the capability map](./temporal.md). URLs below are official Temporal
documentation/API pages or the official GitHub repositories. Documentation is rolling unless a release/commit pin is
specified. This research did not run Temporal or independently validate its service SLOs, costs, or performance.

## Release identity pins

- Server [release listing](https://github.com/temporalio/temporal/releases): `v1.32.1`, 2026-10-08, marked Latest;
  [full commit `af08a5e5f2dd40f545f2afac7780daaa6987001e`](https://github.com/temporalio/temporal/commit/af08a5e5f2dd40f545f2afac7780daaa6987001e).
- TypeScript SDK [release `v1.25.0`](https://github.com/temporalio/sdk-typescript/releases/tag/v1.25.0): 2026-10-27,
  marked Latest;
  [full commit `efafd16ef4533da24029277bd72caf564c7aa007`](https://github.com/temporalio/sdk-typescript/commit/efafd16ef4533da24029277bd72caf564c7aa007).
- Selected raw and GitHub SDK source-file fetches at the commit were blocked by the retrieval service. These are
  identity pins, not a claim that the implementation was audited. Live docs must be checked against the exact
  deployment/SDK before implementing an integration.

## Execution and recovery

| ID  | Primary source                                                                                              | Evidence used / checks                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| T01 | [Server releases](https://github.com/temporalio/temporal/releases)                                          | Release identity; 1.32 standalone Activity GA contract and gated operator features.            |
| T02 | [TypeScript SDK 1.25.0 release](https://github.com/temporalio/sdk-typescript/releases/tag/v1.25.0)          | Release identity; experimental features must not be silently presented as stable.              |
| T03 | [Workflows](https://docs.temporal.io/workflows)                                                             | Execution and durable waiting model.                                                           |
| T04 | [TypeScript Event History](https://docs.temporal.io/encyclopedia/event-history/event-history-typescript)    | Replay, stored completions, recovery of Workflow Tasks.                                        |
| T05 | [Workflow definition](https://docs.temporal.io/workflow-definition)                                         | Determinism and code/history compatibility.                                                    |
| T06 | [TypeScript WorkerOptions API](https://typescript.temporal.io/api/interfaces/worker.WorkerOptions)          | Workflow thread pool, capacity controls, forced shutdown; API documentation, not source audit. |
| T07 | [Task queue](https://docs.temporal.io/task-queue)                                                           | Pull dispatch and differing persistence of task kinds.                                         |
| T08 | [Worker performance](https://docs.temporal.io/develop/worker-performance)                                   | Slot/poller controls, resource tuning.                                                         |
| T09 | [Task routing](https://docs.temporal.io/task-routing)                                                       | Queue routing, affinity, SDK-specific sessions.                                                |
| T10 | [Runtime tuning](https://docs.temporal.io/develop/worker-performance/runtime-tuning)                        | Resource/custom slot suppliers and limits.                                                     |
| T11 | [Priority and fairness](https://docs.temporal.io/develop/task-queue-priority-fairness)                      | Activation, priority, weights, partition/version/restart scope, no preemption.                 |
| T12 | [Standalone Activity](https://docs.temporal.io/standalone-activity)                                         | Durable job execution, identity, retry/checkpoint model.                                       |
| T13 | [Detecting Activity failures](https://docs.temporal.io/encyclopedia/detecting-activity-failures)            | Timeout types, heartbeat persistence/throttling, cancellation.                                 |
| T14 | [Retry policies](https://docs.temporal.io/encyclopedia/retry-policies)                                      | Defaults and separation of task/activity/execution retry.                                      |
| T15 | [Local Activity](https://docs.temporal.io/local-activity)                                                   | Short local execution and queue/routing tradeoffs.                                             |
| T16 | [Activity execution](https://docs.temporal.io/activity-execution)                                           | Asynchronous completion and Activity lifecycle.                                                |
| T17 | [TypeScript cancellation](https://docs.temporal.io/develop/typescript/workflows/cancellation)               | Cancellation modes, acknowledgment, reset semantics.                                           |
| T18 | [Cancellation and termination](https://docs.temporal.io/encyclopedia/workflow/cancellation-and-termination) | Cooperative cleanup versus execution termination.                                              |
| T19 | [TypeScript workflow timeouts](https://docs.temporal.io/develop/typescript/workflows/timeouts)              | Execution-chain, run, and task deadlines.                                                      |
| T20 | [Workflow pause](https://docs.temporal.io/encyclopedia/workflow/workflow-pause)                             | Pre-release; exact dispatch/inflight/message/deadline behavior.                                |
| T21 | [Activity operations](https://docs.temporal.io/activity-operations)                                         | Public Preview and differing standalone GA operations; prerequisites.                          |
| T22 | [Activity pause](https://docs.temporal.io/activity-operations/pause)                                        | Retry suppression and heartbeat-specific pause response.                                       |
| T23 | [Activity definition](https://docs.temporal.io/activity-definition)                                         | At-least-once attempts and external-effect idempotency.                                        |

## Composition, deployment, progress, and testing

| ID  | Primary source                                                                                                            | Evidence used / checks                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| T24 | [TypeScript message passing](https://docs.temporal.io/develop/typescript/workflows/message-passing)                       | Signals, Queries, Updates, handler interleaving/lifetime.                          |
| T25 | [TypeScript child Workflows](https://docs.temporal.io/develop/typescript/workflows/child-workflows)                       | Start/completion and parent-close/cancel policies.                                 |
| T26 | [TypeScript Continue-As-New](https://docs.temporal.io/develop/typescript/workflows/continue-as-new)                       | Fresh run/history, explicit state, handler constraints.                            |
| T27 | [Schedule](https://docs.temporal.io/schedule)                                                                             | Overlap, catch-up, backfill, pause semantics.                                      |
| T28 | [TypeScript schedules](https://docs.temporal.io/develop/typescript/workflows/schedules)                                   | SDK schedule operations and existing-run distinction.                              |
| T29 | [Cloud limits](https://docs.temporal.io/evaluate/cloud/limits)                                                            | History, payload, pending operations, messages, retention; Cloud scope.            |
| T30 | [Worker versioning](https://docs.temporal.io/worker-versioning)                                                           | Pinning, auto-upgrade, ramping, draining.                                          |
| T31 | [Worker Versioning deployment guide](https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning) | Current deployment model and minimum versions.                                     |
| T32 | [Kubernetes Worker Controller](https://docs.temporal.io/production-deployment/worker-deployments/kubernetes-controller)   | Explicit GA label; gates, per-version resources and HPA/KEDA.                      |
| T33 | [Serverless Workers](https://docs.temporal.io/serverless-workers)                                                         | Lambda/Cloud Run Public Preview; provider maturity/limits differ.                  |
| T34 | [Nexus](https://docs.temporal.io/nexus)                                                                                   | Cross-service operation types, endpoints, asynchronous composition.                |
| T35 | [Nexus operations](https://docs.temporal.io/nexus/operations)                                                             | Delivery, retry, cancellation, idempotency scope.                                  |
| T36 | [Visibility](https://docs.temporal.io/visibility)                                                                         | Indexed search/count and eventual consistency.                                     |
| T37 | [Search Attribute](https://docs.temporal.io/search-attribute)                                                             | Search metadata and encryption/sensitivity contract.                               |
| T38 | [TypeScript observability](https://docs.temporal.io/develop/typescript/platform/observability)                            | Logs, metrics, tracing and propagation.                                            |
| T39 | [Workflow Streams](https://docs.temporal.io/workflow-streams)                                                             | Public Preview; ordering/dedupe scope, truncation, final delivery, modest fan-out. |
| T40 | [TypeScript Workflow Streams](https://docs.temporal.io/develop/typescript/workflows/workflow-streams)                     | Buffering, handler construction, client/continuation behavior.                     |
| T41 | [TypeScript testing suite](https://docs.temporal.io/develop/typescript/best-practices/testing-suite)                      | Time-skipping, integration, replay verification.                                   |

## Operations, resilience, security, and cost

| ID  | Primary source                                                                                                | Evidence used / checks                                                     |
| --- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| T42 | [Self-hosted guide](https://docs.temporal.io/self-hosted-guide)                                               | Service ownership and production concerns.                                        |
| T43 | [Self-hosted deployment](https://docs.temporal.io/self-hosted-guide/deployment)                               | Deployment components and persistence choices.                                    |
| T44 | [Embedded server](https://docs.temporal.io/self-hosted-guide/embedded-server)                                 | Go embedding exists; SQLite reference is development/testing.                     |
| T45 | [Cloud high availability](https://docs.temporal.io/cloud/high-availability)                                   | AZs; asynchronous active/passive regional replication; worker responsibility.     |
| T46 | [Cloud SLO](https://docs.temporal.io/cloud/slo)                                                               | Vendor service objectives; not this project's measured result or application SLA. |
| T47 | [Self-hosted multi-cluster replication](https://docs.temporal.io/self-hosted-guide/multi-cluster-replication) | Experimental status and operator failover responsibilities.                       |
| T48 | [Cloud security](https://docs.temporal.io/evaluate/cloud/security)                                            | Transport/client authentication and payload encryption model.                     |
| T49 | [Cloud access management](https://docs.temporal.io/cloud/manage-access)                                       | Access roles and account/namespace administration.                                |
| T50 | [Self-hosted security](https://docs.temporal.io/self-hosted-guide/security)                                   | Configurable TLS/authz; permissive no-op authorizer default.                      |
| T51 | [Cloud audit logs](https://docs.temporal.io/cloud/audit-logs)                                                 | Control-plane audit scope and data-plane exclusions.                              |
| T52 | [Cloud actions](https://docs.temporal.io/evaluate/cloud/actions)                                              | Consumption drivers; no price or cost advantage inferred.                         |

## Local authority

- Latest supplied workflow guide (research-workspace reference), its applying-standards guide and Temporal/utility
  references: contract/evidence framework.
- Latest utility usage guide (research-workspace reference), delivery guide (research-workspace reference), and Deno
  guide (research-workspace reference): package, runtime, and verification standards.
- Prior utility audit (research-workspace reference): source/execution evidence for the supplied snapshot and the narrow
  recovery candidate.
- Independent review (research-workspace reference): tested recovery repair, strengthened crash harness, negative
  controls, and limitations.

No local guide, test, or vendor document in this register establishes production reliability, cross-region failover,
full Temporal compatibility, or lower end-to-end cost for the improved Utils archive.
