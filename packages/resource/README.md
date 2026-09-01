`@okikio/resource`
=================

`@okikio/resource` defines provider-neutral capabilities and creates lazily acquired collections of concrete implementations. Definitions describe the complete resource graph. They do not connect to providers or storage at import time.

Start here
----------

A resource can declare dependencies, environment requirements, failures, health metadata, and generic requirements.

```ts
import * as resource from '@okikio/resource';

const Storage = resource.define<StorageClient>()({
	id: 'storage',
	requirements: [permission.require(FileWrite)],
});

const Media = resource.define<MediaClient>()({
	id: 'media',
	dependencies: { storage: Storage },
});
```

`resource.reachable(Media)` returns the statically reachable requirement set from the full dependency graph. Reachable metadata is descriptive and can bind runtime views; it is not automatically active admission work.

Definition requirements are checked on every public borrow. A concrete implementation can declare separate `requirements` that are checked once while that implementation is acquired. This prevents a shared cached resource from reusing one actor's authorization result for another actor.

Acquisition
-----------

A resource implementation receives only its declared dependencies, selected environment values, the host value, and an owned creation context.

```ts
const StorageLive = resource.implement(Storage, {
	requirements: [entitlement.require(StorageProvider)],
	async create({ ctx, environment }) {
		const client = ctx.use(await openClient(environment.URL));
		ctx.defer(() => flushDiagnostics());
		return client;
	},
});
```

The creation context uses standard explicit-resource-management semantics:

- `ctx.use(value)` owns a `Disposable` or `AsyncDisposable` value.
- `ctx.adopt(value, dispose)` owns an arbitrary value through explicit cleanup.
- `ctx.defer(dispose)` registers cleanup without an associated value.

Each acquisition has its own `AsyncDisposableStack`. If creation fails, that stack is disposed immediately. If creation succeeds, the collection owns the completed resource scope.

```text
ResourceCollection
  |
  +-- Storage resource scope
  |     +-- provider client
  |     `-- resource cleanup
  |
  `-- Media resource scope
        +-- borrows Storage
        `-- owns Media-only helpers
```

Dependencies are borrowed. A dependent resource never adopts a dependency that is already owned by the collection. This prevents double disposal.

A returned disposable value is automatically owned by its resource scope when the implementation has not already registered that exact value. `return ctx.use(client)` and `return client` are therefore both safe: an exact `use()` or `adopt()` registration is not duplicated by return-value ownership.

ResourceCollection lifetime
-------------------

Acquisition is lazy and memoized. Concurrent `get()` calls for one exact definition share one in-flight creation. Missing implementations, duplicate implementations, stable-ID conflicts, and dependency cycles fail explicitly.

```ts
await using resources = resource.create(
	resource.implementations(StorageLive, MediaLive),
	{ host, ctx },
);

const media = await resources.get(ctx, Media);
```

`resource.implementations()` deduplicates the same implementation object. Its
result therefore preserves the implementation **types** but does not promise
that its `implementations` array has the same tuple length as the arguments.
Manually, this is the same rule as pushing each implementation into an array
only the first time its object identity is seen.


The collection disposes acquired resource scopes in reverse acquisition order. Cancelling/disposal also waits for in-flight acquisitions so a value that finishes creation late cannot escape ownership.

`@okikio/resource` does not implement databases, browsers, payment systems, or permission engines. Concrete packages implement definitions and hosts decide how generic requirements are interpreted.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `resource.define()` + `implement()` | declare identity/dependencies, separately bind create/dispose behavior, and validate that implementation matches the definition | definition and live provider stay separate |
| `resource.create()` | topologically acquire dependencies, cache values, fence cycles/missing implementations, and unwind partial failures manually | one owned resource graph |
| `implementations()` | deduplicate implementation objects while preserving the implementation union yourself | runtime set semantics no longer lie about tuple length |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/resource` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with a dependency graph, a cache, and one AsyncDisposableStack per acquired value.

The utility adds deterministic dependency selection, cycle checks, scoped requirements, borrowed dependencies, and reverse-order cleanup.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Catalogs, projections, and expected errors
-----------------------------------------

Resource definition sets use the same import-safe composition model as the other
definition utilities:

- `catalog()`, `select()`, and `compose()` build exact resource definition sets.
- `validate()` checks a definition/implementation composition before runtime use.
- `manifest()` projects the dependency/environment shape a host must satisfy.
- `document()` produces deterministic JSON-safe resource metadata.

The main structural errors are `DefinitionConflictError`,
`ImplementationConflictError`, `MissingImplementationError`,
`DependencyCycleError`, and `CollectionDisposedError`. Each identifies a
different ownership/configuration failure; none is silently repaired.


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
