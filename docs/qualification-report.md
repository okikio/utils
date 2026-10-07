# Utility qualification receipt — 2026-10-07

This is the initial qualification snapshot. The subsequent [comparison receipt](./comparison-report.md) records the Hono
and alternative fixtures, disposal ponyfill, additional defects, refreshed artifact gates and measured performance.
Counts and hashes below describe the initial snapshot and are preserved as historical evidence.

## Summary

The supported source and npm qualification gates pass. The review covers 42 source packages, 133 canonical test files,
10 consumer scenario records, and 15 measured benchmark programs with 200 cases. The exact 41 portable npm archives were
extracted, inspected, installed outside the checkout, and exercised through 290 public subpaths in ESM and CommonJS. No
package was published and no repository Git state was changed.

[Machine-readable results](./qualification-results.json) record commands and scope. Raw reports, source hashes,
validator logs, release fixtures, and exact archive hashes are preserved locally under
`.artifacts/qualification/20261007`. This ignored directory contains execution evidence, not production source. Issue
#1's technical qualification is implemented; its lockfile commit requirement remains pending in this already heavily
modified checkout. A successful local gate does not establish a hosted GitHub Actions run.

## Which repository supplied the useful changes

[The comparison](./comparison.md) records exact revisions and PR provenance. Core supplied useful narrow behavior:
thrown `undefined` remains a task failure; native errors retain safe names; nominated connection headers are removed;
query parsing gains bounded Boolean grammar, lossless URL values and pagination; CSV gains maintained grammar,
occurrences and writers; static definitions retain exact identity; process cleanup waits for confirmed exit rather than
treating a denied signal as termination. Those behaviors are retained and tested in standalone owners.

Standalone Utils has the stronger ownership foundation for clocks, admission, cancellation, process/Worker lifetimes,
and fenced executor generations. It also retains prepared routing and parsing/composition packages absent from the
copies. Replacing that foundation with a newer copied closure would lose explicit invariants. Qualification found
additional pool admission/health/drain and Worker races in the earlier reconciliation; those were repaired where the
standalone owner controls them.

MediaD supplies authentic compositions: bounded downloads, conversion jobs, lazy storage and their cancellation and
cleanup boundaries. These make better teaching and scenario evidence than importing MediaD's product policy or replacing
generic owners. Its CSV delimiter policy is a compatibility choice, not automatic evidence of a better parser.
Endpoint-owned clients, roles, signing, gateway policy and draft polling remain separate proposed capabilities: they
need explicit public lifecycle, trust, cadence and fairness contracts before adoption.

The refreshed AST comparison found no additional production port beyond Core's removal of Hono; standalone retains its
useful, independently tested adapter. The latest 20 PR file lists and all 13 open Core PRs were reviewed, including
older active work outside that window. Existing process regressions already protect still-open PR #279's settlement
behavior. AST equality identifies likely sameness; it cannot prove runtime, export or dependency compatibility.

## Qualification matrix

[qualification.json](./qualification.json) assigns each of the 42 packages its programming model, behavior, invariant,
scenario, runtime and benchmark evidence. The checker rejects missing packages, stale files, unreviewed tests and vague
records. It is a selection contract, not a claim that a listed command has run. Execution receipts are separate.

Every package has a performance question. Empty/setup-only surfaces use import/setup evidence instead of an invented
operation. The registry explicitly describes comparisons that omit utility guarantees and source-only runtime
applicability. Forty-one packages have portable npm projections; `@okikio/deno` and Deno-specific adapters do not.

## Test-quality findings

Shared live service contexts were replaced with separately owned contexts and controlled clocks. Stream cancellation now
waits for the actual pull boundary, verifies the exact cancellation cause, and proves reader release. Diagnostic
assertions use public codes, locations, classes and identity rather than CSS/configuration/workflow error prose.
Unordered query issues are compared without incidental order. Native child cleanup is registered immediately. Redundant
root groups were consolidated while preserving distinct cross-package scenarios.

The fragile-pattern AST audit rejects known synchronization and async hazards. Its seven retained occurrences have six
narrowly explained exceptions, including observed native OS state polling and cleared watchdogs; those checks are not
speed thresholds. Independent fault controls test the audit and qualification tools. Static scanning does not replace
manual intent review, and it is not a general proof of absence of all flaky behavior.

## Scenario coverage

[The catalogue](./scenarios.md) identifies inspected Platform, Crawl, MediaD and Core call patterns, owners and
failures. It covers CRM/discovery parsing, asset/body ownership, bounded queue/pool work, media process orchestration,
Worker request/reply and reverse authority, restartable providers, service lifecycle and forwarding, lazy resource
storage, and workflow execution/replay. The scenario records distinguish real consumer origins from reconstruction
fixtures.

