`@okikio/result`
===============

Purpose
-------

`@okikio/result` provides a small frozen success-or-failure wrapper for expected
caller branching.

Use it when failure is a normal branch that the caller should inspect.  Do not
use it to define failure identity, validation, serialization, HTTP status, or
retry policy.


How it fits
-----------

`@okikio/failure` defines expected failure families and runtime occurrences.
`@okikio/result` only carries a success value or a failure value.

This separation keeps `@okikio/result` free of schemas, catalogs, and transport
concerns.  A result can therefore contain a failure occurrence, a validation
problem, a string, or another exact reason type.

The wrapper is shallowly immutable. `ok()` and `fail()` freeze the discriminated
result object, but they borrow the supplied `value` or `failure`. They do not
deep-freeze caller-owned objects, functions, collections, or errors. If a payload
must itself be immutable, its producer owns that contract.


Start here
----------

~~~~ typescript
import * as result from '@okikio/result';

const value = result.fail(validationFailure);

if (result.isFailure(value)) {
  return value.failure;
}
~~~~

Transform or provide a fallback
-------------------------------

```ts
const message = result.match(value, {
  ok: (item) => `loaded ${item}`,
  failure: (reason) => `unavailable: ${reason}`,
});

const item = result.getOr(value, 'default');
const lazyItem = result.getOrElse(value, () => loadDefault());
```

`getOr()` accepts a fallback value. `getOrElse()` accepts a lazy fallback factory.
Keeping those operations separate matters when the result value itself is a function:

```ts
const handler = result.getOr(failedHandler, fallbackHandler);       // returns the function
const lazy = result.getOrElse(failedHandler, () => fallbackHandler); // runs only the outer factory
```

The manual equivalent is simply `value.ok ? value.value : fallback`, or the same
branch with `fallback()` when lazy creation is useful. The utility does not guess
whether a function is data or a callback.

`unwrap()` is intentionally the sharp operation: it returns the success value or
throws the stored failure. Use it only when the surrounding control flow already
treats failure as exceptional.


Larger composition
------------------

A parser can keep expected invalid input in the value channel while unexpected
programming or I/O faults still throw normally:

```ts
type ParseFailure = Readonly<{ kind: 'invalid-json'; message: string }>;

function parseRecord(text: string): result.Result<unknown, ParseFailure> {
  try {
    return result.ok(JSON.parse(text));
  } catch (error) {
    return result.fail({
      kind: 'invalid-json',
      message: error instanceof Error ? error.message : 'Invalid JSON.',
    });
  }
}

const parsed = parseRecord(input);
const message = result.match(parsed, {
  ok: () => 'accepted',
  failure: (reason) => reason.message,
});
```

The utility does not catch exceptions for you. Choosing `Result` is the caller's
explicit decision that a failure belongs in normal control flow.


Progressive usage
-----------------

The package participates in the complete domain-enrichment example in
`../../docs/composition.md`.  Read that guide when the
individual helpers make sense in isolation but their place in a service,
resource graph, runtime host, or workflow is not yet clear.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `result.ok()` / `fail()` | construct and freeze a discriminated success/failure tuple/object yourself | one tiny explicit non-throwing result vocabulary |
| `match()` / `unwrap()` | switch on the discriminant and repeat narrowing/throwing behavior manually | typed branch handling without casts |
| `getOr()` / `getOrElse()` | branch explicitly between a value fallback and a lazy fallback factory | function-valued results are never confused with fallback factories |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/result` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with a discriminated union such as { ok: true, value } | { ok: false, failure }.

The utility supplies the tiny constructors, guards, matching, unwrap, and fallback operations without adding schema or transport semantics.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Runtime guard
-------------

`isOk()` and `isFailure()` are lightweight discriminant guards for a typed
`Result<Value, Reason>`. They make branch-local narrowing convenient; they are not
validators for arbitrary unknown input. If an untyped transport or callback can
produce unknown values, validate that outer contract before treating the value as
a `Result`.


Source guide
------------

Start with this README, then use the source in this order when you need more
detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*_test.ts` files show edge cases, cancellation, invalid input, and lifecycle
   behavior as executable examples.
4. Read internal implementation files only when you need the exact state
   transition or performance-sensitive loop.

The README is the primary user documentation. It intentionally stays close to
the public source instead of maintaining a separate hand-written API reference.
