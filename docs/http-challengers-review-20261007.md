# HTTP challengers and profiles — 2026-10-07

Open the
[final Node API flamegraph](../.artifacts/profile/20261007-challengers/final-profiles-node/challenger-api-utils-0.cpuprofile.svg)
beside the
[baseline Hono graph](../.artifacts/profile/20261007-challengers/profiles-node/challenger-api-hono-0.cpuprofile.svg).
Hover to inspect self time and click to zoom. Their native profiles and receipts sit beside them. Follow
[the comparison guide](./http-challengers.md) to rerun the same qualified applications.

Elysia and Vixeny are now real independent challengers, using their compiled native routers. The final Bun API batch
takes **2.179 times Hono's time** (individual 95% interval **1.885–2.518**), **1.983 times Elysia's** (**1.597–2.461**)
and **2.901 times Vixeny's** (**2.006–4.195**). The requested API parity goal remains unmet in that lane. Large tables
tell a different story: Utils takes less time than Hono and Vixeny in the final Bun 4096-route batch, while its
difference from Elysia is unresolved.

These are warm in-process Fetch batches with complete response consumption. They do not measure TCP throughput, Elysia's
native listening-server offload, or equivalent resource/cancellation authority. A matching wire response is a useful
correctness oracle, not proof that each application performs identical internal work.

## What was measured

The runner used a task-owned Linux arm64 container with two CPUs and 2 GiB of memory. Mise 2026.10.3 and Tini 0.19.0
owned Deno 2.9.7, Node 26.10.0, PNPM 11.17.0 and Bun 1.4.2. Mitata 1.0.34 produced native reports. Hono 4.13.5, Elysia
1.4.30 and Vixeny 0.1.53 are pinned dev dependencies. Elysia uses AOT/precompile/strict paths, its public Web Standard
adapter on Deno/Node, and its default adapter on Bun. Vixeny uses its direct response compiler and native default atlas;
the same traceable unminified JavaScript emission is loaded on every runtime.

Every candidate passed all 35 API literals and all eight route-position/miss literals at 16, 256 and 4096 routes before
timing. Additional tests preserve concurrent request state, percent-decoding and native precedence differences.
Construction, compilation, literal validation, setup and close are outside warm Mitata timing. Requests and consumed
response projections are inside it.

Eight fresh processes per runtime use Williams orders balanced for candidate position and directed immediate
predecessor. Both baseline and final phases are retained: **48 processes and 768 candidate/workload measurements**.
[measurements.csv](../.artifacts/profile/20261007-challengers/measurements.csv) holds one row per measurement; the
native JSON retains inner samples and GC observations. No minimum-speed gate, fixed duration expectation or private
output snapshot accepts correctness.

A table cell is the geometric mean of eight Utils/competitor mean-time ratios, followed by its individual 95% paired
log-ratio Student-t interval (df=7). Below one means less Utils time; an interval crossing one leaves the difference
unresolved. The intervals assume approximately independent normal process log ratios and do not provide simultaneous
confidence across the matrix.

## Final source timings

The final phase is noisier, especially Deno and Node API batches. Keep its wide intervals visible. Do not replace them
with the quietest baseline number, discard an inconvenient process, or treat failure to detect a difference as
equivalence.

### Deno 2.9.7

| Batch                   | Hono                | Elysia              | Vixeny              |
| ----------------------- | ------------------- | ------------------- | ------------------- |
| API: 35 requests        | 1.387 [0.626–3.077] | 1.763 [1.071–2.903] | 2.447 [1.446–4.139] |
| 16 routes: 8 requests   | 0.963 [0.436–2.127] | 1.005 [0.529–1.908] | 1.392 [0.854–2.270] |
| 256 routes: 8 requests  | 1.306 [0.835–2.042] | 0.909 [0.560–1.476] | 0.971 [0.677–1.392] |
| 4096 routes: 8 requests | 0.855 [0.480–1.522] | 0.627 [0.466–0.845] | 0.266 [0.152–0.463] |

