# `@okikio/catalog`

Imagine several services share the same definitions for “read an asset” and “write an asset.” A read-only service needs
just the first definition. `catalog` groups these named definitions and selects a subset while keeping the original
objects. Think of it as a menu of available contracts, rather than a service that performs them.

The demo makes that distinction visible:

| Question about the read-only selection                   | Answer             | What it means                     |
| -------------------------------------------------------- | ------------------ | --------------------------------- |
| Does `asset.read` resolve to the original `Read` object? | `true`             | Selection preserves its identity. |
| Does the selection contain the original `Write` object?  | `false`            | Write was left out.               |
| Which named ID remains?                                  | `Read: asset.read` | There is one selected definition. |

This table shows membership, not permission enforcement. Selecting `Read` does not authorize a person to read an asset.

For shared terms such as `await` and `await using`, see
[the short glossary](../../docs/learn.md#read-the-small-amount-of-code-you-need).

For the exact functions, types and field explanations, read the [generated contract reference](API.md).

## Run a complete example

```ts runnable
import * as catalog from '@okikio/catalog';
const Read = Object.freeze({ id: 'asset.read', kind: 'permission' });
const Write = Object.freeze({ id: 'asset.write', kind: 'permission' });
const Assets = catalog.create('assets', { Read, Write });
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

The input is two frozen definitions. `select()` keeps `Read`, and the output checks both what survived and what did not.
Try selecting both keys to keep both definitions. Creating a different object with the same ID is a conflict when those
objects are composed; copying its spelling does not make it the same definition.

## Build on the example

- Group [Failure](../failure/README.md) definitions so a receiver can decode only the expected failures it recognizes.
  The trusted definitions supply meaning; an incoming string supplies only the lookup ID.
- Select [Resource](../resource/README.md) definitions for one application deployment. The catalog describes the subset;
  the resource provider still owns opening and closing live clients.

Use a named catalog for public contracts, select a deployment subset, then compose compatible catalogs. get() resolves a
stable ID while has() checks the exact imported object. Different objects with the same ID cause a conflict. The
immutable catalog does not own a runtime connection or globally register its definitions.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Purpose

`@okikio/catalog` groups immutable definitions without creating a global registry. It is useful when a package has
several named definitions and needs a stable way to compose, select, inspect, or document them.

## Start here

Create a catalog from definitions you already own:

```ts
import * as catalog from '@okikio/catalog';

const NotFound = Object.freeze({ id: 'problem:not-found', kind: 'problem' });
const InvalidInput = Object.freeze({ id: 'problem:invalid-input', kind: 'problem' });

const Problems = catalog.create('problems', {
	NotFound,
	InvalidInput,
});

console.log(catalog.values(Problems));
// [NotFound, InvalidInput]
```

Nothing is registered globally. `Problems` is only a frozen object plus the metadata needed to preserve identity and
deterministic order.

## Select and compose definitions

Selections preserve the original objects and their source keys:

```ts
const PublicProblems = catalog.select(Problems, ['NotFound'] as const);
const EffectiveProblems = catalog.compose(PublicProblems, InvalidInput);

console.log(EffectiveProblems[0] === NotFound); // true
console.log(EffectiveProblems[1] === InvalidInput); // true
```

`compose()` accepts entries, catalogs, selections, and nested arrays. Repeating the same object is harmless. A different
object that claims the same stable `id` is rejected because the identity would be ambiguous.

A larger composition can therefore remain declarative:

```ts
const ServiceProblems = catalog.compose(
	PublicProblems,
	featureEnabled ? FeatureProblems : [],
	pluginProblems,
	[InvalidInput, optionalProblems],
);
```

Nested input is walked iteratively, so very deep generated composition does not consume the JavaScript call stack.

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

The manual version is approximately:

```ts
const entries = Object.freeze({ NotFound, InvalidInput });
const ordered = Object.freeze([NotFound, InvalidInput]);
const byId = new Map(ordered.map((entry) => [entry.id, entry]));
```

You would then need to add duplicate-ID detection, reverse key lookup, key-preserving selections, deterministic
flattening, immutable metadata, and a JSON-safe document projection yourself. `@okikio/catalog` packages those
mechanics. It does not own the meaning or lifecycle of the definitions.

Use a catalog when several reusable definitions need one named, inspectable universe. Do not use it as a service
locator, startup mechanism, mutable registry, or dependency container.

## How it fits

Definition-oriented utilities such as `failure`, `resource`, `activity`, `workflow`, `http/problem`, and `http/response`
can use this package to share one composition model. The catalog utility does not know what an entry means. Domain
semantics stay with the package that owns the definition.

## Progressive usage

Read [complete compositions](../../docs/composition.md) for a bounded CSV import, allowed-page discovery and a
resource-backed operation. Each example names its result and owner. Use [the outcome guide](../../docs/outcomes.md) to
choose additional mechanisms when the application needs them.

## Validation and failure surface

The less-common runtime operations are still part of the supported model:

- `validate()` checks a catalog/selection structure before another utility trusts it.
- `catalog.isRoot()` and `catalog.isSelection()` are narrow runtime guards for catalog values.
- `CatalogConflictError` means two different definition objects claim the same stable ID.
- `CatalogSelectionError` means a requested selection key is not present in the source catalog.

## Source guide

1. `mod.ts` is the public runtime API and contains the composition algorithm.
2. `types.ts` defines catalog, selection, metadata, and document contracts.
3. `mod.test.ts` shows identity conflicts, key preservation, immutability, and deep nesting as executable cases.

The README is the primary user documentation. There is intentionally no second hand-written API reference to keep
synchronized.
