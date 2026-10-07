# Comparison qualification — 2026-10-07

Both independent HTTP implementations satisfy the authored request/output corpus. The comparison covers 35 API requests,
one selected gateway forwarding policy, and eight route positions at each of 16, 256 and 4096 routes. Each candidate is
checked against literal status, selected headers and consumed body expectations. Candidate agreement alone is not the
oracle. The full API includes middleware state, errors, framing, byte limits and a compiled Utils account service. Its
Hono counterpart uses only Hono and native Fetch APIs.

[Machine-readable results](./comparison-results.json) retain final commands, scope, hashes and timings. Execution
reports, controls and exact packed archives are preserved locally in `.artifacts/comparison/20261007`. The earlier
[qualification report](./qualification-report.md) is a historical snapshot; its counts are not substituted for this run.

## What the tests now establish

[The parity guide](./http-parity.md) and [fixture provenance](../tests/fixtures/http-parity/README.md) explain inputs,
expectations and deliberately different contracts. Small Hono 4.13.5 cases retain immutable upstream links and the MIT
notice. They cover strict slashes, decoded Unicode/slash parameters, middleware order, request-local state, HEAD and
real streamed body limits. New independent UTF-8 controls accept 14 bytes and reject 15 bytes even though both strings
contain fewer than fourteen JavaScript characters. Concurrent state tests require both authored actors and join both
requests before assertions or application shutdown. Public compiler controls preserve transformed input and declared
response inference, including four intended type errors.

[Established alternative fixtures](./alternatives.md) add fifteen overlapping operations with independently authored
outputs and 27 focused correctness steps. They use p-limit, neverthrow, Hono, JSR Standard Library utilities and
relevant CSV/HTML/CSS/XML/schema engines. Capacity controls use promise gates; malformed inputs and intentional policy
differences remain visible. Same-engine adapter cases do not claim independent grammar validation. Saxes is labeled as a
historical archived oracle. The all-package disposition matrix identifies where an alternative omits authority, fencing,
retirement or recovery; generic collection libraries are not promoted as equivalent workflow systems.

The router's separate linear oracle checks 608 method/path decisions across ordinary and reversed registration.
Parameter-leading templates retain a shared candidate bucket, so literal-prefix partitioning is not a constant-time
claim for every route shape. Benchmarks assert untimed expected results, consume timed outputs and keep construction,
route warmup and final owner shutdown outside steady-state dispatch. Native report validation rejects empty, failed or
internally contradictory sample populations. Six-process comparison controls also reject missing whole workload pairs,
unknown aliases and duplicates. No elapsed-time acceptance threshold depends on an improvement being slower or faster.

## Defects repaired in the owning utilities

- HTTP HEAD normalization now removes bodies after middleware, mounts, not-found and error handling. Dynamic parameters
  reject empty segments. Prepared dynamic lookup caches parsed templates and indexes literal prefixes while preserving
  the existing specificity order.
- Gateway forwarding strips every `Connection`-nominated field on both hops. Trust filtering snapshots live header
  iterator names so adjacent spoofed fields cannot survive deletion. Successful response credentials, cache and
  correlation use one sanitized header copy. Generated problems keep their own policy. Unsubscribed events are not
  constructed; cancellation and completion still own streaming bodies and deadline timers.
- Service preparation reuses immutable fallback interpreter configuration, skips empty middleware dispatch preparation
  and parses URLs only for parameter/query input. Each request still creates its context and effect/requirement scopes,
  and validates declared output. These are allocation reductions, not a weaker service contract.
- Dispatch waits preserve positive nanosecond boundaries, distinguish already-ready foreign work from future eligible
  work, and avoid polling queued results at zero delay. Replacement and expiry release active claims before removing
  their executor owner. Context and queue timer conversion also rounds positive fractional milliseconds upward.
- Child reverse calls settle with the exact cancellation reason and remove pending correlation state. A closing parent
  suppresses late replies that could otherwise obstruct duplex shutdown. Promise-gated tests prove cancellation and
  close without measuring how fast they happen.
- Disposal's async protocol rejects a noncallable async method rather than falling back silently. A sync fallback
  ignores its returned thenable, as required by the protocol. Cleanup still runs in reverse order and preserves thrown
  `undefined`, subsequent failures and moved ownership.

## Direct imports without global installation

