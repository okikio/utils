# Learn workflows

Choose the path that matches your task. The package [README](../../packages/workflow/README.md) and
[recorded-work recipe](../recipes/03-recorded-work.md) teach local replay with complete runnable programs; they require
no database. The durable chapters add explicitly configured persistence and executors.

| Your task                         | Read these together                                                                                | Outcome                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Learn the service-to-worker model | [Basics](./01-basics.md), then [Recovery](./04-recovery.md)                                        | Understand acceptance, attempts, saved results, and repeatable writes.             |
| Bind an application               | [Consumers](./02-consumers.md), [Policy](./03-policy.md), [Connected consumers](./14-consumers.md) | Locate complete setup and identify resources and policy your host supplies.        |
| Implement a saved wait or report  | [Events](./11-events.md), [Progress](./12-progress.md), or [Execution](./13-execution.md)          | Select the instruction and its persistence/observation contract.                   |
| Operate or repair saved work      | [Operations](./16-operations.md), with [Recovery](./04-recovery.md)                                | Inspect state and apply the documented maintenance procedure.                      |
| Study a full domain example       | [Core import](./05-core.md) or [Intelligence](./06-intelligence.md)                                | Trace one application flow without treating it as a required utility architecture. |

The chapter list below is a reference map, not a requirement to read all nineteen pages before using Workflow.

1. [01 — Basics](./01-basics.md): start with an ordinary function, then add activities, a service, a saved queue, and
   workers.
2. [02 — Consumers](./02-consumers.md): locate the complete executable examples and identify what the application
   supplies.
3. [03 — Policy](./03-policy.md): bind resources and choose limits, retries, readiness, and shutdown behavior.
4. [04 — Recovery](./04-recovery.md): follow a crash before or after a write and understand how a replacement continues.
5. [05 — Core import](./05-core.md): follow source bytes through parsing, committed rows, and account resolution.
6. [06 — Intelligence](./06-intelligence.md): follow capture, child workflows, publication, and expiry.
7. [07 — Tests](./07-tests.md): connect each failure window to an executable assertion.
8. [08 — Containers](./08-containers.md): inspect the service, workers, receiver, database, and cleanup ownership.
9. [09 — Design](./09-design.md): compare manual approaches, local scheduling, saved execution, and Inngest.

10. [10 — Local scheduling](./10-local.md): compose activities with an in-memory scheduler and recorded instruction
    results.

11. [11 — Events](./11-events.md): receive external events, retain early delivery, and recover saved waits.
12. [12 — Progress](./12-progress.md): save reports from activities and observe them from a service.
13. [13 — Execution](./13-execution.md): run the same program across hosts, use saved event waits and timers, wake idle
    workers, and recover interrupted branches.
14. [14 — Connected consumers](./14-consumers.md): inspect the complete process/thread setup, background trigger
    effects, standard progress, durable cleanup, HTTP integration, and recovery tests.
15. [15. Continuation](./15-continuation.md): create bounded root chains with fresh replay history and explicit cleanup.
16. [16. Operations](./16-operations.md): pause and resume admission, inspect saved work, prune expired families, and
    reproduce process-loss and queue-pressure checks.

17. [17. Placement](./17-placement.md): share bounded hosts, constrain nested activity work, and fence replaced compute paths.
18. [18 — Resource sessions](./18-sessions.md): preserve physical ownership, borrow through explicit leases, and recover lost references without silently replacing resources.
19. [19 — Physical hosts](./19-hosts.md): select one thread or process inside a provider pool, retire it safely, and reject stale references.

The [capability comparison](./comparison/README.md) maps Temporal, Inngest, Effect Workflow, and this implementation,
with dated primary sources and explicit remaining work.

The examples use application scenarios from Core and Intelligence. Their complete source lives in the repository's
`tests/workflows/scenarios/` directory. They do not install changes into either application repository.

The library records work and progress. The application owns authorization, business tables, remote-write safety, and
deployment. The recovery chapter explains why saving progress alone cannot make an arbitrary external write safe to
repeat.
