# HTTP performance and qualification closure

Utils still takes more time than Hono on the final Bun and Node API batch. The remaining gap is measurable; this work
has not established Hono parity. The fixes remove repeated preparation, empty observation and redundant promise
wrappers. They preserve request isolation, validation, cancellation and response ownership.

## What the measurements establish

The final experiment compares snapshot `ef81e5afcaa8cbb02da61283ea53824b9cc66b1e` with the final qualified source. Each
runtime runs eight adjacent baseline/candidate process pairs. Source order alternates, and challenger order follows the
same balanced schedule within each pair. Each process measures four real implementations after checking the same 35
literal request/response cases. Fresh requests and complete response consumption are inside the timed operation;
application construction, compilation, preflight and close are outside it.

There are 48 successful processes and 192 challenger measurements across three runtimes. Ratios below are geometric
means of the eight paired observations, with individual 95% paired log-scale Student-t intervals (seven degrees of
freedom). A ratio above one means Utils takes more time. These intervals are not simultaneous family-wide intervals.

| Final Utils time / challenger time | Hono                 | Elysia               | Vixeny               |
| ---------------------------------- | -------------------- | -------------------- | -------------------- |
| Bun 1.4.2                          | 1.851 [1.695, 2.022] | 2.325 [1.851, 2.919] | 2.879 [2.417, 3.429] |
| Node 26.10.0                       | 1.470 [1.371, 1.577] | 1.655 [1.354, 2.024] | 1.822 [1.470, 2.258] |
| Deno 2.9.7                         | 1.021 [0.860, 1.212] | 1.456 [1.134, 1.869] | 1.580 [1.493, 1.673] |

The Deno Hono interval crosses one. It does not prove equivalence or a difference within an agreed margin of error.
Elysia uses its native Bun adapter on Bun and its Web Standard adapter on Node and Deno. Vixeny uses the retained
compiled module. Versions, adapter identity, compiled artifact hash and inputs are recorded in the raw receipts.

| Source change: candidate time / baseline time | Utils directly       | Hono control         | Utils divided by Hono control |
| --------------------------------------------- | -------------------- | -------------------- | ----------------------------- |
| Bun                                           | 1.027 [0.867, 1.217] | 1.139 [0.956, 1.356] | 0.902 [0.823, 0.989]          |
| Node                                          | 0.918 [0.879, 0.958] | 0.909 [0.790, 1.046] | 1.009 [0.854, 1.192]          |
| Deno                                          | 1.087 [0.780, 1.514] | 1.142 [0.919, 1.418] | 0.952 [0.773, 1.172]          |

Node directly takes about 8.2% less time, but its unchanged Hono control shifts by a similar amount. The normalized Node
effect is unresolved. Bun's normalized ratio supports about 9.8% less relative time only under the assumption that
shared host effects multiply both implementations' times in the same way. It is not an observed absolute speedup. Deno's
source effect is unresolved. These results do not support a portable speedup claim. Earlier phases are retained
separately; comparing their means with this phase would confound source changes with host conditions.

## Why the gap remains

The final Node compiled-service JSON profile still attributes work to response finalization, body reading, header
projection, context construction, cancellation errors, abort signals and correlation entropy. For example, the retained
400 ms capture records `toResponse` with 10,371 microseconds of self samples and 61,911 inclusive microseconds. Garbage
collection receives 43,808 self microseconds. These sampled weights describe that diagnostic capture; they are not an
unprofiled latency budget, and inclusive values overlap.

Hono's fixture reaches the same literal wire observations with a smaller service ownership contract. Utils validates
schema boundaries and retains request resources until its response completes. It also creates contexts, follows abort
signals and performs cleanup. Router lookup alone therefore cannot explain or eliminate the gap. The framework batch
includes successful routing, malformed input, errors, body limits, middleware and compiled services; it is not a
router-only ranking.

The safe reductions are concrete:

- A library-created immutable parsing policy and header projection can be reused by exact weak identity. Caller-owned
  records still receive fresh validation, including frozen records.
- Public Fetch and middleware operations preserve promise rejection behavior while forwarding existing promises where
  possible. The continuation guard still rejects duplicate use.
- Empty service middleware, resilience and adapter stages avoid unnecessary preparation. Services without observers
  avoid constructing unused events while retaining response cleanup.
- Routing compiles registrations and preserves method, parameter, mount and HEAD behavior. Existing response preparation
  skips work when the selected response does not need it.

Further work should isolate owned-response wrapping, context setup and header conversion independently, then repeat
these paired trials. Removing validation, cancellation or resource ownership to lower a benchmark would change the
product contract. The current profile is evidence for where to investigate, not proof that every remaining allocation
can safely disappear.

