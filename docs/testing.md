# Testing

This guide explains where tests belong and what evidence they must provide. Package tests protect focused contracts.
Root tests prove that several packages compose correctly through their public imports.

## Test placement

Package-local `*.test.ts` files own unit behavior, lifecycle rules, edge cases, and protocol conformance for one
package.

Root `tests/` owns cross-package scenarios, public-import contracts, and consumer flows. A test belongs there when a
failure could come from the interaction of several packages rather than one local implementation.

Benchmarks remain separate from correctness tests. A faster result is useful only after a correctness test proves
equivalent behavior.

## Optimized implementations

An optimization needs an independent oracle. The prepared HTTP router is compared with a separate linear matcher over
generated route and request cases. The reference matcher must not call the optimized matcher to compute its expected
result.

Use the same pattern for parsers, normalization, caches, and other optimized code when a direct reference implementation
is practical.

## Public type contracts

Type inference is part of the package API. Add small consumer fixtures when a public generic, schema-derived input,
overload, or discriminated union has non-trivial inference.

A useful fixture set includes a program that must type-check and a program that must fail for the intended reason.

Run the TypeScript compiler with the declared `@types/deno` runtime types:

```sh
deno task type
```

The task invokes the pinned local TypeScript compiler against the root `tsconfig.json`. It does not run `deno check` or
generate a second declaration source. Use this gate for TypeScript diagnostics. Use Deno tests for Deno runtime
behavior.

## Failure and limit cases

Test the cases that change behavior or ownership. Depending on the capability, this can include:

- empty or malformed input
- the exact minimum and maximum values
- one value outside each supported limit
- cancellation before and during work
- partial reads or writes
- cleanup after failure
- concurrent operations
- stale completion
- retry exhaustion
- unsupported runtime capabilities

Do not add every case to every package. Add the cases that protect the package's actual contract.

Assert error classes, stable issue codes and affected fields when those contracts exist. Diagnostic prose can change
without changing behavior. When a callback supplies its own failure, assert that the same error or cancellation reason
survives rather than requiring the utility to reproduce a message. A message assertion belongs in a test only when the
message itself is the documented result.

## Run verification

Use the repository verification task before publication:

```sh
mise run verify
```

The equivalent Deno task is:

```sh
deno task verify
```

A blocked native check remains blocked. A host-side smoke test can provide useful evidence, but it does not convert an
unavailable Deno, browser, provider, or package-artifact check into a pass.

The verification task also runs `deno task test:node`. That task starts real Node tests for native process ownership,
missing-global compatibility, and the portable task, pool, query, CSV and static contract consumers. Its executable
imports the optional Temporal and disposal polyfills explicitly. The Node selection is declared in
[`tools/check-node.ts`](../tools/check-node.ts); Deno-only request graphs and socket tests remain in the Deno suite. Use
the installed workspace dependencies and a Node version that supports this repository's TypeScript source.

## Test the contract, not the formatting

`tests/docs.test.ts` compiles and runs explicitly marked README examples. It checks their public inputs and outputs
rather than enforcing a heading, a fence style, a line count or vocabulary. Edit explanations freely. Update an
example's expected output when its demonstrated behavior intentionally changes; avoid printing timestamps, random IDs or
stacks that are not the example's subject. The checker removes its temporary modules even when compilation or execution
fails. A Worker example includes its companion module and gets read permission; the process example alone gets
child-process permission.

Use entered/settled promises to control asynchronous races, and `TestClock` for logical expiry. A timeout is a generous
stuck-test diagnostic, not a speed contract. Stream tests assert concatenated bytes, not a platform-specific chunk
boundary. OS process disappearance needs bounded polling because no direct child handle owns a grandchild. Its
ten-second ceiling allows OS reaping and never asserts a performance improvement or regression.

Type inference is checked by the compiler's consumer fixtures. The repository removed the source regex that demanded one
spelling of `Object.freeze`; a correct runtime object plus inferred type should not fail because its declaration was
reformatted. Static import boundaries use module graph value edges, and host neutrality probes run real imports with
forbidden host APIs unavailable. Comments and type-only references cannot trigger those checks.

`deno task docs:check` examines every focused public export through Deno's documentation renderer. It fails on missing
workspace declaration comments, independent of their wording. External dependency comments and renderer type-reference
or explicit-type diagnostics are reported separately; they do not justify modifying dependency declarations or replacing
runtime-derived types. Compiler correctness remains the type gate's responsibility, and human review still owns whether
an explanation teaches the right behavior.

