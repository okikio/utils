# Issue #1 qualification follow-up

This follow-up checks [issue #1](https://github.com/okikio/utils/issues/1) against the committed library, rather than
repeating the initial source reconciliation. The [initial qualification receipt](qualification-report.md) and
[comparison receipt](comparison-report.md) retain their original revisions and counts. This receipt covers the remaining
qualification defects and refreshed execution evidence.

## Defects found by reviewing the evidence

| Situation                                           | Previous behavior or proof gap                                                                                     | Qualified behavior                                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A bounded mapper throws `undefined`                 | Native abort normalization changed the terminal failure to a `DOMException`.                                       | Queue, ordered mapping, and unordered mapping retain the original failure value after joining admitted siblings.                                                                               |
| Ordered source cleanup fails                        | A failed iterator return could skip sibling joining and replace the operation failure.                             | Source closure always joins admitted work. A sole failure retains its value; combined operation and cleanup failures become `AggregateError([operation, cleanup], ..., { cause: operation })`. |
| A queued capacity waiter is cancelled               | Matching error text could miss replacement of the original cause; repeated synchronous calls were labelled a race. | Tests assert exact cause identity, retained reservations, removed waiters, and pre-aborted admission without claiming untested interleavings.                                                  |
| A portable package omits its emitted classification | Import/declaration evidence could pass without stating whether behavior was exercised.                             | The checker requires exactly one behavioral selection or explicit import-only limit.                                                                                                           |
| Native Node selection changes                       | Runtime records could omit selected suites or claim unselected ones.                                               | The gate imports the runner's canonical selection and rejects either discrepancy, including unowned composed consumers.                                                                        |

The failure tests use independent values, gated sibling work, explicit source cleanup failures, and externally visible
settlement. A source-return regression also waits for an event-loop checkpoint while the sibling remains blocked. It
tests ownership ordering rather than a duration or performance ceiling. Negative controls run these tests against the
previous production implementation; a test that also passes that implementation is not accepted as proof of the repair.

The canonical bounded suite now imports `@okikio/concurrency/bounded`. The npm gate copies that same suite into a
physical consumer outside the checkout, checks its ESM and CommonJS types, keeps production package imports external
when compiling tests, and runs both formats against the installed archives. This adds behavioral artifact coverage; it
does not turn other packages' explicit import-only limits into behavioral claims.

Strict consumer checking exposed invalid declarations in the proposed assertion-library dependency. The canonical
bounded suite therefore uses Node's built-in assertions, as the existing archive scenarios do. Its cases and expected
values remain the same on every runtime; no dependency declarations are patched and artifact checking keeps
`skipLibCheck: false`.

## Acceptance and evidence

The [matrix](qualification.json) covers all 42 source packages and records behavior, invariants, consumer provenance,
runtime selection, and performance questions. The [scenario catalogue](scenarios.md), [test review](test-review.md),
[fragile-pattern audit](testing.md#qualification-and-evidence), and [benchmark guide](benchmarks.md) retain their
independent owners. CI invokes the same Mise tasks as contributors.

The lockfiles are already tracked: `67f0fc9` committed the real-toolchain Deno and PNPM locks before this follow-up. The
initial receipt's pending-lockfile/delivery statement describes its earlier dirty snapshot. It is not the current
delivery state. The new concurrency release intent lives in [the package bump file](../.bumpy/mapper-failures.md).

Execution counts, commands, input hashes, exact archive hashes, and runtime details are recorded in
[the machine-readable receipt](issue-1-results.json). Full local logs and artifacts are retained under
`.artifacts/issue-1/20261007`. Historical all-family timing measurements remain in the comparison receipts; this
follow-up reruns every benchmark preflight and measures the changed concurrency compositions separately. It adds no
wall-clock regression threshold or new fastest-library claim.

## Executed gates

| Gate                            | Observed result                                                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mise run verify`               | 187 Deno groups with 1,269 steps, one existing ignored group, and 834 native Node tests passed. All 17 benchmark preflights passed.                                                            |
| `mise run npm-verify`           | 41 exact archives and 292 public subpaths passed package, runtime, and strict declaration checks. Seven canonical scenario sources produced 44 passing behavioral tests in each module format. |
| `mise run bench-npm -- --check` | Native npm import benchmark preflight passed.                                                                                                                                                  |
| Relevant measurements           | Lifetime and alternative programs completed in the capped runner; their reports retain runtime details, input hashes, and timing distributions.                                                |
| Isolated Bumpy fixture          | Strict change coverage, version generation, and synchronized npm/JSR versions passed for 42 packages. The test-only capacity change has an explicit `none` intent.                             |

## Limits of the qualification

Deno source remains canonical. The portable npm projection excludes the Deno-only package and adapters; every included
entry is checked through installed Node ESM and CommonJS artifacts. These checks do not qualify every source suite on
every runtime. Packages with import-only artifact coverage keep that explicit limit.

Workflow recovery evidence uses the bundled in-memory stores and replacement owners. It does not establish persistent
process-loss recovery, a deployed database adapter, cross-computer transport, or Kubernetes placement. Existing renderer
type diagnostics and dependency comment diagnostics remain separately reported by the documentation gate.

This work performs local qualification and Git delivery. Hosted GitHub Actions, registry publication, and closing the
remote issue are separate actions and are not represented as completed by these receipts.