Five compositions also execute against installed npm archives in both ESM and CommonJS: discovery/CRM, queue/pool retry
and invalidation, HTTP body ownership, history replay and lazy provider isolation. Other catalogued source scenarios do
not inherit this stronger artifact claim merely because their packages import successfully.

## Property and invariant coverage

Deterministic generated CSV inputs use an independent quoted encoder, 100 generated cell sets and chunk sizes 1–31. The
large streaming fixture proves incremental pulling across 10,000 rows. Line streaming checks every independently known
line across byte boundaries; blocked consumers prove bounded producer progress, and failed consumers prove upstream
return. Retained properties cover normalization, encoding, ordered mapping, retry bounds, routing equivalence, lease
fencing and deterministic replay. Seeds are fixed and expected values do not come from the parser under test.

## Benchmark findings

Every timed program has an independent fixture preflight. Mitata consumes results, awaits work, and throws failures. The
JSON validator checks nonempty samples and statistical consistency rather than imposing speed limits.

| Area                     | Question, workload and comparison                                                                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSV                      | Startup, 10,000 five-column rows, and 256 quoted Unicode/newline rows with 1 KiB payloads; collect versus 64 KiB/31-byte streaming. npm `csv-parse` and JSR `@std/csv` provide raw-tokenizer cost references, with exact cell checks and explicitly different document contracts. |
| Env and values           | Typed config and 100-value validation/lookup/conversion; direct Zod, native Map/record/Date and JSR semver where corresponding outputs are independently comparable. Utility diagnostics and ownership have additional costs.                                                     |
| Queue, pool and dispatch | 1,000 full claim lifecycles, repeated warm leases, fenced placement, and 100 jobs sharing four providers; native FIFO/value access show primitive costs without pretending to provide leases or shutdown.                                                                         |
| Router and HTTP          | 256 requests across 16/256/4,096 routes, HEAD and misses against an independent linear oracle; consumed response bodies, headers and direct Hono versus adapter work. These are Fetch operations, not network throughput.                                                         |
| Contracts and lifetimes  | Accepted/denied policy, bounded meters, owned cancellation/cleanup, ordered mapping and streaming; JSR pooledMap compares successful values while failure ownership remains different.                                                                                            |
| Worker and process       | Actual cold Worker launch, validated warm round trips, native child capture and joined cleanup; raw Deno.Command omits bounded capture/lifecycle contracts.                                                                                                                       |
| Workflow                 | Instruction identity is labelled identity-only; a separate executed activity and replacement Scheduler replay must invoke the provider once. Memory survives owner replacement, not process death.                                                                                |
| Imports                  | Every source root and every portable installed npm root, selective Result and eager `utils/all`, in fresh children; empty child measures launch/exit overhead. Dependency and OS caches can be warm.                                                                              |

Earlier benchmarks were redesigned where their names implied work they did not perform: identity hashing now has a
separate execution/recovery case; route scaling exercises many late hits and misses; stream fixtures verify all cells
and lines; queue/pool cases include the lifecycle their names claim. No npm or JSR implementation is described as an
equivalent replacement where its contract is weaker.

The 200 cases completed in about 245 seconds of measurement on the owned ARM64 Linux runner with a two-CPU quota and 2
GiB memory cap. Median prepared routing for a complete 256-request batch was 0.421/4.116/71.286 ms at the three route
sizes, versus 3.921/72.056/879.634 ms for that linear oracle. Cold Worker echo plus cleanup was 31.527 ms; warm echo was
0.119 ms. These answer scaling and warm-provider decisions for these fixtures, not universal speed claims.

Native npm selective Result imports were about 17–19 ms including child launch, near the 16–17 ms empty-child baseline;
eager `utils/all` was about 132–145 ms. This supports selective adoption for startup-sensitive callers. CSV's 10,000-row
collect median was 28.629 ms versus raw parser references 15.533/19.533 ms: richer document projection is a real cost,
and this evidence does not justify a blanket fastest-parser claim.

Raw samples, percentiles, heap availability, runtime, caches, GC policy, quotas and before/after input hashes are
preserved. Parent V8 heap samples do not measure peak process/Worker RSS or establish leak bounds. No pre-change
performance baseline or production distribution was available. After measurement, an untimed preflight color policy and
source/CI checkers changed; timed modules, production inputs and exact archives stayed unchanged.

## Runtime and packaging

