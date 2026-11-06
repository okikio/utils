# `@okikio/result`

A lookup can find a contact or find nothing. Both outcomes are ordinary, and the caller needs to decide what to show.
`result` puts a value or a reason into a small tagged object so that choice stays visible. A **result** is the answer
wrapper; it does not perform the lookup. Exception capture is explicit.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

| Lookup                  | Returned branch                       | Displayed outcome         |
| ----------------------- | ------------------------------------- | ------------------------- |
| Contact `ada` exists    | `{ ok: true, value: 'Ada Lovelace' }` | `Hello, Ada Lovelace.`    |
| Contact `lin` is absent | `{ ok: false, failure: 'not-found' }` | `Contact lin: not-found.` |

The [public source contracts](./mod.ts) includes branch helpers and fallback contracts.

A Promise and a Result answer different questions. A Promise represents work that finishes later; a Result represents
which answer was produced. An asynchronous lookup can return `Promise<Result<Contact, 'not-found'>>`: first `await` the
lookup, then inspect `ok`. Unexpected exceptions still throw unless you explicitly capture them. Returning a failure
object does not retry the lookup or display an error for the user.

## Look up a contact and show the answer

Start with an ordinary function and a `Map`. Return a result when “not found” is a normal answer, then use an ordinary
`if` statement to choose the display. The package does not require callback chains.

From a checkout of this experimental workspace, run `mise trust`, `mise install`, then `mise run prepare -- --kind deps` at the repository root. Save the following program as `example.ts` and run `mise exec -- deno run example.ts`. These commands use the workspace export maps; they do not assume a published registry version.

