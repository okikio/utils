# Test background work across failures

These tests stop real workers at known points and check what a replacement can recover. For example, an import can lose
its worker after a batch is saved but before the job reports success. The test checks that the replacement finishes
the import without losing a saved correction or writing that batch again.

Choose the suite for the failure you need to reproduce. Run both when changing the whole service-to-worker path:

| What you need to check | Command | What you supply |
| --- | --- | --- |
| Saved claims, receipts, and process restart | `mise run test -- --suite postgres` | Set `UTILS_TEST_DATABASE_URL` to a disposable PostgreSQL database. |
| HTTP service, worker-container loss, and replacement | `mise run test -- --suite containers` | Start Docker. The suite creates its own database and workers. |

Mise pins Node and Deno. Set `DENO_BIN` to select the binary for fresh-process cases. A missing database URL or Docker
daemon is a setup failure; the corresponding suite does not silently skip. CI runs the two suites separately from
ordinary source tests.

For a timer restart check, look for evidence that a future timer was saved before the worker stopped. Without that
checkpoint, a slow startup could let the timer expire before the test exercises recovery.

## Read the deployment test first

[containers.test.ts](../../tests/workflows/containers.test.ts) creates an isolated network and PostgreSQL container. It
bundles the actual service, host, and receiver source into ESM files. Each Node container receives those files directly.
It uses no host source mounts, host worker processes, or package downloads at runtime. Both Node and PostgreSQL image
references include digests. Testcontainers is only a development dependency.

The first case sends a real HTTP import while no worker is registered. It checks the queued database job and the absence
of imported rows. It replaces the HTTP service and repeats the same command key. It then starts an import worker and
pauses it after a row batch commits. Docker kills that worker with a zero-second stop timeout. The test adds a customer
correction while the worker is absent. A fresh worker completes the source and resolution. The test checks all original
rows, the correction, the same duplicate command reference, and at least two Parse attempts with one accepted success.
An extra attempt is valid if a busy worker misses a renewal. The saved receipt still prevents a repeated batch write.

The second case starts research without a capture worker. It checks that Capture remains queued and the receiver has
saved nothing. A separate capture-engine worker takes the job. The test kills it after the HTTP receiver commits but
before the activity records completion. A replacement completes Capture. Knowledge remains queued until a publication
worker starts. That separate worker completes the child workflow with one committed contribution. The test confirms the
raw body still exists and a future expiry timer is saved. It stops all scenario workers and the HTTP service. A new
service and research worker then reconstruct the timer and delete raw bytes when due. The contribution and duplicate
command reference remain intact.

These cases test the public service path and actual worker-container loss. They complement the finer process tests. They
do not replace them.

## Inspect a particular failure boundary

[recovery.test.ts](../../tests/workflows/recovery.test.ts) uses the supplied disposable PostgreSQL database. Its
execution hosts and capture receiver are separate local child processes. Each replacement starts without the previous
process's JavaScript state. The suite runs the same host TypeScript under both Node and Deno for the selected runtime
case.

| Failure or rule                                 | Evidence to read in the recovery suite                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Service response or transaction lost            | Matching duplicate command, native transaction rollback, foreign and expired transaction rejection     |
| Core batch or final source commit interrupted   | Named `core.rows.committed`, `core.source.committed`, and `core.batch.committed` kill cases            |
| SQL write interrupted before commit             | `core.rows.before-commit` rollback case                                                                |
| Customer state changes                          | Correction preservation, changed immutable bytes, stale mapping revision                               |
| Capture response or publication completion lost | Receiver-commit, Stage, and publication kill cases                                                     |
| Worker returns after replacement                | SIGSTOP/continue, stale registration, stale claim, and old completion rejection                        |
| Two workers compete                             | Concurrent take and replacement-generation cases                                                       |
| Cancellation races a write                      | Both lock orders, including expiry while a permitted write holds locks                                 |
| Repeating work is unsafe                        | Reconcile policy, unknown outcome, exhausted attempts, audited repair                                  |
| Exit activity crashes                           | Finalizer receipt reuse, exhaustion, targeted repair, reserved capacity                                |
| Waiting work loses its worker                   | Absolute timer reconstruction and independent expiry child cases                                       |
| Program or policy changes                       | Changed and shortened replay, pinned version, mixed live versions, unregistered policy                 |
| Saved data exceeds bounds                       | Input/result/history limits, including completed result evidence retained after history overflow       |
| Database or receiver is unavailable             | Readiness outage, recovery scan health, blocked renewal deadline, startup assembly                     |
| Worker shutdown stalls                          | SIGTERM joins cleanup; drain timeout stays visibly draining until hard process death                   |
| Raw-data lifetime ends                          | Duplicate receiver request after deletion, grant revocation, missing raw data, deferred expiry receipt |

