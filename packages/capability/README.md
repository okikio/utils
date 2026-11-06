# Capability

Give ordinary work explicit access to shared resources, application rules, and accepted effects. The application
supplies providers and policies. Capability connects their contracts while Context supplies the operation lifetime.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

Use a focused subpath when one mechanism is enough. Use `scope` when a function needs several of them together. Use Task
when the operation itself needs pause, resume, cancellation, and a terminal result handle.

## Save a note with explicit dependencies

The note has three separate concerns. A **resource** lends the Map that stores it. A **requirement** asks whether this account may save. An **effect** announces that the save happened and waits for a recipient. Definitions describe these concerns; live bindings supply the Map, evaluator and recipient. None of them performs a save simply by being declared.

This complete example declares a store, checks a save rule, and announces the saved note. The store implementation uses
a real in-memory Map. Its collection owns cleanup; the operation borrows it. The supplied requirement interpreter checks
a real application condition before the write.

A **scope** here is a view of the same operation lifetime with selected dependencies, rules and recipients attached.
It is not a new thread or a background service. The `ctx` variable carries that view through ordinary function calls.
`await` waits for each asynchronous operation, and `await using` closes the owned collection and Context when the block
ends. Borrowed views do not close those owners independently.

From a checkout of this experimental workspace, run `mise trust`, `mise install`, then `mise run prepare -- --kind deps` at the repository root. Save the following program as `save-note.ts` and run `mise exec -- deno run save-note.ts`. These commands use the workspace export maps; they do not assume a published registry version.

```ts runnable=save-note.ts
import * as context from '@okikio/context';
import * as capability from '@okikio/capability';
import * as schema from '@okikio/schema';

const Store = capability.resource.define<Map<string, string>>()({ id: 'notes', description: 'Saved notes.' });
const CanSave = capability.requirement.define({ family: 'notes', action: 'save', definition: Store });
const Saved = capability.effect.define({ id: 'note.saved', value: schema.object({ id: schema.string() }) });
const live = capability.resource.implement(Store, {
	/** Tie the demo store to the resource context so scope exit also releases its contents. */
	create({ ctx }) {
		const notes = new Map<string, string>();
		ctx.defer(() => notes.clear());
		return notes;
	},
});

await using owner = context.create({ id: 'save-note' });
await using clients = await capability.resource.open(live, { ctx: owner });
const account = { canWrite: true };
const accepted: string[] = [];
const ctx = capability.scope(owner, {
	resources: { collection: clients.collection, allowed: [Store] },
	requirements: {
		interpreters: {
			notes: {
				/** Interpret the declared requirement using this application's account policy. */
				async apply() {
					if (!account.canWrite) throw new Error('Account cannot save notes.');
				},
			},
		},
	},
	effects: {
		effects: [Saved],
		emitter: {
			async emit(_ctx, occurrence) {
				accepted.push(occurrence.key);
			},
		},
	},
});
// Check permission before changing the store. Declaring a requirement alone does not enforce it.
await capability.requirement.apply(ctx, [CanSave]);
const store = await ctx.get(Store);
store.set('note-1', 'Remember the photo');
// This receiver records an occurrence in memory; it does not make the preceding write durable.
await capability.effect.emit(ctx, Saved, { id: 'note-1' }, { key: 'save:note-1' });
console.log(store.get('note-1'));
console.log(accepted.join(','));
```

```text output
Remember the photo
save:note-1
```

`scope` returns immediately and acquires nothing. `get` checks the allowlist and the resource's use requirements, then
borrows its lazily acquired value. `requirement.apply` activates the explicit save rule. `effect.emit` waits for the
supplied recipient to accept the validated occurrence. These are distinct actions: constructing a scope does not apply
rules, save data, or accept an effect.

The Map write and effect acceptance are two operations. If they must commit atomically, the application needs a
transactional store/outbox. An effect key permits deduplication by a recipient; it cannot make arbitrary work exactly
once. The example's array recipient is process-local acceptance, not durable delivery.

