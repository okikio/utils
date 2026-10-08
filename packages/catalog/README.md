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

The examples and compact contracts below stand on their own. The [full API reference](API.md) lists every export.

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

## What those three calls do

You can use `Assets.Read` like any ordinary object property. The extra behavior is in the checks and lookups, not in a
new execution language. These are the contracts used above:

| Call or value                            | Input and output                                     | Rule to remember                                                                  |
| ---------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| Entry                                    | `{ id: string, kind: string, description?: string }` | Your package creates and owns this object.                                        |
| `create(namespace, entries)`             | Named entry map → frozen catalog with the same keys  | Invalid entries and conflicting IDs throw. Entries are borrowed, not deep-frozen. |
| `select(catalog, keys)`                  | Catalog + key list → frozen subset                   | Unknown keys throw; selected entries keep object identity.                        |
| `get(input, id)` / `has(catalog, entry)` | ID → entry or `undefined`; exact object → boolean    | Matching an ID and matching an imported object answer different questions.        |

Under the hood, `create()` does three things:

1. It checks each definition's `id` and `kind`, and rejects different objects that reuse an ID.
2. It copies the named properties into a frozen outer object. The definitions themselves stay the same objects.
3. It retains private maps for ID lookup and object membership. `select()` builds the same maps for the chosen subset.

This design lets separate packages agree on one imported definition. A plain string cannot prove that two callers mean
the same contract. There is no global registration or permission enforcement here; authorization still needs an
application decision.

## Build on the example

- Group [Failure](../failure/README.md) definitions so a receiver can decode only the expected failures it recognizes.
  The trusted definitions supply meaning; an incoming string supplies only the lookup ID.
- Select [Resource](../resource/README.md) definitions for one application deployment. The catalog describes the subset;
  the resource provider still owns opening and closing live clients.

## Combine definitions from several sources

`compose()` returns one deterministic list. Here one source is a catalog selection and the other is a direct definition:

```ts
import * as catalog from '@okikio/catalog';

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
