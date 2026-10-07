# Utility and Hono profiles — 2026-10-07

Start with the gateway pair in `.artifacts/profile/20261007-expanded/final-gateway/`. Open
`gateway-utils-0.cpuprofile.svg` and `gateway-hono-0.cpuprofile.svg`, hover a frame for its sampled share, and click to
zoom. The corresponding raw V8 files and request receipts are beside them. The evidence index records each completed
lane, exact source identities and qualification results. The [profiling guide](./profiling.md) explains how to repeat a
selected operation.

The gateway still has a measurable gap against the selected Hono implementation. Its current mean-time ratio is
**1.616**, with an approximate 95% interval of **1.375–1.899**. This does not meet the requested margin-of-error goal.
The shared wire expectations establish the selected response contract; Utils also owns cancellation, deadlines,
completion observation and trace identities. The Hono fixture implements a smaller lifecycle contract. Keep those costs
explicit when deciding which work to remove.

The fully joined gateway baseline assigns **20.95%** of sampled time to header forwarding including its descendants,
**4.16%** to correlation, **2.97%** to abortable-response construction, and **1.84%** to completion-wrapper
construction. The final gateway has no `onComplete` samples, while header forwarding still occupies **21.49%** and
correlation **5.01%**. These are separate recording shares, not a latency budget; async continuations also appear on
other stacks. Route lookup is not the dominant cost in this forwarding workload. The sixteen-middleware baseline assigns
**6.05%** inclusive time to `resourceClosure`; that function has no samples in the final warmed service case. Its
declaration traversal now occurs before sampling when the runtime is created.

## Changes made from the evidence

The gateway now omits its second response-completion wrapper when there is no deadline and no completion, failure or
abort subscriber. The abortable body remains. This removes a Response, a stream, a reader and byte-counting callbacks
whose completion has no remaining owner. Tests exercise complete binary delivery, status and headers, consumer
cancellation, original stream-error identity, caller abort after delivery begins, each terminal observer, and deadline
cleanup. The path with a subscriber or deadline still tracks completion.

Compiled services now prepare operation and middleware resource envelopes once per runtime. A runtime-local WeakMap keys
each envelope by exact definition identity. Requests still borrow through their own context and perform fresh permission
checks. The baseline service profile showed repeated `resourceClosure` traversal and Set construction in middleware.
Tests check different actors, concurrent request signals, independently compiled graphs with identical diagnostic IDs,
and attempts to access another operation's resource. This cache contains declarations, never permission decisions or
request values.

Those tests found a separate existing defect: an endpoint borrowing a resource after permission admission could return
HTTP 500 with `Context view cannot replace existing property permissions.` The saved pre-cache service reproduced it.
The permission interpreter now reuses an existing view only for the same checker and exact declarations already present
in that view. It still evaluates the provider on each application. Added authority, a different checker and foreign
same-ID definitions retain the replacement rejection. Public nested `permission.scope()` retains its existing guard.

## What the timing experiment establishes

Each row below uses six fresh-process pairs with alternating source order and alternating fixture order. Each process
runs real Mitata trials, preflights independent expected responses and consumes complete results. The permission fix is
common to both variants; only the gateway wrapper and service-envelope source differ. Exact variant hashes, fixture
source, native Mitata JSON and stderr are retained under `change/`.

| Comparison                                                         | Paired geometric mean-time ratio | Approximate 95% interval | Interpretation                                                |
| ------------------------------------------------------------------ | -------------------------------: | ------------------------ | ------------------------------------------------------------- |
| Current / baseline gateway                                         |                            0.648 | 0.424–0.991              | Lower time in this experiment; sensitive to host-load changes |
| Current / baseline service, zero middleware                        |                            0.733 | 0.304–1.771              | Difference unresolved                                         |
| Current / baseline service, four middleware                        |                            0.959 | 0.536–1.715              | Difference unresolved                                         |
| Current / baseline service, sixteen middleware                     |                            0.862 | 0.559–1.328              | Difference unresolved                                         |
| Baseline Utils / Hono gateway                                      |                            1.779 | 1.645–1.923              | Higher Utils time                                             |
| Current Utils / Hono gateway                                       |                            1.616 | 1.375–1.899              | Higher Utils time                                             |
| Current / baseline gateway ratio after dividing each trial by Hono |                            0.908 | 0.764–1.080              | Difference unresolved                                         |