## Adopt only what your caller needs

| Import                           | Useful on its own                                            | Composition                                                                           |
| -------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `@okikio/capability/resource`    | Share one lazy client under an explicit owner                | `scope(...).get(Definition)` lends an allowed client to ordinary work.                |
| `@okikio/capability/requirement` | Declare, inspect, and activate application rules             | Resource use, Task, Activity, and Service can call the same interpreter.              |
| `@okikio/capability/effect`      | Prepare a schema-checked occurrence without sending it       | A recipient accepts required consequences; optional diagnostics use telemetry.        |
| `@okikio/capability/resilience`  | Inspect retry policy or repeat a safely classified operation | `attempt` uses a supplied signal and clock; `poll` owns repeated idle polling.        |
| `@okikio/capability/execution`   | Compose `scope` and import its shared types                  | Task and Activity use the same scope construction, keeping their own execution rules. |

The root exports these four families, `scope`, and the direct `attempt` operation. Focused imports have the same
contracts and need no application-wide runtime.

## Retry an ordinary read

The operation returns its own value. A classifier explicitly admits only the known temporary failure; the policy and
clock control the intervening wait. A real Fetch call must receive the supplied signal itself.

Save this complete variation as `retry-read.ts` and run `mise exec -- deno run retry-read.ts` after the same checkout setup.

```ts runnable=retry-read.ts
import { attempt, resilience } from '@okikio/capability';

const temporary = new Error('Temporary read failure.');
let calls = 0;
const value = await attempt(() => {
	calls++;
	if (calls === 1) throw temporary;
	return 'Report ready';
}, {
	signal: new AbortController().signal,
	policy: resilience.retry({ maximumAttempts: 2, initialDelay: { milliseconds: 1 }, jitter: false }),
	isRetryable: (error) => error === temporary,
});
console.log(value, calls);
```

```text output
Report ready 2
```

## Keep ownership and authority explicit

A scope borrows its base signal, clock, cleanup operations, resource collection, and effect recipient. It preserves the
base's typed custom fields. Registering cleanup through an owned view registers it with the same owner. It creates no
second cleanup stack. Closing a task closes the task lifetime, not a borrowed collection.

Resource access requires an explicit `collection` and `allowed` definition input. Re-scoping without resources gives an
empty resolver even if the source had broader access. Omitted requirement/effect options preserve their existing view;
supplied options replace those configurations. A plain context starts with rejection for unknown requirements and no
allowed effects. `scope` itself does not grant permission or activate a rule.

Read the [Resource](./resource/README.md), [Requirement](./requirement/README.md), [Effect](./effect/README.md), and
[Resilience](./resilience/README.md) guides. [execution.ts](./execution.ts) documents scope types and the shared
`ExecutionContext`; Task adds pause/checkpoint behavior and Activity adds validated attempts.

## Give a report its dependencies and policy

A report needs a database client, permission to read records, and a recipient for its completion fact. Resources supply
the client; requirements express permission; effects name the accepted fact.

Start with ordinary parameters. Add a resource collection for lazy owned dependencies, a requirement checker for policy,
and an effect recipient for an explicit handoff.

An observation does not prove delivery. Retrying a write requires application repeat-safety; neither a resource scope
nor an effect declaration supplies it.

## Choose an entry point

Use the table to find a focused import for the job you need. Contract links open the exact public source, including its
options and types.

