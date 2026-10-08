# @okikio/result contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import           | Source               | Reference     |
| ---------------- | -------------------- | ------------- |
| `@okikio/result` | [./mod.ts](./mod.ts) | [root](#root) |

## root

Import `@okikio/result`. [Source](./mod.ts).

Represent an expected success or failure as data and force call sites to choose a branch. Throwing for every missing
value makes ordinary control flow indistinguishable from an unexpected provider fault.

Use match() at a consumer that must handle both paths, or getOr()/getOrElse() for an intentional fallback. unwrap()
turns a failure back into a thrown value when exception flow is appropriate. Result does not define a durable failure
identity, retry policy or HTTP status; compose it with those packages when needed.

### root: fail

[Declaration source](mod.ts#L41)

```text
function fail<Reason>(failure: Reason): Failure<Reason>
  Create a frozen failed-result wrapper around a borrowed failure value.
```

### root: getOr

[Declaration source](mod.ts#L73)

```text
function getOr<Value, Reason>(value: Result<Value, Reason>, fallback: NoInfer<Value>): Value
  Return the success value or a caller-provided fallback value.
```

### root: getOrElse

[Declaration source](mod.ts#L78)

```text
function getOrElse<Value, Reason>(value: Result<Value, Reason>, fallback: () => NoInfer<Value>): Value
  Return the success value or lazily create a fallback value.
```

### root: isFailure

[Declaration source](mod.ts#L51)

```text
function isFailure<Value, Reason>(value: Result<Value, Reason>): value is Failure<Reason>
  Return whether a result is failed.
```

### root: isOk

[Declaration source](mod.ts#L46)

```text
function isOk<Value, Reason>(value: Result<Value, Reason>): value is Success<Value>
  Return whether a result is successful.
```

### root: match

[Declaration source](mod.ts#L56)

```text
function match<Value, Reason, SuccessResult, FailureResult>(value: Result<Value, Reason>, cases: Readonly<{ readonly ok: (value: Value) => SuccessResult; readonly failure: (failure: Reason) => FailureResult; }>): SuccessResult | FailureResult
  Transform either result variant without losing explicit control flow.
```

### root: ok

[Declaration source](mod.ts#L36)

```text
function ok<Value>(value: Value): Success<Value>
  Create a frozen successful-result wrapper around a borrowed value.
```

### root: unwrap

[Declaration source](mod.ts#L67)

```text
function unwrap<Value, Reason>(value: Result<Value, Reason>): Value
  Return the success value or throw the supplied failure.
```

### root: Failure

[Declaration source](mod.ts#L25)

```text
interface Failure<Reason>
  Failed result variant.

  readonly ok: false
    Whether this result reached its successful protocol branch.
  readonly failure: Reason
    Expected failure data retained under its declared contract.
```

### root: Success

[Declaration source](mod.ts#L17)

```text
interface Success<Value>
  Successful result variant.

  readonly ok: true
    Whether this result reached its successful protocol branch.
  readonly value: Value
    Value carried by this contract; its schema and owner define the accepted shape.
```

### root: Result

[Declaration source](mod.ts#L33)

```text
type Result<Value, Reason> = Success<Value> | Failure<Reason>
  Explicit success-or-failure result.
```
