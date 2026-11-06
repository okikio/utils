# Testing

Tests describe public behavior and ownership. One authored `node:test` suite, with `@std/expect` assertions, runs on
Deno, Node and Bun wherever its capabilities exist. A host adapter, database or browser is tested in its actual
execution environment. A passing import or generated bundle does not substitute for those checks.

## Put the test beside its contract

Package-local `*.test.ts` files own behavior, edge cases, cancellation and cleanup for that package. Split a large file
by the caller's concern: for example, Duration construction, conversion, calendar arithmetic and rounding. Root `tests/`
holds cross-package scenarios and public consumer contracts. Its `fixtures/` directories contain data and companion
programs, not additional top-level test suites. Test orchestration lives in `tools/testing/`; build and benchmark
programs live in `tools/packages/` and `tools/bench/`.

`tools/testing/discover.ts` walks authored package, composition and tool tests in stable order. New ordinary tests run
on all three runtimes automatically. Only named host capabilities and resources have separate classifications. Run
`mise run test -- --suite list` to see each file's owner and reason. `mise run check -- --kind tests` inspects
TypeScript syntax without executing tests: a behavior test must register with its runner, and a compile-time fixture
must not be counted as a runtime pass. Misspelled selectors and empty selections fail.

## Write one readable behavior per case

A reader should understand the protected behavior from the suite name, scenario setup and assertions. This complete
example holds one resource, attempts a second acquisition, and checks that rejection leaves the first borrow intact:

```ts
import { describe, it } from 'node:test';
import { expect } from '@std/expect';

import * as context from '@okikio/context';
import * as pool from '@okikio/pool';

describe('pool waiting admission', () => {
	it('rejects overflow without taking the active borrower resource', async () => {
		await using ctx = context.create({ id: 'admission-test' });
		await using values = await pool.create({
			ctx,
			maximum: 1,
			maximumWaiting: 0,
			create: () => ({ ready: true }),
			close: () => {},
		});
		await using held = await values.acquire(ctx);

		await expect(values.acquire(ctx)).rejects.toBeInstanceOf(pool.PoolWaitLimitError);

		expect(held.value.ready).toBe(true);
		expect(values.stats()).toMatchObject({ leased: 1, waiting: 0 });
	});
});
```

The lease is disposed before the pool, then the context. An assertion failure follows the same cleanup path. Keep this
ownership visible. A fixture may prepare a database or a runtime, but it should not hide the action being tested or
register additional cases when imported.

Use separate `it()` cases for independently meaningful inputs. A table should contain names, plain data or fresh fixture
factories; do not construct consumable Responses or streams once and reuse them across cases. For a sequence that must
retain one live owner, awaited `test.test()` subtests can name its stages. The parent must join every subtest and every
background operation before it returns. Split large files by behavior, rather than adding another generic fixture layer.
Service runtime contracts now have separate pipeline, resource, request, response, observation and route files; Hash has
separate encoding, random, identifier, UUID, HMAC, optional-family and stream files.

The following lifecycle applies to an ordinary case and to a test-owned database partition. The failure branch matters:
cleanup is registered as soon as acquisition succeeds, before the first assertion. External child processes and
listeners also need an explicit stop and join. The chart omits runtime-specific setup flags.

```mermaid
flowchart TD
	A[Acquire scenario resources] --> B[Register cleanup immediately]
	B --> C[Run the named action]
	C --> D{Assertions pass?}
	D -->|Yes| E[Release borrowers and join active work]
	D -->|No| E
	E --> F[Close the owning pool, process or partition]
	F --> G[Report action and cleanup failures]
```

### Choose runner and assertion capabilities deliberately