Intervals use paired log ratios and Student t with five degrees of freedom. The direct gateway interval narrowly
excludes one, but an adjacent baseline process had substantially slower Hono times too. Dividing by the same process's
Hono case is an imperfect load control: those cases run sequentially, so it cannot remove changing load inside a child.
These observations justify retaining the work-removal claim, not a portable 35% speedup promise. Intervals containing
one do not prove equivalence. Instrumented profile elapsed times are excluded from this table.

## Coverage and boundaries

The source benchmark lane profiles all sixteen canonical programs and their 152 Mitata registrations. Range-driven
argument expansions share a registration profile and remain listed in its receipt. The benchmark coverage map links all
42 package families to operations and selective-import cases; some families have startup coverage without an independent
equivalent library. A family disposition is not a claim to have exercised every public function.

The HTTP inventory covers the complete 35-request API corpus and each request separately; warm route lookup at
16/256/4096 routes and eight hit/miss positions; gateway forwarding; the translated upstream router, request, response
and application families; all fourteen upstream proxy registrations; middleware depths 0/1/4/16/64; route construction
plus its first response; and compiled services with 0/4/16 resource-using middleware. Services are Utils-only. The
ordinary baseline has 165 profiles; separate middleware, disconnect and construction lanes close its additional gaps.
The inventory contains 183 profiles when selected together under either supported HTTP runtime.

The 236 translated upstream core vectors and fourteen proxy registrations are finite selections with literal inputs and
outputs. They do not cover every assertion in the preserved 139 upstream files. Some proxy outputs intentionally differ:
strict Hono Connection validation rejects an invalid nomination, while Utils ignores that token and strips valid
nominations. In the disconnected-client fixture, Hono's mock response can complete while Utils rejects the aborted
request and cancels the late upstream body. Those graphs compare the original situation, not identical policy outcomes.
See the [Hono coverage ledger](./hono-coverage.md).

Parent samples cannot establish CPU coverage of a subprocess or Worker. The startup lane records all 44 actual source
import children. Installed Deno 2.9.7 does not expose CPU-profile flags, so its inspector fallback samples initial
JavaScript execution through the import receipt, excluding native launch and final shutdown. Native npm children have a
separate startup-to-exit lane against physically installed ESM and CommonJS archives. The actual Worker inspector
session also recorded 10,000 validated, correlated requests, verified the fixture URL and Worker realm, and joined its
acknowledged shutdown. This is one real Worker request workload, not every cold Worker launch in the parent benchmark.

The final additions also profile Worker JavaScript initialization before its first response, plus the exact tiny
`console.log("READY")` process child under Utils ownership and raw Deno.Command. The Worker startup target is verified
as waiting for its debugger before resume; the process target's initial script source is checked. Both exclude native
initialization before inspector attachment. The two process children produced the expected output and joined cleanly,
but their graphs contain only eight and seven samples and no eval-script frames. They retain explicit incomplete
attribution instead of extending the tiny program to manufacture samples. The graphs identify actual child-runtime work;
they cannot assign CPU cost to that console statement or arbitrary process-transport applications.

| Primary completed lane                                        | CPU captures |
| ------------------------------------------------------------- | -----------: |
| Sixteen source benchmark programs                             |          152 |
| Baseline Deno HTTP                                            |          165 |
| Additional middleware, disconnect and construction recordings |           21 |
| Actual source import children                                 |           44 |
| Warm Worker isolate                                           |            1 |
| Native Node HTTP                                              |          183 |
| Final Deno gateway, services and proxy recordings             |           33 |
| npm import benchmark registrations                            |           88 |
| Actual installed ESM/CommonJS import children                 |           88 |
| Worker JavaScript startup                                     |            1 |
| **Total qualified captures, including repeated workloads**    |      **776** |