Deno 2.9.7 source is canonical and JSR manifests remain authoritative. Node 26.10.0 executed 121 selected source tests
and every one of the 290 portable artifact paths in both formats. Stable tsdown emits `.mjs`/`.cjs` with
`.d.mts`/`.d.cts`, external package dependencies and staged manifests. Oxc inspection rejects leaked runtime Deno, JSR
and TypeScript imports. Clean installation is outside the checkout, so ancestor workspace resolution cannot conceal
missing packages.

All 41 exact archives pass strict publint and arethetypeswrong's modern `node16` resolution profile. That profile names
resolution modes, not supported Node 16 execution. Strict TypeScript 7 checks all paths and five real compositions in
both formats without skipping declaration checking. The supported TypeScript 6 declaration API is distinct from the
TypeScript 7 CLI. JSR compatibility dependencies use the documented `@jsr` npm scope registry.

Selective checks execute eight emitted consumers and inspect every chunk's retained modules. Byte counts are
informational; valid constant folding and helper chunks are permitted. Explicit polyfill entrypoints keep their side
effects. Browser-conditional CSV has selected bundle/Web API evidence only. Whole-library browser, Bun, Windows,
Node-native Worker backends and deployed persistent recovery are unqualified.

## Repository cleanup

Generated npm trees, archives, benchmark reports and investigative programs stay in ignored `.artifacts` or private
execution storage. Canonical tooling lives under `tools/`, contributor tasks under `.mise/tasks/`, and behavioral
fixtures beside tests/benchmarks. Baseline files, index, HEAD and refs are preserved. The obsolete freeze-inference
checker deletion was already present at entry and is not attributed to this pass. The checkout remains intentionally
dirty with its pre-existing work and these reviewable changes; it is not claimed clean.

## Testing-framework improvements

Tests retain `node:test` and `@std/expect`, use controlled ownership and immediate cleanup, and make parameterized
public behaviors visible. Controlled clocks and explicit gates are preferable to mocked global timers for owners that
already accept a clock. Executable documentation uses the existing checker; 68 complete examples are typed and run. AST
guards, metadata controls and benchmark population controls test rejection paths independently instead of mirroring
code.

## Production defects discovered

This qualification fixed Temporal declaration/runtime projection compatibility: the prior provider conflicted with
native Temporal declarations. The full maintained ponyfill supports precise durations and non-ISO calendars without
mutating globals on ordinary import; explicit installation preserves an existing native Temporal. Four fresh npm realms
test ESM/CommonJS with native and missing globals. This lets callers use the same duration operations when Temporal is
absent, without imposing global setup on library consumers.

Earlier retained task/fault/CSV/query/HTTP/process and pool/Worker fixes are documented in the historical review, with
caller-visible regressions. They are not presented as newly discovered here. Other defects repaired in this pass were
tooling: declaration build exit failures, missing declaration dependencies, ambient workspace resolution in consumers,
release hooks, misleading selective checks, ANSI-contaminated benchmark receipts, and conflicting formatting rules.

## Tooling and CI

Formatting remains enabled; Env's conflicting local rule was removed and the files formatted under the repository
standard. `NODE_DISABLE_COLORS`, `NO_COLOR`, `FORCE_COLOR` and `CI` are permitted by the focused Env benchmark. Children
set `FORCE_COLOR=0`; an empty value enables Node coloring and had corrupted JSON. Native receipts use direct JSON
output.

Mise owns runtime/tool versions and tasks; the official action bootstraps the tested manager and runs contributor
source, package/release, npm and fixture-preflight gates. CI performs the native artifact preflight after npm
qualification. Bumpy's real owned Git fixture validates release intent, versions all 42 packages, and synchronizes
source-native versions. Real PNPM and Deno installers generated the locks. No publication was attempted.

## Documentation

README now starts with a complete observable operation. Package guides and [composition](./composition.md) show
standalone use, then practical combinations, expected values, failure paths and owners. Twenty-eight malformed outer
fences were fixed, stale API sketches corrected, and repeated template prose removed. [Outcomes](./outcomes.md) explains
the problems each capability solves; runtime, testing, benchmarks, packaging and release guides state scope and
verification.

The teaching convention is to state what a call returns before introducing its machinery: immediate value/definition,
Promise of terminal work, AsyncIterable, or owned lifetime. `context.timeout()` immediately returns a child owner and
signal; it does not return the operation result. Pass its signal to cooperative work and dispose the owner to clear the
deadline and join cleanup. Expiry signals cancellation but does not itself dispose resources. Showing this simple
contract before a workflow composition reduces the impression that users must first learn an abstract execution
language.