The fresh profile set contains 462 completed captures: 144 API captures per runtime, three service middleware captures
on Node and Deno, and eight baseline compiled-service captures per runtime. Baseline compiled-service captures have
matching final counterparts. The extra middleware captures do not have matching baseline captures and establish only
current attribution. Node and Deno use real external V8 inspector sampling; Bun uses native JSC whole-process profiles.
Bun startup and idle gaps have a wider boundary than warm V8 windows. The renderer preserves raw profiles and discloses
negative timestamp deltas while clamping their display weights. Sample percentages are not interchangeable across these
boundaries.

## Standards review and behavior fixes

[The standards inventory](./standards-review-20261007.md) records applicability for all 28 skill entrypoints and nine
top-level guides, including all 53 README surfaces. Design-only rules are identified as outside these library changes.
[The tools review](./standards-tools-review-20261007.md) records generator and qualification controls. This review found
and repaired behavior beyond the HTTP timing path:

- Request readers join cancellation before releasing their lock and retain primary failures when cleanup also fails.
  Unexpected provider diagnostics now produce a safe service 500 instead of leaking into client validation errors.
- Context deadlines recheck waits beyond the native timer range. Workflow cancellation hooks and timer waits are joined
  before their owners close.
- Process channels reserve IDs before asynchronous schema admission, so duplicate IDs and cancellation cannot replace
  pending work or block the frame reader behind validation.
- CSV results retain source record coordinates across blank records and quoted newlines. Query adapter capacity covers
  the complete order, including default fields and stable tie breakers.
- Package generation reads JSONC without replacing authored regions, checks drift by default and requires an explicit
  write mode. Temporal and disposal providers offer direct imports; installers retain their separate global mutation
  contract.

[The cross-repository review](./utils-review-20261006.md) explains the concrete Core, Core PR and MediaD differences,
which changes were selected and which were rejected. [The test review](./test-review.md),
[Hono coverage](./hono-coverage.md) and [challenger contracts](./http-challengers.md) describe actual inputs, expected
outputs and coverage limits. Hono coverage is indexed against a pinned upstream snapshot; it is not an assertion that
all upstream tests apply unchanged to a different API.

## Qualification and retained evidence

The final source passes the complete repository verification pipeline: formatting, lint, strict source and native
TypeScript checks, generated package drift, documentation entrypoints, Hono inventory, test and benchmark fragility
review, behavioral qualification, package checks, tree shaking, clean consumers and all 17 benchmark preflights. Deno
reports 185 tests and 1,245 steps passed, with one Node-only test ignored. Node reports 796 tests passed. The focused
native Bun run reports 241 tests passed across ten files. The separate final packed npm consumer gate passes: 41
packages and 292 public subpaths are inspected and executed through both ESM and CommonJS, including declarations,
ponyfill isolation, selective bundles and 19 semantic scenarios per module format. Its raw output is `final-npm.log`,
and `resume-lane-exit.json` records exit zero.

Runtime and verification source bytes were checked against the measured final profile input hashes before delivery.
Final prose edits pass a separate formatting, documentation and generated-export check. The documentation checker finds
no missing declaration comments across 153 focused public entrypoints. It reports 102 renderer type diagnostics and 369
external dependency comment diagnostics outside that comment gate; this pass does not claim to repair external
dependency documentation or qualify that renderer diagnostic surface. The strict source and native type gates pass.
Tests do not assert exact stack text, elapsed speed, fixture source formatting or a fixed benchmark winner. Logical
clocks, explicit gates, literal wire cases and external implementations provide the controls.

The ignored evidence bundle is `.artifacts/profile/20261007-hono-fixes/`. It retains full final and baseline source
archives, raw paired measurements, CPU profiles and SVGs, workload receipts, runner identity, source hashes and logs.
`index.json` and `SHA256SUMS` identify retained files. Earlier all-utility and challenger captures remain in their dated
bundles described by [the prior profile review](./profile-review-20261007.md). They establish earlier coverage and are
not relabeled as measurements of this final source.

The first final Deno attempt ran out of host disk while writing a receipt. Its partial `final-variants-deno` is retained
and excluded. The fresh `final-variants-deno-complete` has all 16 successful processes and is the only final Deno matrix
used above. The first Bun test command selected the wrong CLI mode; that failure is retained, and the corrected native
Bun test command passes. Neither failure is hidden as a successful run.

All heavy qualification runs were serialized in a task-owned Docker container with two CPUs, a 2 GiB memory limit and
256 PIDs, under real Mise and Tini. This is warm in-process Fetch evidence. It does not establish production socket
throughput, native Elysia socket-adapter performance, Kubernetes placement or cross-machine workflow behavior.

## Delivery

The original main commit is `0b06c4985316b01a51e85a36b55ce84404f33262`. Original dirty work and the qualified
pre-delivery tree have separate verified backup refs. A dedicated formatter commit stages formatter-only original blobs
before the capability commits. The final combined tree owns the runtime qualification; intermediate commits are not
individually claimed to pass every gate. Local main receives the rebased capability stack by a fast-forward merge after
the final checks. No remote publication is part of this delivery. The ignored `delivery-final.json` records actual final
refs, commits, tree identity and cleanup.
