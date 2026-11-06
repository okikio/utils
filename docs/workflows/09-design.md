# Choose the right amount of workflow machinery

This page records current design boundaries and alternatives. For the working service-to-worker path, start with
[the walkthrough](./01-basics.md). Earlier design sketches are replaced by the current source-linked guides in this
folder.

## Add one guarantee at a time

| Need                                         | Use                                                     | What remains your responsibility                   |
| -------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| Run code and get a result                    | An ordinary function or Promise                         | Decide whether retry is safe                       |
| Pause or cancel local work and await cleanup | `task` and `context`                                    | Save business progress if needed                   |
| Reuse a checked named operation              | `activity.define`, `activity.implement`, `activity.run` | Bind its live dependencies                         |
| Control an in-process backlog                | `queue`                                                 | Persistence after process loss                     |
| Reuse recorded steps while memory survives   | Local workflow scheduler, history, and dispatch         | Durable storage and crash-safe effects             |
| Accept work before a worker is online        | Workflow client plus PostgreSQL adapter                 | Authenticated service and database deployment      |
| Recover several steps after worker loss      | Workflow program plus `serve` workers                   | Versioned programs and repeat-safe business writes |
| Run steps in different environments          | Activity engine declarations and separate workers       | Worker images, dependencies, and deployment        |

The saved queue and recovery loop belong together in the PostgreSQL adapter and `serve()`. A consumer should not create
separate claim-renewal or timer-polling code. The worker's `resources` supply application clients. They do not create
another scheduler.

A workflow does not make an arbitrary effect safe to repeat. Database writes need a shared transaction and receipt, a
unique business key, or equivalent safeguards. Remote writes need receiver deduplication or inspection and
reconciliation. The [recovery guide](./04-recovery.md) explains those gaps before the internal lock rules.

## Keep the words tied to one object

An activity is a kind of work. A job requests that activity once for a particular input. An attempt is one worker's try
at that job. A workflow is the program that requests steps. A run is one accepted invocation of an activity or workflow.
A worker is the process that calls `serve()`. An engine is the named environment that permits an activity to run there.
A container packages a worker process and its dependencies.

The implementation also uses **activation** for one short advance of a workflow program. It uses **claim** for temporary
permission to finish one attempt. It uses **fence** for rejecting a replaced worker's old permission. Those storage
terms belong in the recovery reference and internal comments. They should not be prerequisites for reading the first
submission example.

A **projection** is an application view derived from other data, such as accounts derived from source rows. It is not
another required workflow runtime object. The Core guide calls it resolved accounts and identifies the source rows that
determine it.

## Where Inngest fits

Here, Inngest means the external workflow product used by Intelligence. Data ingestion means the import or collection
work itself. An activity can do that work with either scheduler.

Inngest is a separate durable execution system. It records step results, schedules work, retries failed steps, and
resumes waits. Its Connect workers use an outbound persistent connection to receive work. That can supply the durable
scheduling owner instead of utils' PostgreSQL worker loop. See the official
[durable workflow explanation](https://www.inngest.com/docs/durable-execution/durable-workflows) and
[Connect worker guide](https://www.inngest.com/docs/durable-execution/deploying-functions/connect).

The current Intelligence consumer demonstrates that arrangement in `workers/knowledge/src/functions.ts` and
`workers/knowledge/src/host.ts` in the Intelligence repository. Its Inngest function invokes one utils activity attempt
per native step. The activity validates input and result, checks its declared dependencies, and awaits cleanup. The host
opens datastores and the Connect connection. Inngest owns step delivery, saved results, and retries. Application storage
still owns exact input bytes, grants, and publication visibility.

Choose one durable owner for a given run:

| Choice                     | Durable owner                         | What the application deploys                                                   |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| Current PostgreSQL profile | Utils adapter and `serve()` scan loop | PostgreSQL, HTTP admission service, and worker processes                       |
| Native Inngest             | Inngest service and native SDK steps  | Inngest service access and HTTP or Connect handlers with application resources |

Do not run a second durable retry loop inside the same Inngest step. Two independent owners can disagree about
completion and repeat an effect unexpectedly. A utils local activity can run inside an Inngest step without using
`workflow.client` or `workflow.serve`. The activity's `ctx.claim` is then absent because it is not a utils saved job.
Use the application's Inngest-safe storage contract there, not this adapter's claim-guarded transaction API. A native
Inngest adapter for the new client/serve protocol is not implemented. The container suite does not deploy or certify
Inngest.

## Current limits

The saved profile supports activities, children, relative and absolute timers, event waits, `parallel()`, `map()`,
`race()`, and `retry()`. It also supports direct activity roots, finalizers, cancellation, and audited repair. It
borrows a Postgres.js query pool and owns a notification connection while a worker subscribes. PostgreSQL 18 is used in
the integration tests. Other drivers and Drizzle transaction participation are not implemented.

The deprecated custom-host `wait(signal, input)` and generic workflow-level `effect()` have no durable
implementation and block with `unsupported_instruction`. Background triggers have a separate supported acceptance
contract. Durable `defer()` saves activity or child cleanup when policy requires `workflow.cleanup` and reserves cleanup
capacity. Bounded root `continue()` starts a new segment only after registered cleanup settles; it needs a finite
`maxContinuations` policy budget and cannot run inside branches or children. See [cleanup and execution](./13-execution.md)
and [continuation restrictions](./15-continuation.md). Suspending a saved workflow does not run generator `finally` code. No automatic code discovery,
code download, container creation, or autoscaling occurs inside `serve()`.

Retention settings are minimum preservation obligations. The application schedules explicit bounded
`store.prune({ limit })` passes; the worker starts no automatic retention loop. Pruning protects live families and the
required evidence windows. Read [operations](./16-operations.md) for preservation and migration rules before deleting
saved history or upgrading a deployment.

The local tests prove selected recovery and lifecycle behavior with real PostgreSQL and separate containers. They do not
prove database failover, a Kubernetes rollout, multi-region safety, sustained throughput, or an arbitrary provider's
duplicate-request behavior. Adding those claims requires separate failure drills against those actual systems.
