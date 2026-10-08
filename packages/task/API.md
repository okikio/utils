# @okikio/task contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import               | Source                   | Reference       |
| -------------------- | ------------------------ | --------------- |
| `@okikio/task`       | [./mod.ts](./mod.ts)     | [root](#root)   |
| `@okikio/task/types` | [./types.ts](./types.ts) | [types](#types) |

## root

Import `@okikio/task`. [Source](./mod.ts).

Control one process-local operation with cooperative pause, cancellation and joined cleanup. A Promise alone cannot
request a pause or communicate whether cancellation and resource disposal have finished.

Add checkpoints between indivisible provider calls so pause requests have a place to take effect. Pass the context
signal into I/O for cancellation. done owns the terminal value and cleanup failure; disposal joins pending cleanup. A
task is one local lifetime, while a workflow can create many tasks during retries or replay. Do not use a task status as
evidence of durable external acceptance.

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding     | Contract owner or source                       |
| -------------------- | ---------------------------------------------- |
| `context`            | [context contracts](../context/API.md)         |
| `requirements`       | [requirement contracts](../requirement/API.md) |
| `resource`           | [resource contracts](../resource/API.md)       |
| `ResourceDefinition` | [resource contracts](../resource/API.md)       |
| `Task`               | [Source](types.ts)                             |
| `TaskContext`        | [Source](types.ts)                             |
| `TaskOptions`        | [Source](types.ts)                             |
| `TaskStatusType`     | [Source](types.ts)                             |

### root: start

[Declaration source](mod.ts#L42)

```text
function start<Value, Allowed extends ResourceDefinition = never>(run: (ctx: TaskContext<Allowed>) => Value | Promise<Value>, options: TaskOptions<Allowed>): Task<Value>
  Start one process-local Task.

  The Task owns its child context and values registered through that context.
  It borrows an optional resource collection. Pausing is cooperative: an
  indivisible provider call can finish before the next `checkpoint()` waits.
```

### root: Task

[Declaration source](mod.ts#L176)

```text
reference Task: ./packages/task/types.ts:31:1
```

### root: TaskContext

[Declaration source](mod.ts#L176)

```text
reference TaskContext: ./packages/task/types.ts:8:1
```

### root: TaskOptions

[Declaration source](mod.ts#L176)

```text
reference TaskOptions: ./packages/task/types.ts:17:1
```

### root: TaskStatusType

[Declaration source](mod.ts#L176)

```text
reference TaskStatusType: ./packages/task/types.ts:5:1
```

## types

Import `@okikio/task/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding     | Contract owner or source                       |
| -------------------- | ---------------------------------------------- |
| `BaseContext`        | [context contracts](../context/API.md)         |
| `OwnedResources`     | [context contracts](../context/API.md)         |
| `RequirementContext` | [requirement contracts](../requirement/API.md) |
| `RequirementRuntime` | [requirement contracts](../requirement/API.md) |
| `ResourceCollection` | [resource contracts](../resource/API.md)       |
| `ResourceDefinition` | [resource contracts](../resource/API.md)       |
| `ResourceValue`      | [resource contracts](../resource/API.md)       |

### types: Task

[Declaration source](types.ts#L31)

```text
interface Task<Value> extends AsyncDisposable
  One process-local structured execution lifetime.

  readonly done: Promise<Value>
    Terminal authority for the operation result.
  readonly signal: AbortSignal
    Abort signal for the Task-owned local execution lifetime.
  readonly status: TaskStatusType
    Current synchronous lifecycle snapshot. `done` remains terminal authority.
  pause(): Promise<void>
    Request a cooperative pause and resolve when the Task reaches a checkpoint or becomes terminal.
  resume(): void
    Release the current pause generation.
  cancel(reason?: unknown): Promise<void>
    Cancel active work and resolve after its owned cleanup has stopped.
```

### types: TaskContext

[Declaration source](types.ts#L8)

```text
interface TaskContext<Allowed extends ResourceDefinition = never> extends RequirementContext<BaseContext>, OwnedResources
  Context supplied to one process-local Task operation.

  get(definition: Resource): Promise<ResourceValue<Resource>>
    Borrow one allowed resource under the current Task's active requirements.
  checkpoint(): Promise<void>
    Wait at one cooperative pause point and always recheck cancellation before returning.
```

### types: TaskOptions

[Declaration source](types.ts#L17)

```text
interface TaskOptions<Allowed extends ResourceDefinition = never>
  Options accepted by `tasks.start()`.

  readonly id?: string
    Optional stable local identity used for correlation inside the parent execution.
  readonly ctx?: BaseContext
    Borrowed parent execution context. The Task creates its own child cancellation lifetime.
  readonly resources?: ResourceCollection
    Borrowed resource collection. The Task never disposes the collection.
  readonly allowed?: readonly Allowed[]
    Definitions the Task is allowed to borrow from the collection.
  readonly requirements?: RequirementRuntime
    Requirement interpreters inherited by resource use inside this Task.
```

### types: TaskStatusType

[Declaration source](types.ts#L5)

```text
type TaskStatusType = "running" | "pausing" | "paused" | "cancelling" | "completed" | "failed" | "cancelled"
  Lifecycle state of one process-local Task.
```
