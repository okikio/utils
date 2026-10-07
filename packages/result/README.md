# `@okikio/result`

Represent an expected success or failure as data and force call sites to choose a branch. Throwing for every missing
value makes ordinary control flow indistinguishable from an unexpected provider fault.

## Run a complete example

```ts runnable
import * as result from '@okikio/result';
const found = result.ok('asset-1');
const missing = result.fail('missing');
console.log(result.match(found, { ok: (id) => `loaded ${id}`, failure: (reason) => `failed ${reason}` }));
console.log(result.getOr(missing as result.Result<string, string>, 'default'));
```

Expected output:

```text output
loaded asset-1
default
```

`ok()` and `fail()` return frozen discriminated wrappers immediately. `match()` returns the selected callback value,
here a string; `getOr()` returns the chosen value, here `default`. Payloads are borrowed and shallowly wrapped. These
calls perform no async work, catch no exception and create no cleanup owner.

## Build on the example

Use match() at a consumer that must handle both paths, or getOr()/getOrElse() for an intentional fallback. unwrap()
turns a failure back into a thrown value when exception flow is appropriate. Result does not define a durable failure
identity, retry policy or HTTP status; compose it with those packages when needed.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Purpose

`@okikio/result` provides a small frozen success-or-failure wrapper for expected caller branching.

Use it when failure is a normal branch that the caller should inspect. Do not use it to define failure identity,
validation, serialization, HTTP status, or retry policy.

## How it fits

`@okikio/failure` defines expected failure families and runtime occurrences. `@okikio/result` only carries a success
value or a failure value.

This separation keeps `@okikio/result` free of schemas, catalogs, and transport behavior. A result can therefore contain
a failure occurrence, a validation problem, a string, or another exact reason type.

The wrapper is shallowly immutable. `ok()` and `fail()` freeze the discriminated result object, but they borrow the
supplied `value` or `failure`. They do not deep-freeze caller-owned objects, functions, collections, or errors. If a
payload must itself be immutable, its producer owns that contract.

## Start here

```typescript
import * as result from '@okikio/result';

const value = result.fail(validationFailure);

if (result.isFailure(value)) {
	return value.failure;
}
```

## Transform or provide a fallback

```ts
const message = result.match(value, {
	ok: (item) => `loaded ${item}`,
	failure: (reason) => `unavailable: ${reason}`,
});

const item = result.getOr(value, 'default');
const lazyItem = result.getOrElse(value, () => loadDefault());
```

`getOr()` accepts a fallback value. `getOrElse()` accepts a lazy fallback factory. Keeping those operations separate
matters when the result value itself is a function:

```ts
const handler = result.getOr(failedHandler, fallbackHandler); // returns the function
const lazy = result.getOrElse(failedHandler, () => fallbackHandler); // runs only the outer factory
```

The manual equivalent is simply `value.ok ? value.value : fallback`, or the same branch with `fallback()` when lazy
creation is useful. The utility does not guess whether a function is data or a callback.

`unwrap()` is intentionally the sharp operation: it returns the success value or throws the stored failure. Use it only
when the surrounding control flow already treats failure as exceptional.

## Keep expected validation failure in a branch

Import adapters validate input before admitting provider work. A schema owns valid values; Result lets the caller choose
an explicit rejection branch without turning every invalid value into an unexpected fault.

```ts runnable=validated-port.ts
import * as result from '@okikio/result';
import * as schema from '@okikio/schema';
import { z } from 'zod';

const PortSchema = z.coerce.number().int().min(1).max(65535);
async function parsePort(input: unknown): Promise<result.Result<number, 'invalid-port'>> {
	const checked = await schema.validate(PortSchema, input);
	return checked.issues === undefined ? result.ok(checked.value) : result.fail('invalid-port');
}
for (const input of ['8787', 'outside-range']) {
	console.log(result.match(await parsePort(input), {
		ok: (port) => `listen:${port}`,
		failure: (reason) => `reject:${reason}`,
	}));
}
```

Expected output:

```text output
listen:8787
reject:invalid-port
```

`parsePort()` returns `Promise<Result<number, 'invalid-port'>>`; `match()` returns the selected string immediately. Only
the schema's reported issues become an expected rejection. An unexpected exception thrown by a validator still rejects
the Promise. These utilities own no connection, cancellation signal or cleanup stack. A host can create its listener
after the success branch and own that listener separately.

## Progressive usage

Read [complete compositions](../../docs/composition.md) for a bounded CSV import, allowed-page discovery and a
resource-backed operation. Each example names its result and owner. Use [the outcome guide](../../docs/outcomes.md) to
choose additional mechanisms when the application needs them.

## Convenience and the manual equivalent

| Convenience               | Manual equivalent                                                          | Concrete value                                                     |
| ------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `result.ok()` / `fail()`  | construct and freeze a discriminated success/failure tuple/object yourself | one tiny explicit non-throwing result vocabulary                   |
| `match()` / `unwrap()`    | switch on the discriminant and repeat narrowing/throwing behavior manually | typed branch handling without casts                                |
| `getOr()` / `getOrElse()` | branch explicitly between a value fallback and a lazy fallback factory     | function-valued results are never confused with fallback factories |

`@okikio/result` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics with a discriminated
union such as { ok: true, value } | { ok: false, failure }.

The utility supplies the tiny constructors, guards, matching, unwrap, and fallback operations without adding schema or
transport semantics.

## Runtime guard

`isOk()` and `isFailure()` are lightweight discriminant guards for a typed `Result<Value, Reason>`. They make
branch-local narrowing convenient; they are not validators for arbitrary unknown input. If an untyped transport or
callback can produce unknown values, validate that outer contract before treating the value as a `Result`.

## Source guide

Start with this README, then use the source in this order when you need more detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*.test.ts` files show edge cases, cancellation, invalid input, and lifecycle behavior as executable examples.
4. Read internal implementation files only when you need the exact state transition or performance-sensitive loop.

The README is the primary user documentation. It intentionally stays close to the public source instead of maintaining a
separate hand-written API reference.