## Validation

The gate receipt contains exact commands and logs. Meaningful successful executions include:

- `mise run verify`: format 735 files, lint 569, strict TypeScript 7 source types, declaration-comment gate, 165 Deno
  tests/721 steps (0 failures, 1 existing ignore), 18 native Node files/121 tests (0 failures/skips), examples,
  qualification/fragile guards, selective consumers, source benchmark preflight and version parity.
- `mise run npm-verify`: 41 serial builds/archives, strict validators, clean installation, 290 ESM/CJS paths, strict
  declarations/compositions, selective consumers and Temporal/unsupported-runtime controls.
- Critical source selection with `--shuffle=20261007`: 29 files, 33 tests/173 steps (0 failures, 1 ignore); the native
  121-test source selection also passed again.
- `deno run -A tools/check-examples.ts`: 68 typed/runnable examples passed; independent guard and selective controls
  passed.
- After the full gate, the qualification guard tests received one final test-only repair: 14 independently isolated
  acceptance/rejection controls replace exact private diagnostic prose. That file passed focused tests, format and lint;
  production source remained unchanged. The full-suite count above belongs to the preceding snapshot.
- Actual `mise run bench-npm -- --check` and all 14 source fixture preflights passed. Restricted Env measurement with
  `NODE_DISABLE_COLORS=1 NO_COLOR=1` passed; all 15 serial measurement programs produced validated native reports.
- Actual strict Bumpy check, version application and 42-package synchronization/check passed in an owned Git fixture.

POSIX process qualification used verified Tini as a scoped subreaper. The original container's non-reaping PID1 retained
a terminated child as a zombie; correcting the runner made the unchanged native regression pass. No product timeout or
test skip was weakened. The full comment gate has no missing owned public declarations; 102 renderer type diagnostics
and external dependency comment warnings remain outside that comment gate. This is not a claim of zero raw deno-doc lint
diagnostics. Source and installed declaration compiler checks passed independently.

## Issue #1 status

These are the 15 acceptance items from [issue #1](https://github.com/okikio/utils/issues/1), checked against the local
receipts. “Satisfied” describes implemented and executed local qualification; it does not imply publication or remote
CI.

| Item                           | Status              | Evidence                                                                  |
| ------------------------------ | ------------------- | ------------------------------------------------------------------------- |
| 1. Package matrix              | Satisfied           | 42 inventoried members.                                                   |
| 2. Public behavior             | Satisfied           | Package-owned tests and explicit runtime limits.                          |
| 3. Real compositions           | Satisfied           | 10 provenance records; source flows and five dual-format installed flows. |
| 4. Fragile patterns            | Satisfied           | Reviewed inventory, AST guard and narrow exceptions.                      |
| 5. Representative performance  | Satisfied           | Coverage registry; 200 cases, stated comparison limits.                   |
| 6. Portable projections        | Satisfied           | 41 packages, 290 supported paths.                                         |
| 7. Metadata validators         | Satisfied           | Strict publint and modern attw profile.                                   |
| 8. Emitted consumers           | Satisfied           | Physical external install, ESM/CommonJS execution.                        |
| 9. Runtime classification      | Satisfied           | Explicit source-only exclusions; no unsafe shim.                          |
| 10. Mise authority             | Satisfied           | Declared tools and contributor tasks.                                     |
| 11. CI task parity             | Satisfied           | Same locally executed gates wired into workflows.                         |
| 12. Release coherence          | Satisfied           | Actual owned Bumpy check/version/sync.                                    |
| 13. Generated, committed locks | Partially satisfied | Real-toolchain locks generated; uncommitted, no PR draft transition.      |
| 14. Exact archive validation   | Satisfied           | SHA256 receipts and reinstalled exact archives.                           |
| 15. Teaching and gate docs     | Satisfied           | Complete executable examples and focused guides.                          |

## Remaining concerns

Commit/delivery is still pending in the shared dirty checkout, so issue #1 should remain open. Hosted Actions and
publication have not run. Durable recovery used process-local adapters and owner replacement, not a persistent database
or process-death experiment. A utility's recursive work/host model does not establish Kubernetes placement,
cross-machine migration or a Node-native Worker backend. Those need actual adapters, protocol and storage qualification.

Benchmark fixtures are useful engineering evidence, but need production distributions and controlled historical hardware
baselines before regression thresholds. The limited raw deno-doc renderer diagnostics deserve a separate renderer/type
projection investigation; they are visible rather than silently treated as full type proof. No claim extends selected
Node/browser evidence to all source unit suites or every runtime.
