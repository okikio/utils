# Duplicate Review

`deno task audit:code` finds production TypeScript patterns that need a human
review. It does not decide that two functions should share code or that every
source-policy signal is a defect.

Run the audit before a large refactor, after extracting a package, or when a
new helper appears to repeat lifecycle work from another package:

```sh
deno task audit:code packages
```

The report contains three evidence levels.

| Report field | Meaning | Required review |
| --- | --- | --- |
| `shapes` | Function bodies have the same identifier-insensitive AST shape. | Check whether they have the same contract and owner. |
| `names` | Functions use the same local name. | Check behavior before treating the name as a duplicate. |
| `findings` | Lifecycle markers expose a possible ownership bypass or private clone. | Trace callers, tests, docs, and package exports before changing code. |
| `issues` | AST signals show `any`, empty catches, long names, or relative-import cycles. | Confirm the source contract, then narrow, document, split, or retain it deliberately. |

## Ownership Rules

`context` owns operation identity, cancellation, deadlines, and injected clocks.
A private function that receives `Context`, starts a wall-clock timer, and does
not need host-only timing is a high-confidence `owner-bypass` finding.

The tool also reports identical private lifecycle control flow across focused
packages. That result is only a review candidate. For example,
`workflow.sleep()` records a durable instruction, `resilience.timeout()`
declares policy, and `context.wait()` waits during one live operation. Their
names overlap, but their owners and persistence contracts differ.

When two adapters only repeat cancellation-aware registration for an external
gate, move that lifecycle into `context.waitFor()`. Keep the gate's state and
resume condition in the adapter that owns the protocol or queue.

Do not move process shutdown, Worker shutdown, transport retention, or protocol
gates into `context` only because they use a timer or an `AbortSignal`. Context
can own a generic clock race through `settles()`, while the host still owns its
shutdown policy, termination actions, and timeout errors.

## Source Signals

`any` hides the type boundary that a library consumer needs to understand. Use
`unknown` with validation, or a narrow generic, when the value is truly
untrusted. An undocumented empty catch needs a local explanation and a concrete
reason that discarding the failure is safe. A long function name can hide several actions;
split the work or select a shorter domain verb when that makes the behavior
clearer.

A relative import cycle can expose an export before its module initializes. It
is sometimes safe for type-only contracts, but do not assume that it is safe
for runtime values. Trace the import direction and move shared values to a
lower-level module when both modules need the same initialized value.

## Review Method

For each finding, first trace the public entrypoint, imports, callers, context
or clock ownership, cancellation behavior, cleanup path, tests, and docs. Then
record one decision: merge into the existing owner, extract a new focused
primitive, retain an intentional adapter, or delete dead code.

Test a proposed merge with deterministic time where timing is part of the
contract. Cover an already-aborted signal, cancellation during the wait, an
earlier success, listener cleanup, and the losing timer or promise. Do not use
wall-clock sleeps as proof that a queue, retry, or deadline behaves correctly.
