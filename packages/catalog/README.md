`@okikio/catalog`
================

Purpose
-------

`@okikio/catalog` groups immutable definitions without creating a global
registry. It is useful when a package has several named definitions and needs a
stable way to compose, select, inspect, or document them.

Start here
----------

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

Nothing is registered globally. `Problems` is only a frozen object plus the
metadata needed to preserve identity and deterministic order.

Select and compose definitions
------------------------------

Selections preserve the original objects and their source keys:

```ts
const PublicProblems = catalog.select(Problems, ['NotFound'] as const);
const EffectiveProblems = catalog.compose(PublicProblems, InvalidInput);

console.log(EffectiveProblems[0] === NotFound); // true
console.log(EffectiveProblems[1] === InvalidInput); // true
```

`compose()` accepts entries, catalogs, selections, and nested arrays. Repeating
the same object is harmless. A different object that claims the same stable
`id` is rejected because the identity would be ambiguous.

A larger composition can therefore remain declarative:

```ts
const ServiceProblems = catalog.compose(
  PublicProblems,
  featureEnabled ? FeatureProblems : [],
  pluginProblems,
  [InvalidInput, optionalProblems],
);
```

Nested input is walked iteratively, so very deep generated composition does not
consume the JavaScript call stack.

Inspect without exposing internal indexes
-----------------------------------------

Use `document()` when tooling needs a deterministic JSON-safe view:

```ts
const value = catalog.document(PublicProblems);

console.log(JSON.stringify(value, null, 2));
```

The document contains public keys, stable IDs, kinds, and descriptions. It does
not expose the reverse-lookup maps used internally.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `catalog.create()` | freeze entries, build identity/key indexes, reject duplicate IDs, and retain namespace metadata | one authoritative immutable definition set |
| `catalog.select()` / `compose()` | look up keys, preserve order, de-duplicate identities, and reject conflicts manually | safe subsets and unions without parallel registry logic |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


The manual version is approximately:

```ts
const entries = Object.freeze({ NotFound, InvalidInput });
const ordered = Object.freeze([NotFound, InvalidInput]);
const byId = new Map(ordered.map((entry) => [entry.id, entry]));
```

You would then need to add duplicate-ID detection, reverse key lookup,
key-preserving selections, deterministic flattening, immutable metadata, and a
JSON-safe document projection yourself. `@okikio/catalog` packages those
mechanics. It does not own the meaning or lifecycle of the definitions.

Use a catalog when several reusable definitions need one named, inspectable
universe. Do not use it as a service locator, startup mechanism, mutable
registry, or dependency container.

How it fits
-----------

Definition-oriented utilities such as `failure`, `resource`, `activity`,
`workflow`, `http/problem`, and `http/response` can use this package to share
one composition model. The catalog utility does not know what an entry means.
Domain semantics stay with the package that owns the definition.

Progressive usage
-----------------

The package participates in the complete domain-enrichment example in
`../../docs/composition.md`. Read that guide after the
individual helpers make sense in isolation and you want to see them composed
with service, resource, runtime, and workflow code.

Validation and failure surface
------------------------------

The less-common runtime operations are still part of the supported model:

- `validate()` checks a catalog/selection structure before another utility trusts it.
- `catalog.isRoot()` and `catalog.isSelection()` are narrow runtime guards for catalog values.
- `CatalogConflictError` means two different definition objects claim the same stable ID.
- `CatalogSelectionError` means a requested selection key is not present in the source catalog.


Source guide
------------

1. `mod.ts` is the public runtime API and contains the composition algorithm.
2. `types.ts` defines catalog, selection, metadata, and document contracts.
3. `mod_test.ts` shows identity conflicts, key preservation, immutability, and
   deep nesting as executable cases.

The README is the primary user documentation. There is intentionally no second
hand-written API reference to keep synchronized.