## Know what a pause point proves

`Gate.reach(name, details)` is a test resource at a named boundary in application code. For example,
`core.rows.committed` runs after both the rows and their receipt commit. The parent waits for that event before killing
the worker. The event establishes when to interrupt. It does not prove the business result. The test checks PostgreSQL
rows, receipts, attempts, and public status for that proof.

Condition waits use deadlines and inspect actual progress. Timer cases leave room for startup before expiry and then
wait for the actual saved due time. They do not assume that a fixed sleep means a worker completed. A forced kill does
not run JavaScript cleanup. Graceful shutdown tests separately verify joined cleanup before closing borrowed clients.

## Run local programming-model tests

The portable suites cover different guarantees:

| Source                                                       | Guarantee                                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [Task tests](../../packages/task/mod.test.ts)                | Cooperative pause/cancel and terminal result after cleanup                         |
| [Activity tests](../../packages/activity/mod.test.ts)        | Checked input/result, declared resources, permissions, and implementation lifetime |
| [Engine tests](../../packages/activity/engine.test.ts)       | Allowed environment choices and normalization                                      |
| [Workflow tests](../../packages/workflow/mod.test.ts)        | Generator instructions and local control behavior                                  |
| [History tests](../../packages/workflow/history.test.ts)     | Reuse recorded local results and reject changed instruction identity               |
| [Dispatch tests](../../packages/workflow/dispatch.test.ts)   | Local queue ownership, attempt replacement, retries, and late-result rejection     |
| [Scheduler tests](../../packages/workflow/scheduler.test.ts) | Request handoff and local execution composition                                    |
| [Client tests](../../packages/workflow/client.test.ts)       | Inert client, typed validation, policy copy, and observation-only abort            |

An in-memory replay test does not prove recovery after process loss. A successful PostgreSQL crash test does not prove
an arbitrary external provider accepts duplicate requests safely. The source suites and package checks keep source,
artifact, runtime, and deployment evidence separate.

## Maintain the tests with the code

When changing a write, identify its business effect and receipt boundary first. Interrupt before commit and after commit
when both outcomes can differ. Check application rows as well as the workflow result. Keep the logical command key
stable when testing retries. Use a new namespace for independent scenarios. Stop only containers and processes created
by the test.

When changing worker placement, verify a job stays queued before its required role is online. Then verify another role
supplies the result. When changing timers, prove a future timer exists before stopping every relevant worker. When
changing shutdown, distinguish a requested stop from actual cleanup completion.

## Compare hosts and test wake-ups

[Execution tests](../../tests/workflows/execution.test.ts) run the same consumer program locally and in a fresh worker
process. They compare parallel, mapped, settled, retried, raced, and timed results. They also kill workers during saved
waits and an unfinished branch. Completed sibling work must remain completed. A relative timer must retain its original
deadline.

The suite terminates the notification connection separately from the worker. Reconnecting must scan saved rows. Other
cases check fallback polling, rollback, namespace isolation, idle scan counts, ready rows skipped while locked, and
completion between scanning and parking. A separate shutdown check proves that reconnecting does not leave an owned
notification session behind. The application query pool must remain usable after that subscription closes.

## Check waits and generator composition

[wait.test.ts](../../packages/workflow/wait.test.ts) checks the three `wait()` forms and their result types. It compares
the emitted instructions with the previous APIs. It also delegates waits through ordinary generators, supplies recorded
answers, and checks cancellation and invalid option combinations. `defer()` remains a cleanup request.

[execution.test.ts](../../tests/workflows/execution.test.ts) runs relative and absolute waits locally and in separate
worker processes. It kills each timer worker, starts a replacement, and checks that the saved deadline did not change.
The event cases deliver to saved parallel branches while no worker is alive. These tests use the unified API. The
Intelligence scenario uses `wait({ until })` for retention expiry. Core's receipt tests continue to cover interrupted
import writes. The application repositories are not test fixtures and are not modified by these suites.
