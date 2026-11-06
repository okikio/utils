# `@okikio/collection/catalog`

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

The examples below show runtime behavior. [mod.ts](./mod.ts) documents each operation and [types.ts](./types.ts)
describes the metadata and inferred definition types.

## Select a canonical permission definition

Give two permission definitions one catalog, then select the read definition for a consumer. The identity comparison
shows that lookup returns the original object, while the write definition stays outside the selection.

From a checkout of this experimental workspace, run `mise trust`, `mise install`, then `mise run prepare -- --kind deps` at the repository root. Save the following program as `example.ts` and run `mise exec -- deno run example.ts`. These commands use the workspace export maps; they do not assume a published registry version.

```ts runnable
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
| `select(catalog, keys)`                  | Catalog or selection + key list → frozen subset      | Unknown keys throw; selected entries keep object identity.                        |
| `get(input, id)` / `has(catalog, entry)` | ID → entry or `undefined`; exact object → boolean    | Matching an ID and matching an imported object answer different questions.        |

Under the hood, `create()` does three things:

1. It checks each definition's `id` and `kind`, and rejects different objects that reuse an ID.
2. It copies the named properties into a frozen outer object. The definitions themselves stay the same objects.
3. It retains private maps for ID lookup and object membership. `select()` builds the same maps for the chosen subset.

This design lets separate packages agree on one imported definition. A plain string cannot prove that two callers mean
the same contract. There is no global registration or permission enforcement here; authorization still needs an
application decision.

## Select definitions for a receiver or deployment

- Group [Failure](../../result/failure/README.md) definitions so a receiver can decode only the expected failures it
  recognizes. The trusted definitions supply meaning; an incoming string supplies only the lookup ID.
- Select [Resource](../../capability/resource/README.md) definitions for one application deployment. The catalog
  describes the subset; the resource provider still owns opening and closing live clients.

## Selection and inspection

`select(catalog, ['Read'])` and `select(selection, ['Read'])` retain only the selected definition union in both direct
properties and `DefinitionEntry<typeof selection>`. Selection metadata points to the original source catalog, whose
entry type remains broad. A second selection can only choose keys still present in its input. A Catalog namespace groups
authored definitions for lookup and diagnostics; it does not schedule work or grant tenant access.

`validate()` returns stable structured issue codes. If inspection itself fails, the issue contains a process-local
`cause` and a fixed message. Format that cause with the diagnostic capability at the reporting consumer; do not persist
it as a catalog definition. Catalog does not import Fault or choose a transport error format.

## Choose adjacent capabilities

Use this for identity-bearing declarations such as permissions and resources. Use Record when copying or changing
ordinary data; serializing a definition does not preserve its object identity.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

The [numbered guide](https://github.com/okikio/utils/blob/main/docs/packages/01-catalog.md) explains the model, manual
alternatives, and composition.
