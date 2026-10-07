# Compare compiled HTTP applications

Use this comparison when deciding whether route dispatch or application policy needs less CPU work. The same account API
runs through Utils, Hono, Elysia and Vixeny. Each implementation must satisfy authored request and response literals
before Mitata records a number.

The [2026-10-07 review](./http-challengers-review-20261007.md) contains completed three-runtime timings, flamegraphs,
the retained dispatch change and the next performance decisions.

```sh
mise exec -- pnpm install --frozen-lockfile
mise exec -- deno task bench:prepare
mise exec -- deno run --no-check -A bench/http-challengers.bench.ts --check
mise exec -- node bench/http-challengers.bench.ts --check
mise exec -- bun bench/http-challengers.bench.ts --check

mise exec -- deno task bench:challengers .artifacts/comparison/deno --runtime=deno
mise exec -- deno task bench:challengers .artifacts/comparison/node --runtime=node
mise exec -- deno task bench:challengers .artifacts/comparison/bun --runtime=bun
```

Each comparison runs eight fresh processes serially. Four balanced candidate orders run twice; each candidate occupies
each position twice and follows each other candidate twice. Native Mitata JSON, stderr, configuration, source hashes and
paired ratios remain in the selected directory. Use a new directory for a new experiment. Do not combine numbers from
different runtime directories into a library-only speed ratio.

PNPM owns `pnpm-lock.yaml` formatting. The Deno formatter checks authored files and excludes that generated lockfile, so
a dependency install cannot fail CI by restoring PNPM's normal YAML layout.

`comparison.json` reports Utils mean time divided by each competitor's mean time. A ratio below one means less Utils
time for that workload. Its individual 95% interval estimates uncertainty across the eight paired process means using
log ratios and a Student-t model. An interval crossing one leaves the difference unresolved; it does not prove
equivalence or a margin of error. Shared machine load, systematic bias and comparisons across many workloads remain
limits.

## The application and routing boundaries

The API batch includes all 35 [authored cases](../tests/fixtures/http-parity/corpus.ts): decoded parameters, repeated
queries, strict slashes, HEAD bodies, safe errors, request-local state, JSON admission, exact UTF-8 byte limits,
streamed input, framing bypass and transformed account input. The three routing batches each register exactly 16, 256 or
4096 routes, half static and half parameterized. Each batch selects first, middle and late positions and includes
misses.

Every timed operation creates fresh Requests and consumes complete response bodies and selected headers. Prepared
applications are reused. Compilation, untimed literal assertions, warmup and close sit outside warm dispatch timing. The
routing batches measure request creation, native route selection, response materialization and consumption together.
They are not isolated lookup timings.

| Candidate     | Selected implementation                                                                                            | Application policy and limits                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Utils         | Direct HTTP and server imports; a real compiled account service                                                    | Schema, declared response and resource ownership costs remain.                                                                                                                                          |
| Hono 4.13.5   | Native strict router, onion middleware and body-limit middleware                                                   | Account validation and the selected error policy are application code.                                                                                                                                  |
| Elysia 1.4.30 | AOT, precompile, strict paths and compiled Fetch; default adapter on Bun, public Web Standard adapter on Deno/Node | Ordered lifecycle hooks reproduce selected state/order observations. They do not implement general onion delegation. Explicit readers enforce portable byte admission; TypeBox validates account input. |
| Vixeny 0.1.53 | Public response-petition compiler and parameter component; native matcher                                          | Explicit application policies supply HEAD bodies, decoding, repeated query values, byte limits and middleware. They reproduce these outputs without implementing Utils service resources.               |

The native routers select endpoints; no challenger delegates route selection to Utils or a hand-written matcher.
Precedence differences remain separate tests: registering a parameter before a static route can change which handler
wins. The shared corpus deliberately registers the required static route first.

These are in-process Fetch comparisons. Elysia's native listening-server route offload, TCP throughput, provider
authority, deadlines, proxy cancellation and service resource lifetimes need their own boundaries. The existing Hono
gateway and proxy suites remain independent and are not labeled Elysia/Vixeny parity.

## Why Vixeny has a preparation step

The pinned npm archive exposes `main.ts` and has no JavaScript compiler entry. Deno and Node refuse to strip that
TypeScript under `node_modules`. Its source also has type errors under this repository's strict compiler, and its
published TypeScript peer range is `^5.0.0`.

`tools/challenger-build.mjs` uses the existing TypeScript 6.0.3 emitter and tsdown 0.22.14 to erase types and emit one
unminified ESM artifact. Tree shaking is disabled and native built-ins remain external. Type erasure precedes bundler
parsing because the archive contains an empty type-only generic parameter list. The source files stay intact. Function
text matters to parts of Vixeny's compiler, so minification would change more than packaging.

All three runtimes load the same emitted artifact. Its receipt hashes the full installed package graph, lockfile, build
task, compiler settings, output and source map. The fixture checks the selected exports at its loading boundary. The
repeat and profile owners hash the artifact and receipt again. This qualifies the selected runtime behavior; it does not
establish upstream strict TypeScript 6/7 compatibility. The artifact is ignored and never added to a Utils package.

## Attribute the work before changing it

```sh
mise exec -- deno task bench:profile .artifacts/profile/challengers-deno \
  --section=http --match=challenger- --duration=1000
mise exec -- deno task bench:profile .artifacts/profile/challengers-node \
  --section=http --runtime=node --match=challenger- --duration=1000
mise exec -- deno task bench:profile:bun .artifacts/profile/challengers-bun \
  --match=challenger- --duration=3000
mise exec -- node bench/profile-render.mjs .artifacts/profile/challengers-deno
```

The registry contains 63 workload IDs and four candidates: the four batch workloads plus each individual API and routing
vector. A full runtime selection produces 252 native graphs. `--candidate=elysia` or another candidate narrows the
Deno/Node HTTP controller; the existing paired workloads retain their owners.

Deno and Node use an external inspector gate after setup, literal validation and warmup. Bun uses its native
JavaScriptCore CLI profiler and retains a broader process graph including startup, construction, validation and warmup.
Those graphs are diagnostic evidence and cannot be treated as the same profile window. Bun profiler sample deltas can
bill idle gaps to a JavaScript frame; check the runtime's idle control before interpreting weighted self time as active
CPU. All profiled elapsed values are diagnostic. Establish throughput changes with fresh unprofiled comparisons after
correctness passes.

The graph renderer retains raw CPU profiles and creates SVG flamegraphs plus JSON function summaries. A wide parent
includes its descendants; do not sum inclusive percentages as independent costs. Use the individual vector profiles to
distinguish routing, validation, body admission, response construction and cleanup rather than attributing an entire API
batch to the router.