| Import                                      | Use it to                                                                           | Exact contract                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------- |
| `@okikio/capability/effect`                 | Validate an occurrence and await acceptance by its declared recipient.              | [Contract](./effect/mod.ts)             |
| `@okikio/capability/effect/types`           | Import public types for this capability; this entry does not start work.            | [Contract](./effect/types.ts)           |
| `@okikio/capability/effect/observe`         | Observe accepted occurrences; subscriptions do not own delivery or the work result. | [Contract](./effect/observe.ts)         |
| `@okikio/capability/effect/meter`           | Record validated usage facts through an effect recipient.                           | [Contract](./effect/meter/mod.ts)       |
| `@okikio/capability/effect/meter/types`     | Import public types for this capability; this entry does not start work.            | [Contract](./effect/meter/types.ts)     |
| `@okikio/capability/effect/meter/schema`    | Validate meter values and expose their JSON Schema representation.                  | [Contract](./effect/meter/schema.ts)    |
| `@okikio/capability/requirement`            | Interpret declared requirements through an explicit checker.                        | [Contract](./requirement/mod.ts)        |
| `@okikio/capability/requirement/types`      | Import public types for this capability; this entry does not start work.            | [Contract](./requirement/types.ts)      |
| `@okikio/capability/requirement/definition` | Declare requirements without loading their execution owner.                         | [Contract](./requirement/definition.ts) |
| `@okikio/capability/resilience`             | Choose retry, polling, timeout, and admission policy.                               | [Contract](./resilience/mod.ts)         |
| `@okikio/capability/resilience/types`       | Import public types for this capability; this entry does not start work.            | [Contract](./resilience/types.ts)       |
| `@okikio/capability/resilience/poll`        | Poll for available work with explicit limits and failure classification.            | [Contract](./resilience/poll.ts)        |
| `@okikio/capability/resource`               | Create dependencies lazily, borrow declared access, and dispose owned instances.    | [Contract](./resource/mod.ts)           |
| `@okikio/capability/resource/types`         | Import public types for this capability; this entry does not start work.            | [Contract](./resource/types.ts)         |
| `@okikio/capability/resource/session` | Keep a stateful resource on its owner and lend references with bounded lifetime. | [Contract](./resource/session/mod.ts) |
| `@okikio/capability/execution`              | Attach borrowed capabilities to a caller-owned execution lifetime.                  | [Contract](./execution.ts)              |
| `@okikio/capability`                        | Use the package entry shown in the complete examples above.                         | [Contract](./mod.ts)                    |
| `@okikio/capability/resilience/attempt`     | Retry an ordinary operation under an explicit safety classifier and time budget.    | [Contract](./resilience/attempt.ts)     |

Resource owners can inspect lifetime categories without acquiring a value:

```ts
const report = resource.inspect(collection, { maximumResources: 20 });
console.log(report.state, report.configured, report.capped, report.resources);
```

`document(implementations)` remains the static definition/dependency description. `inspect` reads only a collection
created by this module. It returns a bounded prefix in implementation order with configured, acquiring, ready, releasing
or closed categories. The configured count covers the full graph; `capped` means later entries were omitted. Zero
returns counts without entries. No resource value, environment field, credential, provider exception or permission
target enters this report, and inspecting does not parse environment or check policy. Definition IDs are authored
diagnostic metadata and still need an appropriate access policy. Failed acquisitions return to configured so a later
explicit use can retry. Inspection keeps no failure history. Disposing remains observable until all cleanup attempts
settle; disposed includes disposal that rejected. Inspecting never grants the ability to borrow or write a resource.
Borrowed scoped resolvers do not carry this diagnostic capability.

## Explain requirement activation and claimed enforcement

```ts
import * as context from '@okikio/context';
import * as requirement from '@okikio/capability/requirement';
await using owner = context.create({ id: 'deployment-evidence' });
const needed = requirement.define({
	family: 'feature',
	action: 'require',
	definition: { kind: 'feature', id: 'export' },
});
console.log(await requirement.explain(owner, [needed], { mode: 'inspect', maximumRequirements: 1 }));
```

Inspect mode reads configuration only and invokes no interpreter. An absent family is `unsupported`, or `ignored` when
the scope explicitly selects that permissive policy. An own interpreter entry is `configured`, which is declaration
evidence, not proof that a future operation runs through it. Prototype names never configure an interpreter. Pass a flat
definition array; the entry limit is checked before normalization or application. Compose trusted catalogs at their
declaration owner.