| Tool                                                        | Useful capability                                                                                | Boundary to preserve                                                                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`node:test`](https://nodejs.org/api/test.html)             | Nested suites, awaited subtests, hooks, test-local cleanup, deadlines and native reporters       | Use concurrency only for independent resources. A timeout does not terminate an owned process or finish its cleanup.                                                      |
| [`@std/expect`](https://jsr.io/@std/expect/doc)             | Awaited promise matchers, partial object matches, identity checks and function-call expectations | Assert the intended failure class, code, status or cause. A generic rejection can pass for an unrelated earlier error.                                                    |
| [`@std/testing/mock`](https://jsr.io/@std/testing/doc/mock) | Spies and scoped stubs when call order or arguments are part of a contract                       | Restore replacements and preserve real providers in host test. The package advertises Deno support; test an added helper on every runtime that owns the test. |
| [`@std/testing/time`](https://jsr.io/@std/testing/doc/time) | Controlled global timers for isolated timer-driven code                                          | Prefer the utility's injected `TestClock` when available. Fake global timers cannot advance a PostgreSQL lease or prove a real process deadline.                          |
| [`@std/testing`](https://jsr.io/@std/testing/doc)           | Snapshots and compile-time assertions for suitable contracts                                     | Its BDD runner targets Deno. Keep the established `node:test` runner and compiler fixture ownership; snapshots should not freeze incidental diagnostics or private state. |
| `fast-check`                                                | Seeded, shrinkable input and operation-sequence properties                                       | Compare with an independent oracle or invariant and retain the failing seed/path.                                                                                         |

Use the installed runtime and package versions as the compatibility boundary. The current Node documentation can
describe APIs newer than this checkout's pinned runtime, and Deno/Bun do not necessarily implement every Node runner
feature. Run the same authored cases on their actual owners before adopting a runner-specific feature. There is no
requirement to use every testing feature in every suite.

One verified limit matters for cleanup: Deno 2.9.7 accepts `TestContext.after()` but does not run its callback. A green
case can therefore leave SQL rows or directories behind. Use lexical `await using`, a disposal stack, or `try…finally`
for portable per-case ownership. Native Node-only suites can use test-local hooks. Suite-level hooks are a separate
capability and remain useful for a tested shared fixture. After changing cleanup, inspect the actual resource: zero
owned SQL rows or removed directories provide evidence that a passing assertion alone cannot provide.

## Choose the task for the evidence you need

The format check covers code and configuration. Markdown keeps authored wrapping and code-block layout; the docs
suite separately checks marked programs and public-entry coverage.

Install the tools from `mise.toml`, then install the exact workspace dependencies:

```sh
mise install
mise run prepare -- --kind deps
mise run check
mise run test -- --runtime node -- packages/duration
mise run test -- --runtime deno -- packages/context
mise run test -- --runtime bun -- packages/input
```

| Task                                                | Evidence                                                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `check`                                             | Formatting, lint, root types, portable consumer types, export maps, package structure, test ownership and release version alignment |
| `test --runtime deno` (also `node` or `bun`) | Package tests and repository source tests on the selected native runtime |
| `test --suite comparisons --runtime deno`           | Independent library comparisons, with pinned competitor fixtures prepared explicitly; also accepts `node` and `bun`                 |
| `test --suite docs`                                 | Explicitly marked public examples compile and produce their declared results                                                        |
| `test --suite bundles`                              | Focused/umbrella bundle behavior and browser-selected import graphs                                                                 |
| `test --suite browser`                              | Real Chromium Input, Context, Collection/Schema, Duration and module Worker behavior through Playwright                             |
| `test --suite packages`                             | Built archives physically installed outside the checkout: Deno, Node ESM, Bun, inferred types and real Chromium             |
| `test --suite postgres`                             | PostgreSQL state, queue and durable workflow recovery, including real process death and restart                                     |
| `test --suite containers`                           | Docker worker recovery, streaming through nginx, physical PostgreSQL promotion and explicit real-browser duplex HTTP checks          |
| `test --suite soak`                                 | Opt-in two-hour PostgreSQL guarded writes, lease renewal and midpoint promotion; separate from ordinary CI                          |
| `bench --check`, `bench --operation freeze --check` | Untimed correctness oracles for the measured workloads                                                                              |

Prefix the task arguments above with `mise run` and a `--` separator. For example,
`mise run test -- --suite comparisons --runtime bun` runs the independent comparisons on Bun.

`mise run verify` checks source contracts, source tests and comparisons on Deno, Node and Bun, the native MCP examples,
README examples, bundles, installed packages and JSR source publication. Real browser, database, container and soak
suites remain explicit because they need their own environments. `mise run test` defaults to Deno source tests. Package
and Deno aliases delegate to Mise rather than maintaining separate command recipes.

The [duplex browser/container matrix](../../packages/activity/http/duplex.md#exercise-a-browser-and-an-isolated-host)
also needs the pinned Chromium, Firefox and WebKit binaries. Select its named files when checking only that capability;
the container suite as a whole includes unrelated databases and fault scenarios. A browser launch failure is reported
as a failed engine setup, not a passing transport test. Its optional root benchmarks stay outside ordinary benchmark
selection and share the same owned host fixtures.

Update the root and private Tools Playwright pins together, then prepare their matching browser binaries. The duplex
guide explains the macOS Firefox application-data startup failure fixed by the selected upstream version. A longer
timeout or a passing Chromium run cannot establish that Firefox starts and completes its own scenarios.

### Shared CI and release checks

[`.github/workflows/quality.yml`](../../.github/workflows/quality.yml) selects jobs for source contracts, the
Deno/Node/Bun matrix, native Chromium, installed packages, PostgreSQL recovery, container recovery, benchmark
correctness, documentation and native examples. Formatting and linting run as separate advisory checks. Every job checks
out the caller's commit and receives a read-only repository token. The runtime matrix, resource fixtures, pinned actions
and report retention are defined once in that workflow.

Ordinary CI calls it through the `quality` job. Its separate `changesets` job checks the Sampo plan with a read-only
repository token. The Release workflow calls the full quality workflow before either registry job can publish. The npm
job downloads the exact candidates tested there; the JSR job publishes source from the same revision.
See [the release guide](./03-releases.md) for setup and partial-release recovery.

Check names include the caller prefix. Ordinary CI reports `Quality / Source and public contracts`,
`Quality / Source on deno`, `Quality / Source on node`, `Quality / Source on bun`,
`Quality / Native Chromium contracts`, `Quality / Installed package consumers`,
`Quality / PostgreSQL queue and durable recovery`, `Quality / Container recovery` and `Quality / Benchmark correctness`.
Review branch-protection names when changing workflows; the release-metadata job is now `changesets`.

Install the browser before its source or package checks:

```sh
mise run prepare -- --kind browser
mise run test -- --suite browser
mise run test -- --suite packages
```

On a fresh Linux CI machine, `mise run prepare -- --kind browser --with-deps` also installs Chromium's system
dependencies. Playwright is an exact development dependency. The browser tool records the actual browser version and
exercised checks; browser-selected code executed by Node is labeled separately.

## Keep resource admission explicit

`test --suite postgres` requires `UTILS_TEST_DATABASE_URL` to select a disposable PostgreSQL database. The task forwards
it to all state, queue and workflow fixtures and fails before execution when it is absent. A selected queue test
therefore cannot silently become an environment-dependent skip. Each suite owns its tables or schema and cleanup. Run
database and container cases against fixtures intended for destructive crash/recovery testing.

Use PostgreSQL 18.3 for the complete task, matching the pinned CI fixture. The workflow adapter and its process fixtures
use `transaction_timeout`; an older server that lacks that setting cannot run this suite. A successful state-only or
queue-only test against another server version does not establish support for the complete workflow adapter.

```sh
UTILS_TEST_DATABASE_URL=postgres://fixture:fixture@127.0.0.1:5432/utils_test mise run test -- --suite postgres
mise run test -- --suite containers
```

The container task needs Docker. PostgreSQL tests use the supplied database and real Node/Deno children; they do not
need to provision their own database container. Deno source tasks declare fixture filesystem, child-process, system and
environment capabilities, and restrict network access to loopback. A source test that needs a new capability must state
why and belong to the appropriate owner.

For a PostgreSQL soak, read the result in this order:

1. Find the native task receipt for the exact invocation. It must say `status: "passed"`, `exitCode: 0` and
   `signal: null`. A log filename that contains `final` is not a pass result.
2. Check that the intended fault occurred. For the PostgreSQL soak, `fault.json` records the primary interruption and
   `promotion.json` records promotion of its standby. Continued writes without that interruption do not test failover.
3. Check `reconciliation.json`. It must confirm the exact business rows and durable receipts, including payloads,
   missing IDs, duplicate IDs and unexpected extra rows. A progress count alone cannot establish that result.
4. Confirm the task exited after its database dump, pool shutdown and container teardown. A successful reconciliation
   can still be followed by a cleanup failure, which makes the whole task fail.

The two-hour soak must complete one uninterrupted workload of at least 7,200 seconds. Do not add elapsed time from
failed or superseded attempts. Progress samples show what was observed at those times; they do not prove a continuous
memory plateau or production capacity. See [recovery tests](./07-recovery.md) for the tested faults and their limits.

## Public types are an independent contract

`mise run check -- --kind types` compiles the complete source with the pinned TypeScript compiler.
`mise run check -- --kind portable` checks separate browser, Web Worker and Node consumer environments without ambient
types from an unrelated host. Real browser overloads and small structural mocks must both infer correctly. Type fixtures
include accepted programs and `@ts-expect-error` calls that must fail for the intended reason. Files named
`types.test.ts` or `*.types.test.ts` are compiler fixtures, not empty runtime tests.

`test --suite packages` repeats public type and runtime scenarios against emitted, physically installed archives. The
consumer must be outside the source checkout, so ancestor resolution cannot accidentally satisfy a missing dependency.
Archive integrity, resolved JavaScript paths, runtime versions and complete diagnostics are retained under
`.tmp/artifacts/`. Native package tests never substitute workspace TypeScript for emitted code.

Native source tasks stream complete stdout and stderr to unique logs and write the selected files, real runtime version
and exit/signal receipt before returning. A five-minute Node default diagnoses stuck tests; an authored case can select
a justified timeout. CI retains test JSON/log reports and the container drill JSON/log/SQL evidence, on both success and
failure, for fourteen days. The AST audit recognizes registration calls; native runner results remain the authority for
which assertions actually executed.

## Exercise meaningful boundaries

Test malformed and partial input, exact limits, cancellation before/during work, ownership after failure, concurrent
operations, stale completion and retry exhaustion when the package provides those contracts. Generated properties use a
fixed seed and independent reference values. An optimized parser or router needs an independent oracle, not a copy of
its implementation. The [scenario catalogue](../06-scenarios.md) explains what each composition scenario proves.

Use entered/settled promises for races and `TestClock` for logical expiry. A generous timeout diagnoses a stuck test; it
is not a performance assertion. Stream tests compare concatenated bytes, not a runtime's chunk boundaries. Cleanup must
release the resources the test acquired even when an assertion fails. Do not change a behavior assertion merely to make
another runtime green: determine whether the issue belongs to the utility, test fixture or host contract.

Assert stable issue codes, error classes and affected fields when they are public contracts. Preserve caller-supplied
error and cancellation identity. Require exact diagnostic prose only when that prose is the documented result.

## Benchmark and report honestly

Use Mitata and the workload's untimed oracle. CI runs correctness checks, not noisy shared-runner speed thresholds.
`mise run bench -- /path/to/report` records isolated native samples, runtime metadata and hashes before/after the
measurement. Run timed experiments on an idle machine and report what each reference implementation omits. Read the
[benchmark guide](../benchmarks/01-running.md) before making a performance claim.

A test-file count is not a test-case count. Preserve native runner totals and diagnostics, especially when a runner
registers nested suites. A blocked runtime, browser, database or container remains unverified. CI configuration checked
locally is not evidence that a hosted CI execution has passed.

## Find the package contract

Start with the scenario name that describes the caller's behavior. Keep closely related setup beside those cases; move
static contracts or a reusable native companion into `fixtures/`. A fixture import must not acquire a resource or
register another suite. The package map below identifies the main reading path, rather than listing every file.

| Package    | Start with these test concerns                                                  | Benchmark correctness to preserve                     |
| ---------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Activity   | Host sharing, admission, exact host retirement, sessions and native providers   | Exact selected host and each activity result          |
| Authz      | Permission decisions, boundaries and explanation                                | Every decision, including denied targets              |
| Capability | Acquisition, borrowed sessions, release and invalidation                        | Resource use and final release counts                 |
| Collection | Catalog, iteration, safe keys and immutable results                             | Full key/value association and order                  |
| Context    | State projections, persistent commits, conflicts and late acknowledgement       | Progress delivery and subscription lifetime           |
| Dispose    | Reverse cleanup, repeated close and suppressed failures                         | Complete cleanup order and error identity             |
| Duration   | Construction, conversion, calendar arithmetic and rounding                      | Exact calendar results and invalid-input rejection    |
| Env        | Snapshots, provenance, validation and secret diagnostics                        | Exact parsed values and source selection              |
| Format     | Chunked CSV, sitemap parsing and malformed input                                | Full parsed records and URL sequence                  |
| Hash       | Digest vectors, streamed input, IDs and input limits                            | Complete digests and released stream locks            |
| Hono       | Request/response adapters and cancellation                                      | Status and consumed response body                     |
| HTTP       | Validators, streamed messages, replay and body limits                           | Each message identity and complete encoded output     |
| Input      | Discovery, expansion, gestures and feedback capability admission                | Exact discovery membership, expanded files and edits  |
| Pool       | Waiting admission, cancellation, reset and retirement                           | Borrower completion and joined shutdown               |
| Query      | Parameters, URLs, signed cursors and projections                                | Complete decoded bindings and URL values              |
| Result     | Aggregation, branch observation and iterator closing                            | Full successful results and original failure identity |
| Runtime    | Host adapters, file publication and network listener ownership                  | Written bytes and host lifecycle receipts             |
| Scheduler  | Admission, capacity, cooperative turns and mapping                              | Every mapped value; order where promised              |
| Schema     | Validation, diagnostics, recursive values and codecs                            | Full parsed trees, safe prototypes and issue paths    |
| Server     | Definitions, compilation, request dispatch and runtime teardown                 | Router decisions and body consumption                 |
| Storage    | State CAS, queue fencing, migrations and process recovery                       | Stored payload association and stale-write rejection  |
| Streams    | Framing, decoding, timed batches and cancellation                               | Complete bytes, text and batch sequence               |
| Task       | Progress, grouped children and terminal cleanup                                 | Result values and live progress projections           |
| Telemetry  | Record encoding, bounded queues, sink failures and observations                 | Complete public wire records and queue drain          |
| Utils      | Umbrella entry points and focused-package forwarding                            | Forwarded function identity and reference values      |
| Worker     | Handle, server, intermediate protocol, admission, cleanup and payload contracts | Receipt values and complete transferred chunks        |
| Workflow   | Declarations, composition, cleanup, replay and durable dispatch                 | Full dispatch results and placement decisions         |

Worker's `thread/fixtures/protocol.ts` contains explicit protocol doubles. Read the separate runtime and native
integration tests for real thread or process evidence. Workflow's `fixtures/program.ts` registers a local runner; it
borrows a scenario's history and does not establish persistence. PostgreSQL cases retain their shared database owner
while nested groups distinguish migration, admission, encoding, cancellation and recovery contracts.

## Keep each run separate from source

Native test receipts and temporary diagnostics belong under `.tmp/`; CI uploads selected reports from its own run.
Before benchmark correctness on a fresh checkout, run `mise run prepare -- --kind freeze` to create the ignored
treatment modules and inventory. Historical verification records are not inputs to current tests. See
[artifact ownership](./05-artifacts.md) for retention, local evidence recovery, and the distinction between a prepared
correctness check and a timed measurement.

For finite streaming pressure, a real nginx/gateway hop and physical PostgreSQL promotion, use the
[fault checks guide](./07-recovery.md). These root integration tests belong to `test --suite containers`;
ordinary package tests do not start Docker. Each run keeps new local measurements and failure logs under
`.tmp/tests/recovery/`.

The
[continuous PostgreSQL and lost-COMMIT-reply drills](./07-recovery.md#keep-writes-running-while-the-primary-is-unavailable)
add two 60-second guarded-write profiles and six protocol-controlled COMMIT interruptions. They use owned Docker
databases and reconcile exact note/receipt identities after physical promotion. New native reports use
`.tmp/tests/native/`; existing `.tmp/artifacts/` history and generated build/benchmark outputs remain in place.

For renewable claims and longer SQL lifetimes, run the
[lease and soak checks](./07-recovery.md#keep-permission-alive-during-a-long-database-run).
`mise run test -- --suite containers tests/workflows/postgres-leases.test.ts` covers live renewal and stale-owner
rejection. `mise run test -- --suite soak` is a separate opt-in two-hour Docker task. Its 90-second harness mode is
useful preparation, but only a completed run of at least 7,200 seconds counts as multi-hour evidence. Journals, SQL
dumps and native runner receipts remain in `.tmp/`. The normal container CI job does not run this longer task.

## Maintain examples that demonstrate a real result

Each imported binding must participate in the demonstrated job. A setup import belongs only where the example actually
needs that missing runtime API. The first runnable example must use the package it teaches and show a recognizable
outcome. A larger example adds another package only when it owns a needed rule or resource. Printing metadata or calling
a method merely to make an import look used is not evidence that the extra setup helps the reader.

Mark complete programs with `runnable` and give their expected output. Keep supporting fragments clearly separate from
the complete program. Run the documentation suite after changing a program so its imports, types and output are checked.
