# Result

A missing contact can be an ordinary answer instead of an exception. Result makes that answer an object with two
branches: `ok: true` carries a value; `ok: false` carries a reason. The caller checks the branch and decides what to show.
The [package example](../../packages/result/README.md) begins with a plain `if`; the examples below show transformations
and deliberately chosen fallbacks.

## Keep expected failure in the returned value

`@okikio/result/failure` defines expected failure families and runtime occurrences. `@okikio/result` only carries a
success value or a failure value.

This separation keeps `@okikio/result` free of schemas, catalogs, and transport behavior. A result can therefore contain
a failure occurrence, a validation problem, a string, or another exact reason type.

`ok()` and `fail()` freeze the outer result object. If you pass in a contact object, the result still holds the same
contact object, and its fields can still change. Copy or freeze that value separately if the caller needs a snapshot.

## Transform or provide a fallback

`match()` is convenient when both branches produce one display value. A fallback is a separate application choice: this
example accepts a blank name as a normal failure, then deliberately supplies a guest display name.

After the [checkout setup](../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`display-fallback.ts` at that root, then run `mise exec -- deno run display-fallback.ts`.

```ts runnable=display-fallback.ts
import { fail, getOr, getOrElse, match, ok } from '@okikio/result';
import type { Result } from '@okikio/result';

/** Return an expected validation failure as data so the caller can choose its own message or fallback. */
function readName(text: string): Result<string, 'blank-name'> {
	const name = text.trim();
	return name.length === 0 ? fail('blank-name') : ok(name);
}
const answer = readName(' ');
console.log(match(answer, { ok: (name) => `Hello, ${name}.`, failure: () => 'Please enter your name.' }));
console.log(getOr(answer, 'Guest'));
console.log(getOrElse(answer, () => 'Visitor'));
```

```text output
Please enter your name.
Guest
Visitor
```

`getOr()` accepts the fallback value itself. `getOrElse()` calls a fallback factory only for a failure. Keeping them
separate also matters when the result contains a function: `getOr()` returns that function without calling it.

The manual equivalent is simply `value.ok ? value.value : fallback`, or the same branch with `fallback()` when lazy
creation is useful. The utility does not guess whether a function is data or a callback.

`unwrap()` returns the success value or throws the stored failure. Use it where the caller already expects an exception.
If a missing value is a normal outcome, keep the result and choose how to display it.

## Keep expected validation failure in a branch

A server can check its configured port before opening a listener. Save the example as `validated-port.ts` and run
`mise exec -- deno run validated-port.ts`. The program prints what it would do for each setting; it opens no port.

```ts runnable=validated-port.ts
import * as result from '@okikio/result';
import * as schema from '@okikio/schema';

const PortSchema = schema.coerce.number({ integer: true, minimum: 1, maximum: 65535 });
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

## Compose successful values and explicit fallbacks

Read [complete compositions](../03-composition.md) for a bounded CSV import, allowed-page discovery and a
resource-backed operation. Each example names its result and owner. Use [the outcome guide](../07-outcomes.md) to choose
additional mechanisms when the application needs them.

## Convenience and the manual equivalent

| Convenience               | Manual equivalent                                                          | Concrete value                                                     |
| ------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `result.ok()` / `fail()`  | construct and freeze a discriminated success/failure tuple/object yourself | one tiny explicit non-throwing result vocabulary                   |
| `match()` / `unwrap()`    | switch on the discriminant and repeat narrowing/throwing behavior manually | typed branch handling without casts                                |
| `getOr()` / `getOrElse()` | branch explicitly between a value fallback and a lazy fallback factory     | function-valued results are never confused with fallback factories |

You can define the two cases yourself: `{ ok: true, value }` for success and `{ ok: false, failure }` for an
expected failure. Branch on `ok` to tell TypeScript which field is present.

The utility supplies the tiny constructors, guards, matching, unwrap, and fallback operations without adding schema or
transport semantics.

## Runtime guard

Use `isOk()` and `isFailure()` when you already have a typed `Result<Value, Reason>`. Inside each branch,
TypeScript knows which field you can read. For data from an untyped callback or another service, check the
shape and contents before treating it as a Result.

## Source guide

The paths below are relative to the [package directory](../../packages/result).

Start with the package README linked above, then use the source in this order when you need more detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*.test.ts` files show edge cases, cancellation, invalid input, and lifecycle behavior as executable examples.
4. Read internal implementation files only when you need the exact state transition or performance-sensitive loop.

The [public source](../../packages/result/mod.ts) lists every public function and type. These examples teach the common
paths and the design decisions behind those contracts.
