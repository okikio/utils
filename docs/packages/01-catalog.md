# Catalog

A deployment needs only some of the permissions declared by the application. Select those exact definitions without
copying them, so identity checks still recognize them later. Catalog gives the collection a name and provides lookup,
selection, composition, and inspection. The application continues to decide what each permission allows.

## Select the definitions one consumer may use

Select canonical declarations without copying their identities. This program supplies its own local input and uses
public workspace imports. After `mise run prepare -- --kind deps`, save it as `example.ts` at the checkout root and run
`mise exec -- deno run example.ts`.

```ts runnable=complete-task.ts
import * as catalog from '@okikio/collection/catalog';
const Read = Object.freeze({ id: 'asset.read', kind: 'permission' });
const Write = Object.freeze({ id: 'asset.write', kind: 'permission' });
const Assets = catalog.create('assets', { Read, Write });
// Selection narrows the available set while preserving each definition's object identity.
const ReadOnly = catalog.select(Assets, ['Read']);
console.log(catalog.get(ReadOnly, 'asset.read') === Read);
console.log(catalog.has(ReadOnly, Write));
console.log(JSON.stringify(catalog.ids(ReadOnly)));
```

Expected output:

```text output
true
false
{"Read":"asset.read"}
```

The first lookup returns the original `Read` object. `Write` is absent from the selection, and inspection reports the
remaining public key and ID. Selecting definitions preserves their identity; it does not authorize the current actor.

## Combine definitions from several sources

`compose()` returns one deterministic list. Here one source is a catalog selection and the other is a direct definition:

```ts
import * as catalog from '@okikio/collection/catalog';

const NotFound = Object.freeze({ id: 'problem:not-found', kind: 'problem' });
const InvalidInput = Object.freeze({ id: 'problem:invalid-input', kind: 'problem' });

const Problems = catalog.create('problems', {
	NotFound,
	InvalidInput,
});

const PublicProblems = catalog.select(Problems, ['NotFound'] as const);
const EffectiveProblems = catalog.compose(PublicProblems, InvalidInput);

console.log(EffectiveProblems[0] === NotFound); // true
console.log(EffectiveProblems[1] === InvalidInput); // true
```

`compose()` accepts entries, catalogs, selections, and nested arrays. Repeating the same object is harmless. A different
object that claims the same stable `id` is rejected because the identity would be ambiguous.

Nested arrays let an application add a feature's definitions conditionally, including `[]` when it is disabled.
Composition walks nested input iteratively, so deep generated input does not consume the JavaScript call stack.

## Inspect without exposing internal indexes

Use `document()` when tooling needs a deterministic JSON-safe view:

```ts
const value = catalog.document(PublicProblems);

console.log(JSON.stringify(value, null, 2));
```

The document contains public keys, stable IDs, kinds, and descriptions. It does not expose the reverse-lookup maps used
internally.

## Convenience and the manual equivalent

| Convenience                      | Manual equivalent                                                                               | Concrete value                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `catalog.create()`               | freeze entries, build identity/key indexes, reject duplicate IDs, and retain namespace metadata | one authoritative immutable definition set              |
| `catalog.select()` / `compose()` | look up keys, preserve order, de-duplicate identities, and reject conflicts manually            | safe subsets and unions without parallel registry logic |

An ordinary frozen record plus an ID map can store the definitions. You would still need duplicate-ID detection, reverse
key lookup, key-preserving selections, deterministic flattening, immutable metadata, and a JSON-safe document projection
yourself. `@okikio/collection/catalog` packages those mechanics. It does not own the meaning or lifecycle of the
definitions.

Use a catalog when several reusable definitions need one named, inspectable universe. Do not use it as a service
locator, startup mechanism, mutable registry, or dependency container.

## Preserve definition identity when selecting a catalog

Definition-oriented utilities such as `failure`, `resource`, `activity`, `workflow`, `http/problem`, and `http/response`
can use this package to share one composition model. The catalog utility does not know what an entry means. Domain
semantics stay with the package that owns the definition.

## Progressive usage

Read [complete compositions](../03-composition.md) for a bounded CSV import, allowed-page discovery and a
resource-backed operation. Each example names its result and owner. Use [the outcome guide](../07-outcomes.md) to choose
additional mechanisms when the application needs them.

## Validation and failure surface

The less-common runtime operations are still part of the supported model:

- `validate()` checks a catalog/selection structure before another utility trusts it.
- `catalog.isRoot()` and `catalog.isSelection()` are narrow runtime guards for catalog values.
- `CatalogConflictError` means two different definition objects claim the same stable ID.
- `CatalogSelectionError` means a requested selection key is not present in the source catalog.

## Source guide

The paths below are relative to the [package directory](../../packages/collection/catalog).

1. `mod.ts` is the public runtime API and contains the composition algorithm.
2. `types.ts` defines catalog, selection, metadata, and document contracts.
3. `mod.test.ts` shows identity conflicts, key preservation, immutability, and deep nesting as executable cases.

The README is the primary user documentation. There is intentionally no second hand-written API reference to keep
synchronized.