[Native reports and identity receipt](../.artifacts/profile/20261007-challengers/final-timings-deno/meta.json).

### Node 26.10.0

| Batch                   | Hono                | Elysia              | Vixeny              |
| ----------------------- | ------------------- | ------------------- | ------------------- |
| API: 35 requests        | 1.688 [0.675–4.220] | 1.989 [0.594–6.666] | 2.235 [0.989–5.049] |
| 16 routes: 8 requests   | 0.651 [0.462–0.919] | 0.592 [0.397–0.883] | 0.822 [0.503–1.342] |
| 256 routes: 8 requests  | 0.883 [0.618–1.261] | 1.023 [0.683–1.531] | 0.925 [0.572–1.495] |
| 4096 routes: 8 requests | 0.541 [0.369–0.794] | 0.354 [0.205–0.611] | 0.152 [0.103–0.223] |

[Native reports and identity receipt](../.artifacts/profile/20261007-challengers/final-timings-node/meta.json).

### Bun 1.4.2

| Batch                   | Hono                | Elysia              | Vixeny              |
| ----------------------- | ------------------- | ------------------- | ------------------- |
| API: 35 requests        | 2.179 [1.885–2.518] | 1.983 [1.597–2.461] | 2.901 [2.006–4.195] |
| 16 routes: 8 requests   | 1.038 [0.579–1.863] | 1.755 [1.027–2.999] | 2.118 [1.294–3.468] |
| 256 routes: 8 requests  | 0.873 [0.514–1.483] | 1.302 [0.912–1.860] | 0.772 [0.504–1.181] |
| 4096 routes: 8 requests | 0.304 [0.198–0.466] | 0.968 [0.495–1.894] | 0.078 [0.054–0.113] |

[Native reports and identity receipt](../.artifacts/profile/20261007-challengers/final-timings-bun/meta.json).

## Baseline source timings

These precede the dispatch change. They are a separate chronological phase, not interleaved source variants. Different
host load, JIT and GC behavior can confound a before/after comparison even when runtime and caps match. The experiments
do not establish a portable percentage speedup from that change.

### Deno 2.9.7

| Batch                   | Hono                | Elysia              | Vixeny              |
| ----------------------- | ------------------- | ------------------- | ------------------- |
| API: 35 requests        | 1.138 [1.002–1.292] | 1.274 [1.060–1.533] | 1.757 [1.564–1.974] |
| 16 routes: 8 requests   | 0.870 [0.671–1.128] | 1.164 [1.030–1.316] | 1.185 [1.016–1.383] |
| 256 routes: 8 requests  | 0.883 [0.770–1.012] | 1.032 [0.928–1.147] | 0.869 [0.780–0.968] |
| 4096 routes: 8 requests | 0.776 [0.742–0.811] | 0.443 [0.392–0.501] | 0.147 [0.121–0.180] |

[Native reports and identity receipt](../.artifacts/profile/20261007-challengers/timings-deno/meta.json).

### Node 26.10.0

| Batch                   | Hono                | Elysia              | Vixeny              |
| ----------------------- | ------------------- | ------------------- | ------------------- |
| API: 35 requests        | 1.364 [1.103–1.687] | 1.829 [1.453–2.302] | 2.087 [1.691–2.574] |
| 16 routes: 8 requests   | 1.048 [0.908–1.210] | 1.046 [0.844–1.297] | 1.321 [1.142–1.529] |
| 256 routes: 8 requests  | 1.014 [0.913–1.126] | 1.120 [1.023–1.227] | 0.960 [0.805–1.144] |
| 4096 routes: 8 requests | 0.628 [0.552–0.714] | 0.411 [0.353–0.478] | 0.146 [0.131–0.162] |

[Native reports and identity receipt](../.artifacts/profile/20261007-challengers/timings-node/meta.json).

### Bun 1.4.2

