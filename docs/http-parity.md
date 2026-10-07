# Compare one API through Hono and Utils

Correctness precedes performance. The same explicit request corpus runs through independent Hono and Utils API
implementations. Each response is checked against an authored status, selected headers and consumed body; agreement
between implementations alone cannot define the expected behavior. Fresh applications isolate mutable request state. The
Utils implementation imports no Hono. The Hono implementation imports no production Utils.

The fixture uses health and parameter routes, onion middleware, request-local state, method and trailing-slash behavior,
explicit errors, validated JSON and forwarded service requests. Upstream Hono inputs retain their pinned source and
license provenance beside the fixture. Only shared contracts are compared. Framework-specific regular-expression routes,
wildcards and default diagnostic wording are not silently added to the Utils contract.

Run correctness and performance separately:

```sh
mise exec -- deno test -A tests/http-parity.test.ts
mise run bench-check
mise run bench-compare .artifacts/comparison/http
```

The performance program reuses the correctness fixture. Both sides register the same routes, satisfy the selected
response requirements and consume response bodies. Construction is outside warm request trials; route count scaling is
explicit. Each native Mitata result and metadata receipt is retained. This is in-process Fetch dispatch, not a socket
throughput or deployed-service benchmark.

Equal selected outputs do not mean equal internal work. The Utils account service validates declared outputs and owns
request context, correlation, negotiation and cleanup; the Hono handlers implement the selected account rule directly.
The Utils gateway also applies general trust, framing, redirect and streaming policies that exceed the handwritten Hono
fixture. Those costs remain in the comparison. Each fixture prepares its definitions before timing. The Utils middleware
sets headers on fresh local responses directly, so the fixture does not add an unnecessary response copy.

Timed batches finish after response bytes and selected fields have been consumed. Response completion callbacks may
still be settling asynchronously; the service owner's final shutdown joins its cleanup outside timing. These results
therefore measure warm dispatch with consumed output, not fully joined per-request retirement.

Six fresh processes alternate candidate registration order. Each trial contributes one mean for each implementation and
workload. The report summarizes paired log time ratios using a two-sided 95% Student-t interval with five degrees of
freedom. This models run-to-run noise under approximately independent, normal log ratios; the six trials share one host
and cannot exclude systematic bias. The method follows the
[NIST mean confidence interval](https://www.itl.nist.gov/div898/handbook/eda/section3/eda352.htm).

A Utils/Hono ratio below one means lower measured Utils time. An interval entirely below or above one resolves a
difference under that model. An interval containing one means these measurements do not resolve the difference; it does
not establish equivalence or justify calling a slower point estimate equal. No arbitrary elapsed-time or percentage gate
is added to PR CI. Report fixture size, runtime, resource quotas and raw uncertainty with a claim.

Prepared routing is an implementation hypothesis, not proof of speed. Endpoint partitioning and middleware preparation
need measurements that cover late matches, misses and parameter extraction while preserving response contracts. Vixeny
is useful architectural context, but its benchmark claims do not establish the performance of this implementation.

The shared vectors found three production contract defects: HEAD normalization had to happen after middleware, error and
mount responses; empty dynamic route parameters had to reject; and gateway forwarding had to remove every header named
by `Connection` on both hops. Gateway trust filtering now snapshots header names before deletion, so adjacent spoofed
trust fields cannot be skipped by a live iterator.

The route index caches template segments and partitions dynamic candidates by the literal prefix before their first
parameter. It preserves the existing specificity order with an independent linear-matcher test across methods and
reversed registration. Parameter-leading routes still share a candidate bucket; this does not claim constant-time lookup
for every possible route shape. Scaling workloads include first, middle, late and missing paths to expose the cost that
a single health route would conceal.