```ts runnable
import { fail, ok } from '@okikio/result';
import type { Result } from '@okikio/result';

const contacts = new Map([['ada', 'Ada Lovelace']]);
/** Treat a missing contact as an expected answer, leaving unexpected exceptions as exceptions. */
function findContact(id: string): Result<string, 'not-found'> {
	const name = contacts.get(id);
	return name === undefined ? fail('not-found') : ok(name);
}
for (const id of ['ada', 'lin']) {
	const answer = findContact(id);
	// Checking the tag narrows the type, so each branch reads only its own payload.
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

## Add validation and recognizable failure reasons

- Combine [Schema](../schema/README.md) validation with Result when a form or import should return an ordinary “please
  fix this field” branch. The [complete port-validation example](../../docs/packages/17-result.md) in the Result guide shows accepted and rejected input.
- Put a [Failure](./failure/README.md) occurrence inside the failure branch when its reason needs a stable identity
  across services. Keep unexpected thrown exceptions on an explicit diagnostic path.

## Validate the contact before returning its branch

A lookup can find a record whose fields are still unsuitable for the application. Keep that as an expected failure branch and preserve unexpected exceptions as exceptions. This complete program uses Schema to check the same contact name, then Result to make the caller's decision visible.

Save this as `checked-contact.ts` and run `mise exec -- deno run checked-contact.ts` after the same checkout setup.

```ts runnable=checked-contact.ts
import * as schema from '@okikio/schema';
import * as result from '@okikio/result';
const ContactSchema = schema.object({ name: schema.string({ minLength: 1 }) });
async function checkContact(input: unknown) {
	const checked = await schema.validate(ContactSchema, input);
	return checked.issues === undefined ? result.ok(checked.value) : result.fail('Correct the contact name');
}
for (const input of [{ name: 'Ada' }, { name: '' }]) {
	const checked = await checkContact(input);
	console.log(checked.ok ? checked.value.name : checked.failure);
}
```

```text output
Ada
Correct the contact name
```

The schema's rejected value is expected input feedback. A thrown bug in a custom validator is not automatically converted to that branch. Add a declared Failure only when the reason needs a stable machine identity across a boundary.

## Compose and capture explicitly

`map` transforms successful values, `mapFailure` transforms expected reasons, and `flatMap` composes another
result-producing operation while retaining the union of both failure types. Untouched branches preserve their original
wrapper identity. Callback exceptions remain exceptions.

`capture(() => value)` records a synchronous thrown value as an unknown failure. A returned Promise is still a value in
this synchronous API. `captureAsync(() => valueOrPromise)` always returns a Promise and captures both synchronous throws
and asynchronous rejections. Neither helper classifies an unknown exception as a declared business failure. Callbacks
take no required arguments because capture invokes them with none.

The root stays independent of catalogs and diagnostics. Failure submodules define recognizable expected rejection; Fault
submodules produce bounded diagnostics from unexpected thrown values. Public Result tags stay frozen because branch
discrimination is a shared invariant, while borrowed nested payloads remain mutable under their own contract.

## Choose Result, Failure and Fault

| Import                   | Use it for                                                                               | Composition                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `@okikio/result`         | An ordinary success or expected rejection returned as data.                              | `Result<Value, Reason>` carries either the value or the reason without classifying exceptions.                     |
| `@okikio/result/failure` | An authored, recognizable business rejection with a stable definition and typed details. | Put its occurrence in a Result failure branch; encode/decode it through the declared catalog when transporting it. |
| `@okikio/result/fault`   | A bounded diagnostic projection of an unexpected thrown value.                           | Report it through Telemetry or a chosen error response; keep the original thrown value local when appropriate.     |

For example, an unavailable account can return a Result containing the declared `AccountUnavailable` Failure. A thrown
database exception follows the diagnostic path and becomes a Fault projection for logging. An exception does not become
a declared Failure merely because it was caught. Result's root does not import either richer submodule.

## Keep an expected rejection recognizable across a transfer

The trusted failure definition survives an encode/decode round trip by explicit lookup. No network or persistence is
implied.

Save this complete variation as `focused-example.ts` and run `mise exec -- deno run focused-example.ts` after the same checkout setup.

```ts runnable=focused-example.ts
import * as failure from '@okikio/result/failure';
import * as schema from '@okikio/schema';
const Missing = failure.define({
	id: 'asset.missing',
	description: 'The requested asset does not exist.',
	data: schema.object({ id: schema.string() }),
});
const occurrence = await failure.create(Missing, { data: { id: 'asset-1' } });
const wire = await failure.encode(occurrence);
const restored = await failure.decode(wire, [Missing]);
console.log(restored.definition === Missing, restored.data.id);
```

Expected output:

```text output
true asset-1
```

The same operation is described in the [focused guide](./failure/README.md), including its ownership rules and failure
behavior.

## Keep a rejection meaningful across a boundary

A missing contact is an expected lookup outcome; a broken database connection is an unexpected fault. Preserve that
distinction when work sends results to another process or HTTP caller.

Use Result to branch on an expected outcome, Failure to declare transferable domain failures, and Fault for bounded
exception diagnostics. HTTP Problem maps declared failures to responses.

Do not replace every exception with a generic miss. Diagnostic projection deliberately limits data and does not retain a
live Error instance.

## Choose an entry point

Use the table to find a focused import for the job you need. Contract links open the exact public source, including its
options and types.

| Import                         | Use it to                                                                | Exact contract                 |
| ------------------------------ | ------------------------------------------------------------------------ | ------------------------------ |
| `@okikio/result/failure`       | Declare and encode expected domain failures across host transfers.       | [Contract](./failure/mod.ts)   |
| `@okikio/result/failure/migrate` | Convert a saved failure between explicit historical and current definitions. | [Contract](./failure/migrate.ts) |
| `@okikio/result/failure/types` | Import public types for this capability; this entry does not start work. | [Contract](./failure/types.ts) |
| `@okikio/result/fault`         | Project unexpected exceptions into bounded diagnostic data.              | [Contract](./fault/mod.ts)     |
| `@okikio/result/fault/types`   | Import public types for this capability; this entry does not start work. | [Contract](./fault/types.ts)   |
| `@okikio/result/async` | Await a transformation of the selected success branch; preserve callback rejections. | [Contract](./async.ts) |
| `@okikio/result`               | Use the package entry shown in the complete examples above.              | [Contract](./mod.ts)           |

## Aggregate expected results

`all([ok(1), ok('two')])` preserves tuple inference and returns a frozen array of borrowed payloads. A failure returns
that exact wrapper and stops before consuming later input. `all(iterable, { maximumItems })` requires explicit finite
admission; max+1 throws and closes the source iterator. Iterator defects remain thrown defects.

`partition(results, { maximumItems })` returns frozen `{ values, failures }` arrays in encounter order within each
branch. Failure payload identity is retained. `tap` observes success and `tapFailure` observes expected failure; both
return the original wrapper. A callback defect propagates instead of becoming expected failure data.

## Await a success branch

`@okikio/result/async` maps successful values without hiding callback defects:

Save this complete variation as `example-3.ts` and run `mise exec -- deno run example-3.ts` after the same checkout setup.

```ts runnable
import * as result from '@okikio/result';
import * as asynchronous from '@okikio/result/async';
const value = await asynchronous.map(result.ok(3), async (n) => n * 2);
console.log(result.unwrap(value));
```

```text output
6
```

`flatMap()` accepts a callback returning another result and retains both failure types. A failed input skips either
callback and preserves its exact wrapper. Thrown values and rejected promises remain rejections, including `undefined`.
Use `captureAsync()` explicitly when that conversion is intended. These operations do not start parallel work or create
a cancellation owner. The [source contract](./async.ts) and [benchmark](./result-async.bench.ts) distinguish branch
costs from concurrency.

## Measure aggregation and early failure

The focused benchmarks measure 1–10,000 values; successful, early, middle and late failures. The benchmark compares
against equivalent explicit loop preserving frozen output and failure identity. Position-dependent cost is intentional;
aggregation stops at the first failure.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
deno task --cwd=packages/result test
deno task --cwd=packages/result bench:check
deno task --cwd=packages/result bench
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.

## Read further

The [Result guide](https://github.com/okikio/utils/blob/main/docs/packages/17-result.md) explains the model, manual
alternatives, and composition.
