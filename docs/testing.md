# Testing

This guide explains where tests belong and what evidence they must provide.
Package tests protect focused contracts. Root tests prove that several packages
compose correctly through their public imports.

Test placement
--------------

Package-local `*.test.ts` files own unit behavior, lifecycle rules, edge cases,
and protocol conformance for one package.

Root `tests/` owns cross-package scenarios, public-import contracts, and consumer
flows. A test belongs there when a failure could come from the interaction of
several packages rather than one local implementation.

Benchmarks remain separate from correctness tests. A faster result is useful only
after a correctness test proves equivalent behavior.

Optimized implementations
-------------------------

An optimization needs an independent oracle. The prepared HTTP router is compared
with a separate linear matcher over generated route and request cases. The
reference matcher must not call the optimized matcher to compute its expected
result.

Use the same pattern for parsers, normalization, caches, and other optimized code
when a direct reference implementation is practical.

Public type contracts
---------------------

Type inference is part of the package API. Add small consumer fixtures when a
public generic, schema-derived input, overload, or discriminated union has
non-trivial inference.

A useful fixture set includes a program that must type-check and a program that
must fail for the intended reason.

Failure and limit cases
-----------------------

Test the cases that change behavior or ownership. Depending on the capability,
this can include:

 -  empty or malformed input
 -  the exact minimum and maximum values
 -  one value outside each supported limit
 -  cancellation before and during work
 -  partial reads or writes
 -  cleanup after failure
 -  concurrent operations
 -  stale completion
 -  retry exhaustion
 -  unsupported runtime capabilities

Do not add every case to every package. Add the cases that protect the package's
actual contract.

Run verification
----------------

Use the repository verification task before publication:

~~~~ sh
mise run verify
~~~~

The equivalent Deno task is:

~~~~ sh
deno task verify
~~~~

A blocked native check remains blocked. A host-side smoke test can provide useful
evidence, but it does not convert an unavailable Deno, browser, provider, or
package-artifact check into a pass.