`deno task bench:check` runs the untimed benchmark oracles in the verification gate. It reports corrupt fixture results
or violated ownership without imposing an elapsed-time threshold. `deno task bench` measures performance separately.

## Qualification and evidence

Read the [scenario catalogue](scenarios.md) to see which actual consumer problem a generic test reconstructs and which
external behavior it leaves unproved. The [test review](test-review.md) explains every retained, strengthened,
consolidated, and compiler-only suite. [qualification.json](qualification.json) owns the complete manifested package and
test inventory, concrete behavioral invariants, source-runtime selections, packed-artifact applicability, and benchmark
questions. [bench/coverage.json](../bench/coverage.json) owns the corresponding executable performance programs and
comparison limits.

Run the structural qualification and fragile-pattern gates with the same task entrypoints used by verification:

```sh
mise run qualification-check
mise run audit-fragile
```

The first command verifies inventory ownership and existing references. It does not execute the selected tests or
benchmarks. A runtime, native transport, emitted package, or performance result needs a receipt from that actual gate.
Keep the source hash, exact command/runtime, artifact hash where applicable, and observed result with the receipt. A
packed export that imports successfully has passed an import contract; this alone does not qualify its behavioral suite.
Clean emitted consumers run separately through `mise run npm-verify`.

The matrix must choose either an emitted behavioral suite or an explicit import-only limit for each portable package. An
omitted classification fails the gate; imports alone must not become a behavioral claim. The same gate checks
`sourceNode` records against the import-safe selection exported by `tools/check-node.ts`, so adding a native suite or
removing one requires an accurate runtime record.

Bounded mapper tests use independent failure values and exact identity assertions rather than matching error messages.
They gate an admitted sibling, make another mapper fail, and require sibling settlement with no further admission before
the terminal rejection. The canonical suite runs on Deno source, Node source, and physically installed ESM and CommonJS
archives. `undefined` needs this distinction: native abort changes its signal reason, while the mapper's rejected value
must remain `undefined`.

The fragile audit parses TypeScript with Oxc. It detects concrete wall-clock waits/current-time reads, unseeded
generated properties, snapshots, unawaited terminal expectations, empty catch/discarded rejection callbacks, and
diagnostic-regex throw expectations. It ignores comments and fixture strings. Its independent positive and fault
controls keep this policy testable. It is a known-pattern guard, not a proof that every possible alias or semantically
fragile assertion has been found. Human review still determines whether an oracle is independent and an observation is a
public contract.

[fragile-exceptions.json](fragile-exceptions.json) records each reviewed exception by file, enclosing function,
operation, rule, and exact occurrence count. An added occurrence, missing occurrence, or duplicate exemption fails the
audit. Native grandchild reaping and a cleared stuck-Worker watchdog retain their explicit diagnostic purposes. Early
rejection observers qualify only when the original promise remains awaited for its terminal result.

Generated properties use a fixed seed and report a counterexample when they fail. CSV parsing has an independent quoted
encoder whose original cells are the expected result, including comma/quote/newline/Unicode data and arbitrary byte
splits. Normalization uses idempotence; environment source precedence uses a separate map oracle; workflow retry uses
repeatability and explicit bounds. Stream pressure tests pause a destination write and prove that its producer cannot
exhaust the entire source, without freezing an internal prefetch count. None of these tests imposes a performance
ceiling.

## Qualify the same public outcomes through established implementations

The [Hono parity fixture](http-parity.md) adapts pinned upstream request inputs and keeps their license and source
provenance. Pure Hono and pure Utils implementations each run against literal expected status, selected headers and
consumed bodies. This catches agreement on the same wrong answer. The corpus also covers compiled service validation,
gateway trust reconstruction, HEAD errors and missing routes, exact and excess actual body bytes, and concurrent request
state. Precedence differences have separate expectations; Hono's registration policy is not a Utils requirement.

The [alternative fixtures](alternatives.md) qualify 15 comparable public operations against npm, JSR and native APIs.
They include malformed input, failure identity, bounded admission and stream completion where the operation shares those
contracts. When both implementations use the same parser engine, the comparison qualifies adaptation and projection; it
does not supply an independent grammar oracle. Libraries with different cancellation or durability ownership need their
own contract tests. Each of the 42 package families has a documented comparator or an explicit reason why an existing
workload answers a more useful question.

The clean npm consumer runs the HTTP fixture against physically installed archives in ESM and CommonJS. It also executes
direct disposal constructors in fresh children with native globals, missing constructors and missing protocol symbols.
Ordinary imports must leave those globals unchanged. Strict TypeScript checks retain positive inferred input and output
cases and intentional rejected calls before either runtime suite counts as qualification.
