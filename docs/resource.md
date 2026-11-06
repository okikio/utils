# Declare a dependency separately from acquiring it

A save operation needs a store, but should not decide which database to open or when to close it. A resource definition
describes that dependency. The application supplies its implementation, and a collection creates and owns the live
value. The save operation borrows it for its work.

A declaration opens nothing. Resource definitions name the dependencies an operation needs; runtime bindings supply
their implementations. Partial construction must release resources already acquired.

The application **host** is the code that knows how to create the actual client. The calling operation only needs its
methods. A **collection** keeps the created clients and closes what it owns; borrowing a client does not transfer that
cleanup responsibility to the caller.

`await using` closes a disposable value when its block ends, including after an exception. Declarations are disposed in
reverse order. The collection supplies its own Context unless you pass an existing lifetime. An `await` inside the save operation waits for a Promise;
it does not release or move the borrowed client while the operation is paused.

## Save and read a note through a supplied store

The definition names the store a caller needs. Its implementation creates the in-memory store, and the collection owns
that value while the caller borrows it. Saving and reading the note makes those three roles visible.

Run from this checkout after `mise run prepare -- --kind deps`. Save the runnable block as `example.ts` at the checkout root and use
`mise exec -- deno run example.ts`.

```ts runnable
import * as resource from '@okikio/capability/resource';
const Store = resource.define<{
	save(id: string, text: string): void;
	read(id: string): string | undefined;
}>()({ id: 'store', description: 'Save and read notes.' });
const StoreLive = resource.implement(Store, {
	/** Tie the demo store to the resource context so scope exit also releases its contents. */
	create({ ctx }) {
		const notes = new Map<string, string>();
		ctx.defer(() => notes.clear());
		return {
			save(id: string, text: string): void {
				notes.set(id, text);
			},
			read(id: string): string | undefined {
				return notes.get(id);
			},
		};
	},
});
// The collection supplies local cancellation and cleanup; its first get opens the store.
await using stores = await resource.open(StoreLive);
const store = await stores.get(Store);
store.save('note-1', 'Bring the family photo');
console.log(store.read('note-1'));
```

Expected output:

```text output
Bring the family photo
```

## Declare what acquisition needs

`define<Value>()({ id, description, dependencies, environment, requirements })` preserves the authored ID and inferred
dependency types. `define<Value>({ id, description })` is a convenient direct form when that extra generic inference is
unneeded. Keep one imported definition as the canonical identity; copying its ID into a new object is a conflict.

Dependencies are keyed definitions. An implementation's `create({ dependencies })` receives their typed values, already
acquired. Environment requirements select and parse configuration before the resource acquires its dependencies. The
composition root chooses either raw `source` or already parsed `environment`, never both.

Definition requirements are checked on every public borrow. Implementation requirements are checked once per
acquisition. This distinction prevents the first actor's successful use check from granting every later actor access to
a cached client. `reachable(definitions)` describes rules reachable through dependencies; it does not activate them.

## Give the value one owner

The factory receives an acquisition context with three cleanup operations:

| Operation                 | Owned cleanup                                   |
| ------------------------- | ----------------------------------------------- |
| `ctx.use(value)`          | Dispose an already disposable value.            |
| `ctx.adopt(value, close)` | Run the supplied closer for an arbitrary value. |
| `ctx.defer(close)`        | Run cleanup without a related returned value.   |

A returned disposable value is adopted if this acquisition has not already registered it. Returning `ctx.use(client)`
and returning a newly created disposable client therefore both close it once. A value borrowed from another owner
requires `ownership: 'borrowed'` on the implementation. Cleanup explicitly registered by that factory remains local.

Declared dependency values stay borrowed. A derived resource may return one directly without adopting it again.
Attempting to register that dependency with `ctx.use` or `ctx.adopt` rejects. This keeps dependency cleanup with the
collection scope that originally acquired it.

## Borrow lazily and join shutdown

`await resource.open(binding)` owns a lazy collection and any Context it creates. `get(Definition)` borrows under that
default lifetime; `get(Definition, callerContext)` checks a particular request's access and cancellation instead.
A supplied parent remains borrowed. For a host that already assembles these pieces,
`create(implementations, { ctx, host })` supplies the lower-level collection and `get(ctx, Definition)` makes its caller
explicit. Both paths check current use requirements before lazily creating the requested implementation. Concurrent borrowers of that exact
definition share the same pending creation. A failed creation releases its partial resources and permits a later
acquisition.

Use `await using collection` or await its disposal. Shutdown cancels pending acquisition, joins that cleanup, and closes
acquired resources in reverse dependency order. An operation that ignores cancellation can prevent the join from
finishing; shutdown does not preempt JavaScript or terminate an arbitrary provider.

One borrower's cancelled wait does not cancel acquisition shared by another borrower. Disposing the collection does. The
collection's owner sees cleanup failures even when the borrower stopped waiting. A sole failure retains its exact value;
independent cleanup failures form an AggregateError. SuppressedError preserves the acquisition failure when its cleanup
also failed. Ordinary factory failure with successful cleanup does not make later disposal fail.

## Restrict a consumer's access

`resource.scope(collection, ctx, definitions)` binds borrowing to one caller and an exact definition set. The
lower-level collection itself remains able to resolve every configured implementation. A definition set describes a
permitted resource dependency; application authorization is still interpreted through its active requirements.

At this lower level, `resource.scope(collection, ctx)` with no third argument permits every configured definition. Pass
an empty definition list to permit none. Capability's combined scope always requires an explicit allowlist when
resources are supplied, so a consumer's dependency set stays visible at its composition site.

For a function that also needs effect delivery or policy interpretation, use Capability's
[`scope`](../packages/capability/README.md#save-a-note-with-explicit-dependencies):

```ts
const scoped = capability.scope(ctx, {
	resources: { collection, allowed: [Store] },
	requirements: { interpreters },
	effects: { effects: [Saved], emitter },
});
const store = await scoped.get(Store);
```

This fragment assumes application-owned definitions and providers. The linked package example supplies all of them. The
scope borrows the collection, and `allowed` is required. Creating a new Capability scope without resources removes
resource borrowing from that view. Task and Activity reuse this composition while preserving their own execution and
cleanup rules.

Use Pool when a consumer needs exclusive, bounded leases rather than shared access to one value. Use Storage or a
provider-specific package for persistence. Resource does not choose a database, browser, or deployment.

## Decide which bookkeeping to keep in your application

| Convenience                         | Manual equivalent                                                                                                               | Concrete value                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `resource.define()` + `implement()` | declare identity/dependencies, separately bind create/dispose behavior, and validate that implementation matches the definition | definition and live provider stay separate             |
| `resource.open()`                   | own a local Context and lazy collection, normalize one binding or an array, and join their cleanup                                | one complete local resource lifetime                   |
| `resource.create()`                 | topologically acquire dependencies, cache values, fence cycles/missing implementations, and unwind partial failures manually    | one owned resource graph                               |
| `implementations()`                 | deduplicate implementation objects while preserving the implementation union yourself                                           | runtime set semantics no longer lie about tuple length |

`@okikio/capability/resource` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics with a
dependency graph, a cache, and one AsyncDisposableStack per acquired value.

The utility adds deterministic dependency selection, cycle checks, scoped requirements, borrowed dependencies, and
reverse-order cleanup.

A resource definition says what a consumer receives. An implementation creates that value. A collection owns the live
values and lends them to callers. The [complete note-store examples](../packages/capability/resource/README.md) show
these roles with actual in-memory data.