| Batch                   | Hono                | Elysia              | Vixeny              |
| ----------------------- | ------------------- | ------------------- | ------------------- |
| API: 35 requests        | 1.918 [1.708–2.154] | 2.330 [2.089–2.598] | 2.865 [2.557–3.210] |
| 16 routes: 8 requests   | 1.063 [0.782–1.446] | 1.205 [0.904–1.607] | 1.287 [0.984–1.682] |
| 256 routes: 8 requests  | 1.043 [0.980–1.109] | 1.171 [0.903–1.518] | 0.767 [0.667–0.882] |
| 4096 routes: 8 requests | 0.480 [0.418–0.551] | 1.057 [0.954–1.171] | 0.061 [0.055–0.068] |

[Native reports and identity receipt](../.artifacts/profile/20261007-challengers/timings-bun/meta.json).

## What the graphs explain

The baseline matrix contains **756 qualified native captures**: 63 workload IDs times four candidates times three
runtimes. It includes the four aggregate batches and every individual API and route vector. Final Deno/Node Utils
matrices add **126 captures** after the dispatch change. Their coverage receipts establish the selected operation,
source identities, positive sample weights and joined close. Failed/preliminary captures remain separate.

At 4096 routes, Deno's Hono regexp matcher has **19.0% self share**, and Node's **24.8%**. Vixeny's generated anonymous
matcher frames account for about **61.7%** of the Deno recording and **72.9%** on Node when their self shares are
combined. This agrees with its source: atlas partitions group method/path shape, then generate ordered linear
conditionals within a bucket. The 4096-route fixture creates 2048-entry static and dynamic groups, so late hits and
misses traverse long chains. No public option replaces that algorithm in the pinned release. Bound-origin and
relaxed-slash options change the supported request contract and were not enabled.

Utils already has an exact static index and prepared dynamic prefix partitions. Their scale behavior supports retaining
this design; copying Vixeny's matcher wholesale would add long chains for this route distribution. Elysia's portable
profiles place substantial work in generated Fetch and response mapping; a wide generated frame can include inlined
functions and does not identify one source statement. Its Bun adapter changes the large-table result substantially. No
cross-engine percentage is a library-only ranking.

The API profiles distribute work across Web Request/Response creation, body reads, middleware, parameter parsing,
service context setup and response finalization. In the valid compiled service vector, Deno's toResponse has about
**14.0% inclusive share**, while Node's has **15.3%**. Child contexts, tracing and finalization also appear. These
mandatory service lifetime/schema costs differ from the challengers' selected field-validation routes. Inclusive shares
include descendants, async continuations can appear elsewhere, and these figures are not a latency budget.

### Why Bun widths are diagnostic

Bun's genuine CLI profiler captures startup, construction, literal validation, warmup and gated dispatch, unlike the
warmed V8 inspector window. An idle control used roughly **67 ms of CPU over 1506 ms elapsed**, but its native deltas
assigned about **1506 ms** to console.log. The busy control used about **1510 ms of CPU over 1501 ms elapsed**. Both raw
graphs, receipts and SVGs are in
[jsc-control](../.artifacts/profile/20261007-challengers/jsc-control/idle.cpuprofile.svg). This reproduces idle-gap
billing on this Linux runner; weighted JSC self time cannot be treated as active CPU cost. Bun's unprofiled Mitata
reports remain separate from that defect.

The first Bun matrix stopped after 80 qualified operations when memoryUsage received EINTR from the native profiler
signal. The retry records that specific optional memory reading as unavailable, preserves other failures, and completes
all 252 operations. Nine retry captures contain an explicitly unavailable memory snapshot. They establish no numerical
heap claim. The [failed receipt](../.artifacts/profile/20261007-challengers/profiles-bun/coverage.json) remains
available and is excluded from the completed matrix.

## Changes retained and the next decisions

Internal HTTP dispatch now forwards the selected Response or Promise directly instead of wrapping every route, mount or
miss in an async function. Public Fetch remains asynchronous, middleware preserves error recovery, and final HEAD
cleanup still cancels the discarded body. Tests check original synchronous failure identity and recovery from
synchronous/asynchronous routes, mounts and missing handlers. Existing tests cover HEAD metadata/body cancellation and
guarded continuation ownership. This removes a promise layer; the two timing phases do not justify a percentage speedup
claim.

