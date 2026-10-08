# `@okikio/result`

A lookup can find a contact or find nothing. Both outcomes are ordinary, and the caller needs to decide what to show.
`result` puts a value or a reason into a small tagged object so that choice stays visible. A **result** is the answer
wrapper; it does not perform the lookup or catch exceptions for you.

| Lookup                  | Returned branch                       | Displayed outcome         |
| ----------------------- | ------------------------------------- | ------------------------- |
| Contact `ada` exists    | `{ ok: true, value: 'Ada Lovelace' }` | `Hello, Ada Lovelace.`    |
| Contact `lin` is absent | `{ ok: false, failure: 'not-found' }` | `Contact lin: not-found.` |

The [full API reference](API.md) includes branch helpers and fallback contracts.

## Look up a contact and show the answer

Start with an ordinary function and a `Map`. Return a result when “not found” is a normal answer, then use an ordinary
`if` statement to choose the display. The package does not require callback chains.

```ts runnable
import { fail, ok } from '@okikio/result';
import type { Result } from '@okikio/result';

const contacts = new Map([['ada', 'Ada Lovelace']]);
function findContact(id: string): Result<string, 'not-found'> {
	const name = contacts.get(id);
	return name === undefined ? fail('not-found') : ok(name);
}
for (const id of ['ada', 'lin']) {
	const answer = findContact(id);
	if (answer.ok) console.log(`Hello, ${answer.value}.`);
	else console.log(`Contact ${id}: ${answer.failure}.`);
}
```

Expected output:

```text output
Hello, Ada Lovelace.
Contact lin: not-found.
```

TypeScript follows the `answer.ok` check. Inside the first branch, it exposes the contact's `value`; inside the second,
it exposes the exact `'not-found'` reason. Adding another contact changes the data, not the control-flow language.

| Call or value                    | Contract                                                       | What happens                                                                               |
| -------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `Result<Value, Reason>`          | `{ ok: true, value: Value } \| { ok: false, failure: Reason }` | A two-branch data shape; neither branch is a Promise.                                      |
| `ok(value)` / `fail(reason)`     | Payload → frozen branch wrapper                                | Payload identity is preserved; nested payloads are not deep-frozen.                        |
| `match(answer, { ok, failure })` | Result + two callbacks → selected callback's return value      | Calls only one callback. It does not catch callback exceptions or await returned Promises. |
| `unwrap(answer)`                 | Value on success; throws the exact failure on failure          | Choose this when exception control flow is appropriate.                                    |

One level deeper: the constructors call `Object.freeze()` on those small wrappers. Branch helpers check the `ok` field
and read either `value` or `failure`. There is no scheduler, automatic retry or hidden exception conversion.

Keeping failure as data makes a normal absence visible in the function's return type. Unexpected exceptions can still
throw. Use `getOr()` for an explicit fallback or `getOrElse()` when creating that fallback should happen only on
failure.

## Build on the example

- Combine [Schema](../schema/README.md) validation with Result when a form or import should return an ordinary “please
  fix this field” branch. The runnable port example below shows accepted and rejected input.
- Put a [Failure](../failure/README.md) occurrence inside the failure branch when its reason needs a stable identity
  across services. Keep unexpected thrown exceptions on an explicit diagnostic path.

## How it fits

`@okikio/failure` defines expected failure families and runtime occurrences. `@okikio/result` only carries a success
value or a failure value.

This separation keeps `@okikio/result` free of schemas, catalogs, and transport behavior. A result can therefore contain
a failure occurrence, a validation problem, a string, or another exact reason type.

The wrapper is shallowly immutable. `ok()` and `fail()` freeze the discriminated result object, but they borrow the
supplied `value` or `failure`. They do not deep-freeze caller-owned objects, functions, collections, or errors. If a
payload must itself be immutable, its producer owns that contract.

## Transform or provide a fallback

`match()` is convenient when both branches produce one display value. A fallback is a separate application choice: this
example accepts a blank name as a normal failure, then deliberately supplies a guest display name.

```ts runnable=display-fallback.ts
import { fail, getOr, getOrElse, match, ok } from '@okikio/result';
import type { Result } from '@okikio/result';

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

The [generated API reference](API.md) lists every public function and type. These examples teach the common paths and
the design decisions behind those contracts.