Disposal now exports local named `DisposableStack`, `AsyncDisposableStack`, `SuppressedError`, `dispose` and
`asyncDispose` bindings through its root and `/ponyfill`. Temporal already has the pure `/temporal` facade. Both
explicit `/polyfill` installers preserve existing native bindings. Focused and umbrella subpaths publish the same model.
[Disposal's guide](../packages/dispose/README.md) starts with a complete local cleanup example, then composes it with a
CSV reader. [Runtime contracts](./runtime.md) explain local protocol keys, native syntax and the remaining ambient setup
needed by lifecycle packages; a local import does not install globals for unrelated consumers.

Fresh installed-artifact processes verify ESM and CommonJS with native constructors, missing constructors and missing
protocol symbols. Pure imports preserve both global values and property descriptors. Separate installer probes enable
missing-host behavior. Strict consumer checks retain declaration checking, rather than hiding dependency errors with
`skipLibCheck`.

## Final gates

- `mise run verify`: **172 Deno tests / 795 steps**, zero failures, one explicitly inapplicable Node-adapter test
  ignored; **221 native Node tests** pass across the canonical 26-file selection. Qualification inventories 42 packages
  and 138 canonical test files. Public declaration comments, strict types, executable examples, export/package graphs,
  fragile-pattern controls, benchmark preflights and source consumer bundles pass.
- `mise run npm-verify`: **41 exact portable archives / 292 public subpaths** pass in ESM and CommonJS. Publint, ATTW's
  supported Node16 profile, strict public/composition types, pure/installed compatibility probes and six compiled
  consumer compositions pass; each module format runs 19 scenario tests.
- Focused gateway/service/compiler/parity qualification passes **9 Deno groups / 69 steps**, and a separate native Node
  run passes **69 tests**. These overlap existing selections and are not added together as a unique-test count.
- Six counterbalanced HTTP comparison trials pass their independent preflights and frozen-input checks. The final
  complete native benchmark run passes **17 programs / 240 cases**, including physically installed npm imports.
  [The machine receipt](./comparison-results.json) lists every measured case's mean, median, tail, samples and available
  heap/GC observations; raw native populations remain preserved.

Formatting uses the repository's configured Deno formatter. Benchmark execution sets `NODE_DISABLE_COLORS=1`,
`NO_COLOR=1` and `FORCE_COLOR=0`, disables Mitata colors, and joins native JSON writes. The local canonical source/npm
gates passed on the pinned runner; no hosted GitHub Actions run, registry publication, Bun suite or browser-wide
execution is claimed.

## Measured HTTP results

| Workload                 | Utils batch µs | Hono batch µs | Utils/Hono | 95% interval | Interpretation        |
| ------------------------ | -------------: | ------------: | ---------: | ------------ | --------------------- |
| 35-request API           |         1316.7 |        1073.0 |      1.227 | 0.912–1.650  | difference unresolved |
| Gateway policy           |          169.6 |         102.2 |      1.659 | 1.498–1.837  | higher Utils time     |
| 16 routes / 8 requests   |          123.0 |         139.7 |      0.880 | 0.615–1.259  | difference unresolved |
| 256 routes / 8 requests  |          138.8 |         126.4 |      1.098 | 0.891–1.352  | difference unresolved |
| 4096 routes / 8 requests |          131.7 |         180.6 |      0.730 | 0.607–0.876  | lower Utils time      |

Absolute columns are geometric means of the six trial means, in microseconds per batch.

Ratios are Utils/Hono elapsed time; lower is faster. Each API sample consumes all 35 requests, each gateway sample
consumes one request, and each route-table sample consumes eight requests. Six fresh processes alternate candidate
registration order. The interval is a 95% Student-t interval on paired log mean-time ratios with five degrees of
freedom. An interval spanning one does not prove equivalence. Shared host bias remains possible. No performance gate was
added to correctness CI.

The Utils service additionally validates outputs and owns context, correlation, negotiation and cleanup. Its gateway
implements general trust, framing, redirect and streaming policy beyond the handwritten Hono projection. Responses are
consumed inside timing; asynchronous completion callbacks may still settle afterward, and service shutdown joins owned
cleanup outside timing. These are in-process Fetch measurements, not socket throughput or complete joined per-request
retirement.

The 4096-route fixture resolves lower Utils time under this model. The API and smaller routing fixtures remain
unresolved. The gateway fixture resolves higher Utils time at 1.66× Hono. **The requested overall Hono-parity target is
not established.** Required policy/ownership work remains included; the allocation reductions do not justify dropping
those contracts or declaring an unresolved interval equivalent. Further performance work needs phase-level attribution
and repeated matched workloads, rather than a looser correctness expectation.

Earlier measurements used a 33-request corpus and an extra fixture response copy. They are retained as exploratory
receipts, not a matched before/after speedup estimate. A separate old-router sample is also a single exploratory run.
Only final, identically hashed six-process trials support the reported paired intervals.

## Failed attempts and proof limits

An existing native crash/retry scenario stalled in the initial full run and in an uninstrumented repeat. Verbose logging
changed scheduling and could not be treated as a fix. Logical-clock controls found the fractional dispatch defect;
restoring only the old millisecond logic caused both new retry controls to fail. Ten uninstrumented fixed native repeats
then passed, followed by the final source gate. These runs do not exhaust every possible OS or scheduling race.

The first npm attempt found Deno-installed dependency links resolving the declaration plugin to the TypeScript 7 CLI
without a compiler API. A forced frozen PNPM installation repaired only the disposable runner; stable TypeScript 6.0.3
owns declaration emission and TypeScript 7.0.2 owns strict source/consumer checks. Another attempt exposed test-only
Standard Library expectation declarations in the strict installed consumer. The shared parity test now uses native
`node:assert`, matching other portable compositions; declaration checking remains enabled. A focused optimization test
first referenced a nonexistent service test path, then exposed the incorrect problem-cache expectation described above.
Neither attempt is counted as a pass.

All heavy jobs ran serially in one owned ARM64 Linux container capped at two CPU cores and 2 GiB memory. The final
receipt records exact inputs, quota values, cache/GC policy, archives and source preservation. Existing dirty source was
preserved, the index and refs were not changed, and no package was committed or published.