Profiler owners reject existing output directories so stale graphs or successful comparison JSON cannot qualify a failed
rerun. Both native profiler controllers own stdin EPIPE and join stdio closure. Bun chunk accounting bounds output even
without newlines. Optional EINTR memory telemetry cannot abort a CPU capture. Challenger cleanup joins every owner
before propagating primary/cleanup failures. Failure probes use a clearly labeled simulated child, not a challenger
timing or native graph.

PNPM owns its generated lockfile layout. Deno formatting excludes only pnpm-lock.yaml; authored code, docs and workflows
remain checked. This avoids fresh dependency installation invalidating the formatting gate. Native Node now includes the
portable HTTP host tests.

Prioritize service response finalization/header materialization and bounded body reading next. An experiment should
count required copies/readers and remove a duplicate while preserving repeated cookies, compression/redirect metadata,
content negotiation, byte admission, caller cancellation and descendant disposal. Empty stage selection can be prepared
at compilation if it preserves failure and observation order. Keep the current router unless a different route
distribution demonstrates a limitation.

Retain matched Hono/Elysia/Vixeny fixtures and literal preflights for these experiments. Use interleaved source variants
on an idle owner, inspect per-process variability and resource pressure, and define an equivalence margin before
claiming parity. Native Elysia listener offload, real TCP load, concurrency and allocations need separately named
workloads. Do not remove trace identity, validation, cancellation or resources to make a benchmark faster.

## Verification and evidence

The final source gate passed formatting, lint, strict types, public comments, README examples, Hono provenance, Deno
tests (**181 passed, 1203 steps, one Node-only suite ignored**), native Node tests (**697 passed**), fragile-pattern
audit, the **42-package/145-test** qualification matrix, export/tree-shaking/consumer checks, all **17 canonical
benchmark preflights**, and version checks. The Node-only suite runs under native Node. The focused Bun gate passed **85
tests**. Packed npm verification passed for **41 packages and 292 public subpaths**, with **19 consumer scenarios per
ESM/CommonJS format**. Simulated EPIPE and unterminated-output probes produced failed receipts with zero qualified
operations and joined children; all three controllers rejected existing output directories.

The declaration-comment gate checks missing comments across 153 focused public entrypoints. Its 102
private-type-reference/explicit-type renderer diagnostics and 369 external dependency comment diagnostics remain outside
that gate, unchanged from the earlier qualification. This is not a claim that the documentation renderer has no
diagnostics. Strict source types have their own passing gate.

The task used an independent Colima owner because Docker Desktop stalled before launching this container. This is a
local qualification run, not a GitHub Actions execution or deployed integration. Cgroup snapshots record limits and
cumulative pressure counters; historical memory-limit events during the preceding qualification do not establish the
cause of later timing variance. CPU profiles do not measure retained/peak heap or editor inference latency.

The evidence bundle retains exact baseline/final source snapshots, native reports, raw graphs, SVGs, JSON function
summaries, compiler artifact/source maps and upstream archive receipts.
[evidence-index.json](../.artifacts/profile/20261007-challengers/evidence-index.json) lists qualification and cleanup
status; SHA256SUMS and its verification receipt cover retained files. The earlier
[complete utility/Hono review](./profile-review-20261007.md) retains the other utility, Worker, process, import, gateway
and proxy lanes. This challenger addition does not claim all assertions from Hono's upstream suite, Elysia's tests or
Vixeny's tests have been ported.

Primary references: [Elysia's Deno adapter documentation](https://elysiajs.com/integrations/deno),
[Elysia](https://github.com/elysiajs/elysia),
[Vixeny's pinned source](https://github.com/mimiMonads/vixeny/tree/eec3775328ea88df8d821384e2382b2f55ff20b8), and
[Bun CPU profiling](https://bun.sh/docs/project/benchmarking).