`mode: 'apply'` deliberately activates real requirements through the ordinary application path. It can have side
effects. Each family receives one deduplicated batch, and the first rejection stops later families, reported as
`unreached`. The caller's `denied(error, family)` classifier recognizes expected family denials; omission classifies
interpreter exceptions as `fault`. Reports contain public requirement identities and outcomes, excluding raw evaluator
errors, targets and runtime objects. Cancellation and classifier defects still throw. `allowed` means this activation
completed; it is not a reusable access grant.

`resilience.inspect(declarations, enforcementOwners, limits)` validates the existing flat policy declarations, including
operation safety, then compares each policy with explicit `{ type, owner, id }` deployment claims. Outcomes distinguish
missing, competing, wrong-boundary and matching claims. `claimed` is metadata only: the service still needs host
integration proof. The report includes public owner IDs and stable validation codes. It creates no runtime, timer or
retry loop; existing attempt/poll remain the concrete execution owners.

## Record a bounded meter batch

`@okikio/capability/effect/meter` exports `recordBatch(ctx, definition, readings,
{ maximumItems, maximumBytes })`. Each
reading supplies `key`, `value`, and an explicit matching `unit` when the definition has one; attributes are optional.
The function validates every reading and counts encoded effect-envelope UTF-8 bytes before contacting the sink. Encoding
allocations happen before the byte check, so this is a wire budget, not a heap quota.

Delivery uses the existing effect emitter sequentially. An accepted result holds the exact accepted occurrences. A
partial result identifies the rejected index, original error and accepted prefix; later readings are not sent. Preflight
failures throw with no delivery. Duplicate keys retain authored order. The sink owns deduplication and conflicting
retries. There is no transaction, rollback, quota authority or automatic retry. Use stable keys if retrying the
remainder.

Save this complete variation as `meter-batch.ts` and run `mise exec -- deno run meter-batch.ts` after the same checkout setup.

```ts runnable=meter-batch.ts
import * as context from '@okikio/context';
import * as effect from '@okikio/capability/effect';
import * as meter from '@okikio/capability/effect/meter';
await using owner = context.create({ id: 'meter-batch' });
const Bytes = meter.define({ id: 'bytes', unit: 'byte' });
const accepted: string[] = [];
const ctx = effect.scope(owner, {
	effects: [meter.effect(Bytes)],
	emitter: {
		async emit(_ctx, occurrence) {
			accepted.push(occurrence.key);
		},
	},
});
const result = await meter.recordBatch(ctx, Bytes, [
	{ key: 'asset:one', value: 128, unit: 'byte' },
	{ key: 'asset:two', value: 256, unit: 'byte' },
], { maximumItems: 2, maximumBytes: 1024 });
console.log(result.status, result.accepted.length);
console.log(accepted.join(','));
```

```text output
accepted 2
asset:one,asset:two
```

## Measure acquisition and enforcement costs

The focused benchmarks measure resource acquire/use/dispose, effect acceptance, requirements and resilience evidence and
live inspection of 10–1,000 configured resources without acquiring them. The benchmark compares against explicit value
cleanup, direct sink and enforcement without reports. Provider I/O and durable delivery are excluded.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
deno task --cwd=packages/capability test
deno task --cwd=packages/capability bench:check
deno task --cwd=packages/capability bench
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.

## Borrow a stateful resource across activities

Use [`@okikio/capability/resource/session`](./resource/session/mod.ts) for bounded owner-local resources referenced across activities. The [session guide](../../docs/workflows/18-sessions.md) gives a complete example, exclusive/shared borrowing rules, durable PostgreSQL authority, expiry and explicit replacement. Values remain on their physical owner; saved references do not preserve a dead resource.
