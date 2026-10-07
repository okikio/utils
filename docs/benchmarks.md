# Benchmarks

Use the [profiling guide](./profiling.md) to locate CPU work in individual benchmark trials and matched Hono requests
before changing an implementation. Profiling explains attribution; repeat unprofiled timings to establish a speedup.

This guide defines how the repository supports performance claims. A benchmark must answer a real implementation
question and must preserve the behavior being compared.

The [compiled HTTP challenger guide](./http-challengers.md) compares Utils with Hono, Elysia and Vixeny on one runtime
at a time. It explains the literal preflight, the TypeScript-only Vixeny dependency emission, eight balanced fresh
processes and the different V8/JavaScriptCore profile boundaries.

## Benchmark placement

Package-local `*.bench.ts` files measure one focused mechanism. Root `bench/` scenarios measure work that crosses
several packages.

Use Mitata for canonical repository benchmarks. Keep exploratory results from other hosts clearly labeled with the
runtime and version that produced them.

## Reference implementations

An optimized implementation needs a separate correctness oracle when practical. The HTTP router benchmark compares
prepared lookup with an independent linear matcher. The correctness tests first prove that both implementations select
the same routes.

A performance result is useful only after the semantic comparison succeeds.

## Representative workloads

Measure the physical work that matters to the caller. Depending on the package, record throughput, latency distribution,
allocations, retained memory, startup, cleanup, cancellation latency, provider calls, writes, or active resources.

Router workloads should vary:

- route count
- static and parameterized route mix
- HTTP method mix
- path depth
- hit and miss ratio
- route specificity

A one-route microbenchmark cannot justify a routing architecture.

## Bundle and type-check performance

Runtime throughput, consumer bundle size, and TypeScript cost are separate budgets.

Use `tools/check-treeshake.ts` to detect bundle regressions between focused imports and the matching `@okikio/utils/*`
imports. Measure editor and type-check cost separately when public declaration graphs or generics become large.

## Run benchmarks

Run all registered benchmarks through mise:

```sh
mise run bench
```

Or run the Deno task directly:

```sh
deno task bench
```

Record the runtime version, workload parameters, and comparison baseline with any published number. Do not report an
exploratory Node result as a Deno benchmark.

## What the current workloads measure

| Workload                | Semantic proof before timing                                                               | Measured boundary and limit                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Environment             | Both parsed field values                                                                   | Parse and coerce an explicit record; no ambient environment read                                      |
| CSV collecting          | Every value in 10,000 five-column rows, plus a tiny fixture                                | Byte decoding, dialect/header discovery, row validation and document allocation                       |
| CSV streaming           | The same exact cells and row order                                                         | 64 KiB source chunks, parsing and incremental counting; consumer retains no row array                 |
| CSV tokenizer reference | The raw header plus the same exact data cells                                              | Tokenization only; excludes the utility's metadata, diagnostics and discovery                         |
| Queue                   | FIFO inputs, exact reference/result association and terminal counts                        | Add, claim and complete 1,000 items, including ownership and cleanup                                  |
| Array FIFO reference    | Primitive values consumed                                                                  | Cost reference only; no leases, expiry, fencing or stored completions                                 |
| Pool                    | Borrowed values and returned occupancy                                                     | Warm acquire/release and lease return; direct object binding reads are a separate primitive reference |
| Activity dispatch       | Unique job input and corresponding result for every reference                              | Add, claim and complete activities; no executor or workflow replay is measured                        |
| Coordination            | Result still belongs to its input and one of four pooled resources; no live leases/waiters | 100 queue jobs through a four-resource pool, including UUID creation and cleanup                      |
| HTTP composition        | Status, middleware headers and JSON payload                                                | Separate headers/body cancellation from complete JSON consumption; no network listener                |
| Discovery               | Exact CRM cells, sitemap URL set, HTML/CSS references and denied/allowed robots paths      | Parse a fixed corpus; no fetch, DNS, cache or crawler scheduling                                      |
| Workflow identity       | Repeated instructions share fingerprints; changed instructions do not                      | Hash 32 timer instructions; no workflow execution, durable storage or restart                         |
| Router                  | Every prepared result agrees with an independent linear route selection                    | 16, 256 and 4,096 routes, 256 requests, static/parameter paths, HEAD fallback and misses              |

Run `deno task bench:check` for these oracles without collecting a performance number. A failed Mitata case also fails
the measuring command through its `throw` option. None of the workloads impose a minimum speed, exact duration, exact
generated ID or allocation count.

The CSV tokenizer, array FIFO and direct value read do less work than their utility counterparts. Their costs can
explain overhead; their ratios do not prove a faster equivalent implementation. The router candidates do equivalent
request selection for the supplied corpus. Separate correctness tests cover route overlap and specificity; the benchmark
does not claim to model every production route distribution.

The stream workload bounds application retention, not measured peak heap. Parser buffers, chunk size, headers and
runtime allocation still contribute. A bounded consumer test cannot substantiate a numerical memory claim. Add a native
heap experiment before publishing one, and include Unicode, quoting, encoding and chunk distributions when evaluating a
changed CSV implementation.

## Qualify the full package inventory

`bench/coverage.json` maps every publishable source package to a concrete performance question, executable program,
comparison and limit. `docs/qualification.json` incorporates that mapping. Run `mise run qualification-check` to catch
missing packages or programs instead of maintaining an informal list. `@okikio/dispose` exports pure local constructors;
its import cost is separate from the cleanup and failure contracts qualified by tests. The umbrella package measures
focused adoption against its eager `all` import; it does not duplicate every utility's workload.

