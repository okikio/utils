# Profile an operation before changing it

The [four-candidate HTTP guide](./http-challengers.md) extends this owner to compiled Elysia and Vixeny requests and
provides the native Bun profiling command. Keep its dependency preparation and JavaScriptCore capture boundary visible
when comparing those graphs with the warmed V8 captures below.

Start with the same API request on both implementations. This records warmed gateway forwarding, including fresh
Requests and fully consumed response observations:

```sh
mise exec -- deno task bench:profile .artifacts/profile/gateway --section=http --match=gateway --duration=1500
mise exec -- node bench/profile-render.mjs .artifacts/profile/gateway
```

Open `gateway-utils-0.cpuprofile.svg` and its Hono counterpart. Hover for the sampled function and source URL; click a
frame to zoom. The raw `.cpuprofile` also opens in DevTools. Read `coverage.json` before interpreting the graph: it
contains the source hashes, workload identities, runtime and successful child receipts. A failed run retains its earlier
recordings and reports failure. Instrumented elapsed time is a diagnostic receipt, not a benchmark estimate.

## Find the expensive request

The HTTP section includes the complete 35-request API corpus and each request separately, the forwarding gateway,
16/256/4096-route tables and their eight individual hit/miss positions. It also includes the translated upstream
router/request/response/application families, every ordinary upstream proxy vector, client disconnect, middleware depth
and route construction. Compiled service cases with 0/4/16 resource-using middleware qualify permission checks and
request-scope closure. Those service cases have no equivalent Hono implementation and are labeled Utils-only.

```sh
mise exec -- deno task bench:profile .artifacts/profile/http --section=http
mise exec -- node bench/profile-render.mjs .artifacts/profile/http
```

Filter by identity with `--match=proxy` or `--match=service-middleware`. Construction callbacks deliberately include
route registration and the first response. Warm dispatch callbacks prepare the application before sampling. Each HTTP
callback checks independent literal expectations before warming, consumes its output and joins its owner.

Use `--runtime=node --section=http` to record those same source fixtures under native Node. The suite section uses Deno
host fixtures and rejects that option. Keep runtime rows separate: Web API body, header and stream costs can differ even
when both implementations produce the expected observations.

The original proxy inputs preserve meaningful policy differences. For example, strict Hono proxying rejects an invalid
Connection nomination while the gateway ignores an invalid token and strips valid nominations. A graph of those cases
explains each implementation's work; their ratios cannot prove interchangeable behavior. The Request-as-init Hono
fixture also temporarily installs its mock Fetch transport inside the callback. Its graph includes that fixture cost.
The gateway creates trace identities and retains cancellation authority; its minimal Hono policy counterpart does less
lifecycle work. Keep these distinctions with any comparison.

## Profile the benchmark inventory

```sh
mise exec -- deno task bench:profile .artifacts/profile/suite --section=suite
mise exec -- node bench/profile-render.mjs .artifacts/profile/suite
```

This runs the canonical program registry serially and samples each real Mitata `B.run` registration separately. Each
receipt retains its collection index, name and expanded argument runs. The region includes Mitata's trial warmup, GC
policy and measurement machinery. Fixture construction, global calibration and final teardown stay outside it.
Range-driven arguments can share one registration profile; the receipt lists those expansions explicitly. The diagnostic
hook checks the pinned Mitata trial representation and restores its method after the child finishes. Ordinary benchmark
runs do not install the hook.

Add `--npm` after `deno task npm:verify` to include the physically installed Node ESM/CommonJS import benchmarks. A
parent import or host-operation profile measures spawn, messaging and output collection. It does not establish CPU
coverage of a subprocess or a Worker isolate. Use the separate startup and worker drivers for those boundaries.

```sh
mise exec -- node bench/profile-startup.mjs .artifacts/profile/imports --section=source
mise exec -- deno task npm:verify
mise exec -- node bench/profile-startup.mjs .artifacts/profile/npm-imports --section=npm
mise exec -- node bench/profile-worker.mjs .artifacts/profile/worker --count=10000
mise exec -- node bench/profile-worker.mjs .artifacts/profile/worker-startup --phase=startup
mise exec -- node bench/profile-process.mjs .artifacts/profile/process-child
```

The startup driver profiles each actual child. Native Node uses startup-to-exit CPU sampling. If the pinned Deno CLI
does not expose CPU-profile flags, the driver pauses the real import fixture and samples its initial JavaScript
execution through the import receipt. That fallback excludes native process startup and final shutdown. Its receipt
states which boundary ran. The Worker driver checks the discovered fixture URL, verifies the worker realm, samples the
worker session around correlated requests, and joins acknowledged shutdown. A missing target or missing worker frames
produces explicit incomplete coverage instead of claiming that parent samples cover the isolate.

The Worker startup mode starts sampling before resuming the verified waiting target and stops at its first validated
response. It excludes native Worker instantiation before inspector attachment. The process driver profiles the exact
`console.log("READY")` child used by the host benchmark, under both Utils ownership and raw Deno.Command. It retains
bounded capture and joined cleanup while forwarding diagnostic inspector information. Its initial-script pause excludes
native process launch and final exit. That tiny child has no transport or application workload to profile; those require
additional real child fixtures.

## Turn a hotspot into a change

Use exclusive samples to identify work performed by a function. Inclusive samples include descendants and can overlap;
do not add them into a latency budget. Async continuations can appear on separate stacks, so a small ancestor share does
not rule out a distributed cost. Garbage collection and native Request/Headers/Response work remain real costs.

Name the removable work and its controlling invariant before editing. Retain the raw baseline and exact source. For
example, a gateway completion callback can be omitted when there is no deadline and no completion, failure or abort
subscriber. Caller cancellation still requires its abortable body. Qualification must exercise full consumption, stream
failure, consumer cancellation, caller abortion and the branches where the callback remains necessary.

Then collect a new profile and repeat the unprofiled benchmark in fresh processes with counterbalanced order. A
disappearing frame proves work was removed from that recording. A speedup needs repeated timing evidence with an
uncertainty interval. An interval containing one leaves the difference unresolved; it does not prove equivalence. Record
runner quotas and competing load. Heap before/after receipts do not measure peak or retained heap.

The dated [utility and Hono review](./profile-review-20261007.md) links evidence and separates measured causes, accepted
changes and remaining hypotheses. Profile coverage is bounded by the benchmark and translated fixture inventories; it is
not every possible API call, every preserved upstream Hono registration, or a deployed network workload.
