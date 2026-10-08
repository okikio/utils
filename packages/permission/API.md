# @okikio/permission contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                          | Source                             | Reference                 |
| ------------------------------- | ---------------------------------- | ------------------------- |
| `@okikio/permission`            | [./mod.ts](./mod.ts)               | [root](#root)             |
| `@okikio/permission/definition` | [./definition.ts](./definition.ts) | [definition](#definition) |
| `@okikio/permission/types`      | [./types.ts](./types.ts)           | [types](#types)           |

## root

Import `@okikio/permission`. [Source](./mod.ts).

Check exact capabilities and schema-validated targets through an explicit evaluator. A boolean on a context cannot
express actor-specific checks or distinguish two independently authored same-name permissions.

Start with one target, combine all()/any() expressions, then provide a provider-backed checker at the application root.
Declare reachable permissions for inspection but explicitly check the current target on each active path. Unknown or
undeclared definitions fail closed. This example evaluator implements a tiny public-asset rule; it does not authenticate
the caller or authorize every possible asset.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding            | Contract owner or source               |
| --------------------------- | -------------------------------------- |
| `catalogCore`               | [catalog contracts](../catalog/API.md) |
| `contextCore`               | [context contracts](../context/API.md) |
| `schema`                    | [schema contracts](../schema/API.md)   |
| `PermissionAll`             | [Source](types.ts)                     |
| `PermissionAny`             | [Source](types.ts)                     |
| `PermissionCheck`           | [Source](types.ts)                     |
| `PermissionChecker`         | [Source](types.ts)                     |
| `PermissionContext`         | [Source](types.ts)                     |
| `PermissionDecision`        | [Source](types.ts)                     |
| `PermissionDefinition`      | [Source](types.ts)                     |
| `PermissionExpression`      | [Source](types.ts)                     |
| `PermissionExpressionInput` | [Source](types.ts)                     |
| `PermissionRequest`         | [Source](types.ts)                     |
| `PermissionRequirement`     | [Source](types.ts)                     |
| `PermissionRuntime`         | [Source](types.ts)                     |
| `PermissionScopeOptions`    | [Source](types.ts)                     |
| `PermissionTargetArguments` | [Source](types.ts)                     |

### root: all

[Declaration source](mod.ts#L213)

```text
function all(...checks: readonly PermissionExpressionInput[]): PermissionAll
  Require every nested runtime permission expression to be allowed.
```

### root: any

[Declaration source](mod.ts#L219)

```text
function any(...checks: readonly PermissionExpressionInput[]): PermissionAny
  Require at least one nested runtime permission expression to be allowed.
```

### root: assert

[Declaration source](mod.ts#L267)

```text
function assert(ctx: import("@okikio/context").Context, expression: PermissionExpression): Promise<void>
  Assert one permission expression, throwing `PermissionDeniedError` only for explicit denial.
```

[Declaration source](mod.ts#L269)

```text
function assert<Permission extends PermissionDefinition>(ctx: import("@okikio/context").Context, definition: Permission, ...target: PermissionTargetArguments<Permission>): Promise<void>
  Assert one permission definition with its schema-inferred optional target.

  Execute the assertion overload and convert only a conclusive denial into `PermissionDeniedError`.
```

### root: batch

[Declaration source](mod.ts#L294)

```text
async function batch(ctx: import("@okikio/context").Context, input: readonly PermissionExpressionInput[]): Promise<readonly boolean[]>
  Evaluate several expressions as one bounded logical permission batch.

  PermissionAll atomic leaves are validated first and sent to the evaluator in one call.
  The evaluator may translate that logical batch into provider-specific chunks,
  parallel requests, database queries, or local graph evaluation while keeping
  one consistent authorization view.
```

### root: check

[Declaration source](mod.ts#L248)

```text
function check(ctx: import("@okikio/context").Context, expression: PermissionExpression): Promise<boolean>
  Check one permission expression and return `false` only for an explicit policy denial.
```

[Declaration source](mod.ts#L250)

```text
function check<Permission extends PermissionDefinition>(ctx: import("@okikio/context").Context, definition: Permission, ...target: PermissionTargetArguments<Permission>): Promise<boolean>
  Check one permission definition with its schema-inferred optional target.

  Execute the normalized overload after preserving provider faults and cancellation as errors.
```

### root: interpreter

[Declaration source](mod.ts#L132)

```text
function interpreter(checker?: PermissionChecker): import("@okikio/requirement").RequirementInterpreter<PermissionRequirement>
  Adapt one permission checker to the generic active-requirement runtime.

  Targetless permission requirements are admission checks. Target-bearing
  permissions only declare that later runtime checks are possible because no
  concrete target exists at definition admission time.
```

### root: on

[Declaration source](mod.ts#L188)

```text
function on<Permission extends PermissionDefinition>(definition: Permission, ...target: PermissionTargetArguments<Permission>): PermissionCheck<Permission>
  Create an immutable runtime check for one permission and optional target.

  This function performs no I/O. Target validation occurs when `check()`,
  `assert()`, or `batch()` evaluates the expression because Standard Schema
  validation can be asynchronous.
```

### root: scope

[Declaration source](mod.ts#L232)

```text
function scope<Base extends import("@okikio/context").Context>(ctx: Base, options: PermissionScopeOptions): PermissionContext<Base>
  Create an unowned permission-aware view of an existing execution context.

  The returned scope borrows the parent context, evaluator, and declarations.
  It does not create cancellation state or own cleanup. A different scope can
  therefore use the same base context with a different actor-specific evaluator
  without caching another actor's authority in shared resources.
```

### root: MissingPermissionCheckerError

[Declaration source](mod.ts#L62)

```text
class MissingPermissionCheckerError extends Error
  Error raised when runtime code attempts a permission check without an evaluator.

  constructor()
```

### root: PermissionCheckLimitError

[Declaration source](mod.ts#L70)

```text
class PermissionCheckLimitError extends RangeError
  Error raised when a logical permission batch exceeds the evaluator's explicit limit.

  constructor(count: number, maximum: number)
    Create this PermissionCheckLimitError from the explicit contract values supplied by its caller.
  readonly count: number
    Number of observations or owned items represented by this snapshot.
  readonly maximum: number
    Upper bound enforced by this owner; provider work remains subject to that capacity.
```

### root: PermissionDecisionError

[Declaration source](mod.ts#L86)

```text
class PermissionDecisionError extends Error
  Error raised when a permission evaluator violates the ordered batch result contract.

  constructor(message: string)
    Create this PermissionDecisionError from the explicit contract values supplied by its caller.
```

### root: PermissionDeniedError

[Declaration source](mod.ts#L108)

```text
class PermissionDeniedError extends Error
  Error raised by `assert()` only when the evaluator explicitly denies the permission expression.

  constructor(denied: readonly PermissionDefinition[])
    Create this PermissionDeniedError from the explicit contract values supplied by its caller.
  readonly denied: readonly PermissionDefinition[]
    Exact permission definitions explicitly denied by the evaluator.
```

### root: PermissionEvaluationError

[Declaration source](mod.ts#L95)

```text
class PermissionEvaluationError extends Error
  Error raised when one atomic permission decision could not be evaluated.

  constructor(definition: PermissionDefinition, cause: unknown)
    Create this PermissionEvaluationError from the explicit contract values supplied by its caller.
  readonly definition: PermissionDefinition
    Exact declared contract object; an independently authored same-name object is not the same declaration.
```

### root: UndeclaredPermissionError

[Declaration source](mod.ts#L49)

```text
class UndeclaredPermissionError extends Error
  Error raised when runtime code checks a permission that was not declared by the execution scope.

  constructor(definition: PermissionDefinition)
    Create this UndeclaredPermissionError from the explicit contract values supplied by its caller.
  readonly definition: PermissionDefinition
    Exact declared contract object; an independently authored same-name object is not the same declaration.
```

### root: PermissionAll

[Declaration source](mod.ts#L571)

```text
reference PermissionAll: ./packages/permission/types.ts:80:1
```

### root: PermissionAny

[Declaration source](mod.ts#L572)

```text
reference PermissionAny: ./packages/permission/types.ts:88:1
```

### root: PermissionCatalog

[Declaration source](mod.ts#L573)

```text
reference PermissionCatalog: ./packages/permission/types.ts:154:1
```

### root: PermissionCheck

[Declaration source](mod.ts#L574)

```text
reference PermissionCheck: ./packages/permission/types.ts:70:1
```

### root: PermissionChecker

[Declaration source](mod.ts#L575)

```text
reference PermissionChecker: ./packages/permission/types.ts:125:1
```

### root: PermissionContext

[Declaration source](mod.ts#L576)

```text
reference PermissionContext: ./packages/permission/types.ts:141:1
```

### root: PermissionDecision

[Declaration source](mod.ts#L577)

```text
reference PermissionDecision: ./packages/permission/types.ts:113:1
```

### root: PermissionDefinition

[Declaration source](mod.ts#L578)

```text
reference PermissionDefinition: ./packages/permission/types.ts:33:1
```

### root: PermissionDefinitions

[Declaration source](mod.ts#L579)

```text
reference PermissionDefinitions: ./packages/permission/types.ts:166:1
```

### root: PermissionExpression

[Declaration source](mod.ts#L580)

```text
reference PermissionExpression: ./packages/permission/types.ts:96:1
```

### root: PermissionExpressionInput

[Declaration source](mod.ts#L581)

```text
reference PermissionExpressionInput: ./packages/permission/types.ts:102:1
```

### root: PermissionOptions

[Declaration source](mod.ts#L582)

```text
reference PermissionOptions: ./packages/permission/types.ts:14:1
```

### root: PermissionRequest

[Declaration source](mod.ts#L583)

```text
reference PermissionRequest: ./packages/permission/types.ts:105:1
```

### root: PermissionRequirement

[Declaration source](mod.ts#L584)

```text
reference PermissionRequirement: ./packages/permission/types.ts:67:1
```

### root: PermissionRuntime

[Declaration source](mod.ts#L585)

```text
reference PermissionRuntime: ./packages/permission/types.ts:133:1
```

### root: PermissionScopeOptions

[Declaration source](mod.ts#L586)

```text
reference PermissionScopeOptions: ./packages/permission/types.ts:146:1
```

### root: PermissionSelection

[Declaration source](mod.ts#L587)

```text
reference PermissionSelection: ./packages/permission/types.ts:160:1
```

### root: PermissionTarget

[Declaration source](mod.ts#L588)

```text
reference PermissionTarget: ./packages/permission/types.ts:54:1
```

### root: PermissionTargetArguments

[Declaration source](mod.ts#L589)

```text
reference PermissionTargetArguments: ./packages/permission/types.ts:60:1
```

### root: PermissionTargetInput

[Declaration source](mod.ts#L590)

```text
reference PermissionTargetInput: ./packages/permission/types.ts:48:1
```

### root: catalog

[Declaration source](mod.ts#L29)

```text
reference catalog: ./packages/permission/definition.ts:37:1
```

### root: compose

[Declaration source](mod.ts#L29)

```text
reference compose: ./packages/permission/definition.ts:59:1
```

### root: define

[Declaration source](mod.ts#L29)

```text
reference define: ./packages/permission/definition.ts:22:1
```

### root: require

[Declaration source](mod.ts#L29)

```text
reference require: ./packages/permission/definition.ts:66:1
```

### root: select

[Declaration source](mod.ts#L29)

```text
reference select: ./packages/permission/definition.ts:48:1
```

## definition

Import `@okikio/permission/definition`. [Source](./definition.ts).

Declare permissions for browser and service contracts without importing execution contexts.

A declaration names an action and optionally validates its target. It never authenticates an actor or contacts a
provider. The main facade re-exports these same functions and owns explicit runtime evaluation through scope().

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding         | Contract owner or source                       |
| ------------------------ | ---------------------------------------------- |
| `catalogCore`            | [catalog contracts](../catalog/API.md)         |
| `CatalogDefinitionInput` | [catalog contracts](../catalog/API.md)         |
| `requirement`            | [requirement contracts](../requirement/API.md) |
| `schema`                 | [schema contracts](../schema/API.md)           |
| `PermissionCatalog`      | [Source](types.ts)                             |
| `PermissionDefinition`   | [Source](types.ts)                             |
| `PermissionOptions`      | [Source](types.ts)                             |
| `PermissionRequirement`  | [Source](types.ts)                             |
| `PermissionSelection`    | [Source](types.ts)                             |

### definition: catalog

[Declaration source](definition.ts#L37)

```text
function catalog<Namespace extends string, Entries extends Readonly<Record<PropertyKey, PermissionDefinition>>>(namespace: Namespace, entries: Entries): PermissionCatalog<Entries>
  Create a named immutable permission catalog.
```

### definition: compose

[Declaration source](definition.ts#L59)

```text
function compose<Entry extends PermissionDefinition>(...input: readonly CatalogDefinitionInput<Entry>[]): readonly Entry[]
  Compose permission definitions, catalogs, selections, and nested arrays.
```

### definition: define

[Declaration source](definition.ts#L22)

```text
function define<Id extends string, TargetSchema extends import("./types.ts").PermissionSchema | undefined = undefined>(input: PermissionOptions<Id, TargetSchema>): PermissionDefinition<Id, TargetSchema>
  Define one immutable permission contract without starting a policy provider.
```

### definition: require

[Declaration source](definition.ts#L66)

```text
function require(definition: PermissionDefinition): PermissionRequirement
  Contribute the `require` requirement for one permission definition.
```

### definition: select

[Declaration source](definition.ts#L48)

```text
function select<Entries extends Readonly<Record<PropertyKey, PermissionDefinition>>, Keys extends readonly (keyof Entries & string)[]>(source: PermissionCatalog<Entries>, keys: Keys): PermissionSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>>
  Select a key-preserving permission catalog subset.
```

## types

Import `@okikio/permission/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding         | Contract owner or source                                      |
| ------------------------ | ------------------------------------------------------------- |
| `StandardSchemaV1`       | External declaration: `@standard-schema/spec/dist/index.d.ts` |
| `Catalog`                | [catalog contracts](../catalog/API.md)                        |
| `CatalogEntryIdentity`   | [catalog contracts](../catalog/API.md)                        |
| `CatalogSelection`       | [catalog contracts](../catalog/API.md)                        |
| `CatalogDefinitionInput` | [catalog contracts](../catalog/API.md)                        |
| `BaseContext`            | [context contracts](../context/API.md)                        |
| `RequirementDefinition`  | [requirement contracts](../requirement/API.md)                |

### types: PermissionAll

[Declaration source](types.ts#L80)

```text
interface PermissionAll
  Runtime expression that requires every child expression to allow.

  readonly kind: "permission-all"
    Stable discriminant for conjunction semantics.
  readonly checks: readonly PermissionExpression[]
    Independent child authorization questions. Evaluation order is not observable.
```

### types: PermissionAny

[Declaration source](types.ts#L88)

```text
interface PermissionAny
  Runtime expression that requires at least one child expression to allow.

  readonly kind: "permission-any"
    Stable discriminant for alternative authorization semantics.
  readonly checks: readonly PermissionExpression[]
    Independent child authorization questions. Any explicit allow can satisfy the expression.
```

### types: PermissionCheck

[Declaration source](types.ts#L70)

```text
interface PermissionCheck<Permission extends PermissionDefinition = PermissionDefinition>
  One atomic runtime permission check before target validation.

  readonly kind: "permission-check"
    Stable discriminant for one atomic authorization question.
  readonly definition: Permission
    Exact permission definition that the current execution declared as reachable.
  readonly target: PermissionTargetInput<Permission>
    Raw target input validated before the policy provider receives the request.
```

### types: PermissionChecker

[Declaration source](types.ts#L125)

```text
interface PermissionChecker
  Provider-neutral evaluator for one logical permission batch.

  `maximumChecks` bounds the number of atomic checks in one logical call. A
  remote adapter can split that logical batch into smaller wire requests while
  preserving one provider revision or consistency view.

  readonly maximumChecks: number
    Maximum atomic requests accepted in one logical evaluation batch.
  check(ctx: BaseContext, requests: readonly PermissionRequest[]): Promise<readonly PermissionDecision[]>
    Evaluate one logical batch without changing application state as a side effect of the decision.
```

### types: PermissionDefinition

[Declaration source](types.ts#L33)

```text
interface PermissionDefinition<Id extends string = string, TargetSchema extends PermissionSchema | undefined = PermissionSchema | undefined> extends CatalogEntryIdentity
  Immutable import-safe permission contract.

  readonly kind: "permission"
    Stable discriminant used by requirement composition and runtime declaration checks.
  readonly id: Id
    Stable policy identity understood by the configured authorization provider.
  readonly description?: string
    Human-readable authority meaning used by documentation and diagnostics.
  readonly target?: TargetSchema
    Optional schema for a concrete target discovered after initial admission.
```

### types: PermissionOptions

[Declaration source](types.ts#L14)

```text
interface PermissionOptions<Id extends string = string, TargetSchema extends PermissionSchema | undefined = undefined>
  Options accepted by `permissions.define()`.

  readonly id: Id
    Stable permission identity used by policy providers and documentation.
  readonly description?: string
    Human-readable purpose of the authority check.
  readonly target?: TargetSchema
    Optional schema for a concrete runtime target.

    Omit the schema when the policy provider can derive the subject from the
    current validated operation state. Add it when work can discover a target
    after admission, such as a URL, asset, project, or external object.
```

### types: PermissionRequest

[Declaration source](types.ts#L105)

```text
interface PermissionRequest<Permission extends PermissionDefinition = PermissionDefinition>
  One validated atomic request sent to the configured policy provider.

  readonly definition: Permission
    Exact permission definition whose policy must be evaluated.
  readonly target: PermissionTarget<Permission>
    Validated target value, or `undefined` for state-derived permissions.
```

### types: PermissionRuntime

[Declaration source](types.ts#L133)

```text
interface PermissionRuntime
  Permission state attached to one local execution context.

  readonly checker?: PermissionChecker
    Provider-neutral evaluator used for runtime authorization decisions in this context.
  readonly permissions: readonly PermissionDefinition[]
    Exact definitions that the active definition graph declared as reachable.
```

### types: PermissionScopeOptions

[Declaration source](types.ts#L146)

```text
interface PermissionScopeOptions
  Options accepted by `permissions.scope()`.

  readonly checker?: PermissionChecker
    Provider-neutral evaluator. Omit only when runtime checks must fail as unconfigured.
  readonly permissions: CatalogDefinitionInput<PermissionDefinition>
    Exact permissions that code in this scope can legitimately check.
```

### types: PermissionCatalog

[Declaration source](types.ts#L154)

```text
type PermissionCatalog<Entries extends Readonly<Record<PropertyKey, PermissionDefinition>>> = Catalog<Entries[keyof Entries], Entries>
  Named permission catalog.
```

### types: PermissionContext

[Declaration source](types.ts#L141)

```text
type PermissionContext<Base extends BaseContext = BaseContext> = Base & Readonly<{ readonly permissions: PermissionRuntime; }>
  Execution-context view with permission checks available.
```

### types: PermissionDecision

[Declaration source](types.ts#L113)

```text
type PermissionDecision = Readonly<{ readonly allowed: true; readonly reason?: string; }> | Readonly<{ readonly allowed: false; readonly reason?: string; }> | Readonly<{ readonly error: unknown; }>
  One atomic result returned by a permission provider.
```

### types: PermissionDefinitions

[Declaration source](types.ts#L166)

```text
type PermissionDefinitions = CatalogDefinitionInput<PermissionDefinition>
  Recursive input accepted where permission definitions are declared.
```

### types: PermissionExpression

[Declaration source](types.ts#L96)

```text
type PermissionExpression = PermissionCheck | PermissionAll | PermissionAny
  Runtime expression accepted by `permissions.check()` and `assert()`.
```

### types: PermissionExpressionInput

[Declaration source](types.ts#L102)

```text
type PermissionExpressionInput = PermissionExpression | TargetlessPermission
  Author input accepted by expression composition and `permissions.batch()`.
```

### types: PermissionRequirement

[Declaration source](types.ts#L67)

```text
type PermissionRequirement = RequirementDefinition<"permission", "require", PermissionDefinition>
  Requirement contribution that declares one permission as reachable.
```

### types: PermissionSchema

[Declaration source](types.ts#L11)

```text
type PermissionSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>
  Standard Schema contract used to validate one optional permission target.
```

### types: PermissionSelection

[Declaration source](types.ts#L160)

```text
type PermissionSelection<Entry extends PermissionDefinition, Entries extends Readonly<Record<PropertyKey, Entry>>> = CatalogSelection<Entry, Entries>
  Key-preserving permission catalog selection.
```

### types: PermissionTarget

[Declaration source](types.ts#L54)

```text
type PermissionTarget<Permission extends PermissionDefinition> = Permission extends PermissionDefinition<string, infer TargetSchema> ? TargetSchema extends PermissionSchema ? StandardSchemaV1.InferOutput<TargetSchema> : undefined : never
  Validated target supplied to a permission provider.
```

### types: PermissionTargetArguments

[Declaration source](types.ts#L60)

```text
type PermissionTargetArguments<Permission extends PermissionDefinition> = Permission extends PermissionDefinition<string, infer TargetSchema> ? TargetSchema extends PermissionSchema ? readonly [StandardSchemaV1.InferInput<TargetSchema>] : readonly [] : readonly []
  Target argument required by `permissions.on()`, `check()`, and `assert()`.
```

### types: PermissionTargetInput

[Declaration source](types.ts#L48)

```text
type PermissionTargetInput<Permission extends PermissionDefinition> = Permission extends PermissionDefinition<string, infer TargetSchema> ? TargetSchema extends PermissionSchema ? StandardSchemaV1.InferInput<TargetSchema> : undefined : never
  Input accepted for one permission definition's concrete runtime target.
```

### types: TargetlessPermission

[Declaration source](types.ts#L99)

```text
type TargetlessPermission = PermissionDefinition<string, undefined>
  Targetless definition that can act as one runtime expression without `on()`.
```