The evidence index excludes preliminary smoke recordings, a repeated warm Worker qualification, and the failed initial
gateway shutdown recording from this primary count. Their raw evidence remains retained. Native Node and Deno rows must
not be pooled into one performance claim.

The two actual process-child graphs are retained separately with incomplete eval-frame attribution. The initial script
check compares AST structure, preserving calls and literal values while ignoring Deno's emitted punctuation and source
offsets. Formatting changes cannot invalidate that input check.

The runner uses two CPUs and 2 GiB of memory with real Mise and Tini. Resource receipts describe limits and observed
pressure. HTTP callbacks include fresh Request creation, response consumption and fixture assertions; construction
callbacks deliberately include registration. Suite regions include Mitata warmup, trial GC and measurement machinery.
The mock transport does not exercise a deployed listener, remote network, TLS or Kubernetes placement. CPU samples do
not measure peak memory, retained heap or TypeScript editor responsiveness.

## Next fixes to qualify

Prioritize the gateway's remaining native header copying and trace allocation, then service finalization and bounded
body reading. Share one prepared header projection only when each hop's trust and Connection policy stays independent.
Measure it against duplicate cookies, repeated Connection fields, invalid nominations, compression metadata, redirects
and caller cancellation. Preserve required trace identity rather than replacing unique IDs with constants to win a
fixture. Repeat gateway timings on an idle host and retain Hono as an adjacent control before making another performance
claim.

Outside HTTP, queue claim expiry and claim-ID collision scans dominate their captured program windows. `#expire` scans
all retained items on common ownership operations; unique claim creation rebuilds the active-ID Set. Activity dispatch
has the same pattern plus executor expiry. A maintained active-claim ID index can remove repeated Set construction; an
expiry index can avoid full history scans. Qualify every insertion, completion, failure, expiry, renewal and executor
revocation against an independent state model. Include deterministic collision sources, clock jumps, stale fencing
tokens, concurrent waiters and repeated expiry. A plain FIFO reference lacks those contracts and cannot justify removing
them.

Streaming decoder samples identify UTF-8 and line framing as a second source of cost. Vary chunk boundaries, split
multibyte characters, malformed input, final unterminated lines, limits and consumer cancellation before trying larger
buffers or a different framing algorithm. Parent import and host graphs are mostly idle; interpret their child and
Worker lanes instead of optimizing the waiting parent.

In the source-program aggregate, queue expiry occupies **36.5%** of weighted exclusive samples and claim-ID scanning
**14.9%**. Dispatch expiry occupies **43.9%** and its claim-ID scan **15.7%**. These aggregate different registration
windows inside each program, including trial machinery; they are useful priorities, not whole-application latency shares
or evidence that a proposed index will deliver those percentages as a speedup. `inventory-hotspots.json` retains the
individual cases and weighting method.

The saved evidence and source-level fixes make these experiments reviewable. The remaining performance gap needs further
controlled changes; the profile does not establish parity with Hono or production-network performance.

## Verification

The complete source gate passed: formatting across 794 files, lint across 608 files, strict types, declaration comments
across 153 focused public entrypoints, pinned Hono inventory, 178 Deno tests with 1,150 steps and one ignored test, 615
native Node tests with no failures, fragility and qualification inventories, package and tree-shake checks, benchmark
preflights, clean consumers and all 42 source package versions. The declaration-comment gate still explicitly excludes
renderer and external dependency diagnostics; it is not an all-dependency documentation guarantee.

The emitted-package gate qualified 41 packages and 292 public subpaths, strict ESM/CommonJS consumer declarations, 19
scenario tests in each format, and native/missing-global Temporal and disposal probes. The retained type report uses
TypeScript native 7.0.2 to check declarations generated by TypeScript 6.0.3. Startup profiles import these physically
installed archives outside the workspace. Later controller-only startup modes and selector validation have separate
focused checks; they leave the qualified production source unchanged. Full logs and artifact hashes are saved with the
profiles. No files were staged, committed or pushed.
