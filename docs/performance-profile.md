# HTTP profiling — 2026-10-07

The later [utility and Hono review](./profile-review-20261007.md) expands these recordings to every canonical benchmark
program, individual HTTP requests, native Node, actual import children and the Worker isolate. It records the next
gateway and service changes, their before/after timings and the remaining Hono gap. The evidence below belongs to the
earlier header-copy experiment and is retained separately.

Open the saved gateway flamegraph in `.artifacts/profile/20261007/profiles/gateway-utils.cpuprofile.svg` and hover a
frame for its function, sampled share and URL. Click a frame to zoom. The matching Hono, API and 4096-route graphs are
in the same directory. The final gateway pair is in `profiles-after/`. Raw V8 profiles, all trial receipts, source
identities and the report renderer are retained alongside these graphs. Recreate the capped runner using the evidence
README before rerunning its private workload.

The measured gateway cost is mostly header and transport work. In the warmed Utils gateway profile, forwarding headers
occupies **24.50%** of sampled time including its children. Its generic `toHeaders` conversion occupies **21.91%**,
including **16.12%** in `normalizeSource`. These percentages overlap; they must not be added. That path turns already
validated native headers into validated field tuples, canonicalizes names, then appends them to a new Headers instance
on both forwarding hops.

Gateway route matching occupies **0.72%** of sampled time. Request correlation occupies **5.85%**, including **5.24%**
in random trace ID creation. Configuring a constant request ID does not remove the independently generated trace and
span IDs. These are sampled shares of this one successful forwarding workload, rather than a latency budget or a
measurement of every gateway policy.

The response ownership hypothesis is less clear. `abortableResponse` construction occupies **4.96%**; its pull path and
completion callbacks also appear on separate asynchronous stacks. Ancestor sampling does not join all work across an
await. Removing completion tracking in a private counterfactual therefore supplied a second kind of evidence: actual
unprofiled, fully consumed requests with unchanged literal output preflight.

| Experiment                                                                     | Candidate/baseline mean-time ratio | Approximate 95% interval | Result                                                            |
| ------------------------------------------------------------------------------ | ---------------------------------: | ------------------------ | ----------------------------------------------------------------- |
| Disable completion tracking in a private gateway copy                          |                              1.193 | 0.786–1.810              | Inconclusive; does not justify removing ownership                 |
| Copy native Headers directly in the real gateway workload                      |                              0.786 | 0.615–1.004              | Inconclusive; about 21% lower point estimate, interval includes 1 |
| Same header-copy operation with Mitata, repeated cookies and connection fields |                              1.270 | 0.617–2.617              | Inconclusive; substantial trial variability                       |

Each experiment has six fresh-process pairs with alternating candidate order. Intervals use paired log mean-time ratios
and Student t with five degrees of freedom. The two private whole-gateway experiments each consume 30,000 fresh requests
per candidate and verify literal output before warming and timing. The Mitata experiment verifies the exact forwarded
field/cookie values and unchanged input before timing. It uses the original forwarding algorithm as its baseline and the
public changed function as its candidate. These intervals are descriptive, not timing acceptance thresholds. Containing
1 is not evidence of equivalence.

The shared Docker host was noisy. The runner has two CPU cores and 2 GiB of memory; its resource receipt records CPU
throttling and memory pressure with no OOM kill. The receipt covers the whole session and cannot assign a particular
slow trial to a particular resource event. More repetitions under that changing load would not establish a reliable
performance promise. The earlier [paired comparison](./comparison-report.md) established a gateway penalty but left the
API comparison inconclusive. Sampling overhead makes the profile's elapsed ratios unsuitable for replacing those
benchmark results.

The API graph shows a broader cost distribution. Bounded body reads occupy **10.56%**, service result finalization
**6.35%**, service request preparation **4.31%**, and route selection **3.02%** including its children. These operations
preserve limits, schema validation, request scopes and result ownership. The current data does not identify one API
regression or justify removing those contracts. The 4096-route graphs also show that optimized endpoint lookup is a
separate workload from gateway transport and service execution.

The Hono gateway benchmark implements the selected policy in one public Hono handler with native Fetch objects. It
buffers the request body and returns an upstream body without Utils' completion tracking or W3C trace creation. The wire
oracle is shared, but the lifecycle and tracing contracts are different. The separately ported Hono proxy tests qualify
many additional transport situations; passing them does not make this single-policy timing fixture a benchmark of every
proxy feature.

## The source change and its limits

`@okikio/http/headers.forward` now copies its native Headers input directly. Connection filtering, invalid token
handling, separate cookies and input immutability remain asserted. This removes the generic field-tuple validation path
from that function. It does not promise a measured end-to-end speedup; the intervals above remain inconclusive.
Cancellation, completion observation, deadline ownership, trust filtering and trace identity remain active.

A second gateway pair was recorded after qualification. Its Utils profile has no samples in `toHeaders` or
`normalizeSource`, confirming that the conversion path disappeared. Header forwarding still occupies **23.92%** of
sampled time including native Headers work, compared with **24.50%** before. Those are proportions from separate
recordings, not a speedup estimate. Native header copying and iteration remain substantial; this change did not make
forwarding free or establish that the slowdown is solved.

The new Hono tests also found independent correctness defects: repeated middleware continuations could invoke a terminal
twice, malformed connection tokens could throw while forwarding, a rejected redirect could abandon its body, and an
upstream adapter could return a body after caller cancellation. The source fixes and their literal outcomes are covered
by the expanded Hono, header and gateway suites. Gzip/br normalization preserves unknown codings and bodyless
representation metadata. The [coverage ledger](./hono-coverage.md) separates translated observations, API differences,
retained upstream source and remaining unmapped test registrations.

## How the samples were collected

The workload runs the existing 35-request API corpus, the gateway forwarding corpus, and eight route positions in a
4096-route table. Each library creates its own fresh Requests and consumes complete response observations. Definition
construction, literal preflight, warmup and final shutdown stay outside the sampled region. External CDP starts V8
sampling at 100 microseconds after warmup and stops after the workload receipt. The region also includes the start/stop
handshakes and their scheduling delays; idle samples remain visible. Deno's node:inspector Session API is a stub, so
using an external inspector avoids claiming an in-process recording that never started.

The runtime is Deno 2.9.7, V8 15.0.245.2-rusty, with Node 26.10.0 controlling CDP. Mise 2026.10.3 and Tini 0.19.0
install and join the real tools. Hono is 4.13.5 at commit 06880c4a2b04de9dd74217f26dd831209b9c01f1. The profile
represents JavaScript, V8 and exposed runtime-operation frames, not a native kernel or network wait profile. This
transport fixture does not contact an external server. Profile source line numbers refer to transpiled scripts and must
not be treated as verified TypeScript line numbers without source maps.

The renderer retains every raw profile unchanged. One 4096-route Utils sample had a negative 2 microsecond delta; only
the SVG displays that sample with zero width. Its summary records the correction explicitly. The other seven profiles
need no such correction. Sampled percentages describe execution attribution, not causal proof that changing one function
will change elapsed time by that percentage.

## Verification

Runtime and compiler outcomes, command logs, source hashes and final artifact checks are recorded in
`.artifacts/profile/20261007/status.json`. The expanded source tests run on Deno and Node. The complete original source
archive has 139 files and 2,911 lexical test sites; 254 sites are linked to executable selections. All 14 proxy
registrations are ported, and all 32 composition registrations have an applicability decision. A linked core
registration can contain additional assertions beyond the selected observations, so it does not mean every upstream
assertion passed. The new corpora are not claimed as emitted-package scenarios; the existing packed consumer scenarios
remain a separate lane.
