Benchmarks
==========

This guide defines how the repository supports performance claims. A benchmark
must answer a real implementation question and must preserve the behavior being
compared.

Benchmark placement
-------------------

Package-local `*.bench.ts` files measure one focused mechanism. Root `bench/`
scenarios measure work that crosses several packages.

Use Mitata for canonical repository benchmarks. Keep exploratory results from
other hosts clearly labeled with the runtime and version that produced them.

Reference implementations
-------------------------

An optimized implementation needs a separate correctness oracle when practical.
The HTTP router benchmark compares prepared lookup with an independent linear
matcher. The correctness tests first prove that both implementations select the
same routes.

A performance result is useful only after the semantic comparison succeeds.

Representative workloads
------------------------

Measure the physical work that matters to the caller. Depending on the package,
record throughput, latency distribution, allocations, retained memory, startup,
cleanup, cancellation latency, provider calls, writes, or active resources.

Router workloads should vary:

 -  route count
 -  static and parameterized route mix
 -  HTTP method mix
 -  path depth
 -  hit and miss ratio
 -  route specificity

A one-route microbenchmark cannot justify a routing architecture.

Bundle and type-check performance
---------------------------------

Runtime throughput, consumer bundle size, and TypeScript cost are separate
budgets.

Use `tools/check-treeshake.ts` to detect bundle regressions between focused
imports and the matching `@okikio/utils/*` imports. Measure editor and type-check
cost separately when public declaration graphs or generics become large.

Run benchmarks
--------------

Run all registered benchmarks through mise:

~~~~ sh
mise run bench
~~~~

Or run the Deno task directly:

~~~~ sh
deno task bench
~~~~

Record the runtime version, workload parameters, and comparison baseline with any
published number. Do not report an exploratory Node result as a Deno benchmark.