The added workloads complement the original table:

| Program              | Workload and untimed proof                                                                                                               | Comparison and boundary                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `values.bench.ts`    | 100 independently known validated records, IDs and versions; timestamp and query round trips; trusted failures and bounded faults        | npm Zod and native Map, record, Date and tagged-value operations; JSR `@std/semver`. Baselines omit the contracts named in their case labels.                                         |
| `contracts.bench.ts` | Accepted/denied authorization, interpreted entitlements, validated effects, timestamped meter readings and bounded resilience plans      | Local policy and accepting sink only; no remote policy server or durable outbox.                                                                                                      |
| `lifetimes.bench.ts` | Atomic capacity, owned resources, checkpointed tasks, 100-child cancellation and joined cleanup, ordered transforms, bounded diagnostics | JSR `@std/async` for the same successful map results; cancellation/failure contracts differ. Stream scales are 100 and 102,400 lines in 31-byte chunks with no application row array. |
| `hosts.bench.ts`     | Real Worker cold startup/request/shutdown, warm validated requests, child startup/capture/join and permission argument escaping          | Raw `Deno.Command` runs the identical child but omits context ownership and capture bounds. Native Deno host proof only.                                                              |
| `recovery.bench.ts`  | A real activity returns `hello`, a replacement Scheduler replays `hello`, and the provider runs exactly once                             | Process-local dispatch and history, retained by the benchmark process. This proves Scheduler replacement, not recovery after process death.                                           |
| Hono package         | Same successful JSON response fully consumed through the adapter and direct Hono                                                         | npm Hono direct fetch omits the security middleware; no network listener.                                                                                                             |
| `imports.bench.ts`   | Fresh child imports each source root and the eager umbrella; imports must succeed and return a valid receipt                             | Same child without a package import. Launch/exit cost is included; OS and dependency caches may be warm.                                                                              |
| CSV package          | Exact independent cells for plain 10k-row imports and 256 quoted Unicode/newline rows with 1 KiB payloads                                | npm `csv-parse` and JSR `@std/csv` raw tokenizers; 31-byte quoted-stream chunks stress decoder and quote boundaries.                                                                  |

A baseline is not an architectural substitute merely because it is faster. The record facade, queue leases, permission
checks and owned hosts do more work than their primitive references. Compare equivalent output where possible, then use
the extra contract and its cost to decide whether the utility fits the caller.

## Retain reproducible measurements

`mise run bench` executes every registered program serially. Each program owns a fresh Mitata registration realm. The
runner stores native JSON samples and stderr separately under `.artifacts/bench/<timestamp>/`, together with runtime,
CPU, platform, color policy, GC policy, exact child arguments and SHA-256 hashes of source, fixtures, manifests and
lockfiles. Source hashes are checked again after the last program. A changed input, failed workload, truncated report or
empty sample set cannot become a completed measurement. A watchdog bounds a stuck program; it is not a speed gate. Pass
a directory explicitly with `deno task bench /path/to/report` when preserving evidence outside the checkout.

Mitata receives `throw: true` and `colors: false`. Package benchmark profiles explicitly grant `NODE_DISABLE_COLORS`,
`NO_COLOR`, `FORCE_COLOR` and `CI`; the serial runner uses a fixed plain-output policy. This prevents a terminal-policy
lookup from failing before a benchmark starts in a restricted Deno environment. Manual GC is exposed consistently; each
case states its collection choice. Samples and available heap/GC observations remain in the native report.

`mise run bench-check` runs the actual untimed fixtures and correctness oracles in isolated child processes. CI runs
this gate and does not use noisy shared-runner timings to accept a release. Full native measurements belong on an idle
machine. The report records the environment but cannot certify that unrelated work was absent. No throughput, elapsed
millisecond, heap size or fixed output-text threshold is part of the correctness contract.

The measurement task runs with full permissions because it launches the declared native host fixtures and reads Linux
cgroup quotas. Deno requires full permission for those special filesystem paths even when ordinary read and system
permissions are granted. The focused Env benchmark retains its restricted profile; the measurement owner has the
authority of the selected fixture programs.

Heap deltas from Mitata are parent V8 allocation observations, exclude Worker and subprocess RSS, and not a leak proof
or peak-RSS experiment. The stream cases prove incremental application consumption and measure increasing work; they do
not publish a numeric memory bound. Native host tests and composed lifecycle scenarios separately prove ownership and
terminal behavior. Browser engines, deployed durable adapters and remote clusters require their own
environment-qualified measurements.

After `mise run npm-verify` creates the physical clean consumer, measure its ESM and CommonJS package roots with
`mise run bench-npm`. Read the owned temporary consumer path from `.artifacts/npm/consumer-location.json` when supplying
it explicitly. The consumer lives outside the checkout so Node cannot find uninstalled workspace packages through
ancestor directories. This separate program includes all portable npm roots, the focused umbrella result subpath, the
eager umbrella and matched empty-child baselines. `@okikio/deno` is deliberately absent from npm. Every trial uses a
fresh native Node process that resolves the installed archives; it does not import workspace TypeScript. These costs
include launch/exit and do not imply an OS cache was cold.

To include those cases in the same retained serial report, pass both paths:
`deno task bench /path/to/report /path/to/physical-consumer`. The npm gate also retains strict all-subpath ESM/CommonJS
TypeScript diagnostics and owned declaration size in its clean consumer's `types-report.json`. That elapsed time
includes compiler startup and is a declaration correctness/size observation, not an editor responsiveness guarantee.
