# Read the complete service and worker consumers

Use this page to find the complete setup for a service that accepts work and a separate worker that runs it. Start with
[the walkthrough](./01-basics.md) for the concepts or the [smaller import example](./14-consumers.md) to trace a request
from submission through approval and cleanup. The files below are part of the executable tests.
Core and Intelligence are the separate applications that inspired these import and research scenarios; neither is a
dependency you must install for the examples.

To follow one import in source, start at the HTTP route in `service.ts`. It saves the request and returns a reference.
Then open `core.ts` to see how Parse saves the rows, and `host.ts` to see which worker registers that activity. Finish
with the container test: it checks the saved job before any worker starts and checks the resolved accounts after a
replacement finishes.

| File                                                               | What to inspect                                                                                             |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| [service.ts](../../tests/workflows/scenarios/service.ts)           | SQL pool, clients, bounded HTTP input, atomic source/research admission, status, readiness, and shutdown    |
| [host.ts](../../tests/workflows/scenarios/host.ts)                 | Explicit role bindings, resource factories, `serve`, dependency checks, process signals, and joined cleanup |
| [core.ts](../../tests/workflows/scenarios/core.ts)                 | Activity definitions, implementations, source SQL, successor transaction, workflow loop, and policy         |
| [intelligence.ts](../../tests/workflows/scenarios/intelligence.ts) | Grant checks, HTTP capture, child workflows, publication SQL, expiry timer, and policy                      |
| [contracts.ts](../../tests/workflows/scenarios/contracts.ts)       | Schemas, resource declarations, provider failures, and test-only pause points                               |
| [schema.sql](../../tests/workflows/scenarios/schema.sql)           | All fixture-owned application tables                                                                        |
| [provider.ts](../../tests/workflows/scenarios/provider.ts)         | Receiver-side duplicate-request handling and raw-data closure                                               |
| [containers.test.ts](../../tests/workflows/containers.test.ts)     | Bundled deployment, private network, HTTP submission, worker kills, replacements, and database assertions   |
| [recovery.test.ts](../../tests/workflows/recovery.test.ts)         | Finer interruption cases with fresh Node and Deno child processes                                           |

## Separate required setup from fault-test setup

The service requires `DATABASE_URL` and `WORKFLOW_NAMESPACE`. The worker additionally requires `PROVIDER_URL` in this
combined fixture host. `WORKER_ID` distinguishes simultaneous containers even when each has PID 1. `WORKER_ROLE` selects
an explicit import, research, capture, publication, or combined binding list. `PORT` and `BIND` configure fixture
listeners. The container test sets these values directly and runs migration before starting either service or worker.

The role switch does not discover code or create dependencies. All bindings are visible arrays of imported
implementations. `bindParse(coreClient)` binds the one activity that accepts a follow-up run inside its transaction. The
body of that implementation is visible in core.ts. It is not a hidden worker setup routine.

`Gate`, `PAUSE_AT`, `PAUSE_ALL`, `FAIL_AT`, `RETRY_AT`, `LOCK_MS`, and `DRAIN_MS` support fault injection.
`host.before-serve` lets a test inspect readiness during startup. SIGUSR1 releases a paused process in the local
recovery suite. SIGKILL prevents cleanup and tests database recovery. These controls are not required by utils' public
workflow API.

## Keep application ownership visible

The service owns validation, authorization at its HTTP boundary, command keys, and response semantics. The worker owns
its pool, live resource collection, health listener, signals, and final kill deadline. The adapter borrows the pool and
owns saved execution state. Activities borrow resources and own their per-attempt cleanup. The deployment owns container
images, networking, credentials, restarts, and scaling.

The application owns business rules that utils cannot infer. These include source immutability, customer corrections,
mapping revisions, grants, capture identity, publication visibility, and deletion rules. The policies state the chosen
bounds and repeat-safety assertions. They are intentionally visible beside those domain rules.

Read [the API reference guide](./03-policy.md) for settings and [recovery](./04-recovery.md) before changing write
ordering.
