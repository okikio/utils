# Collection

Keep authored definitions and ordinary data usable without losing what makes each valuable. Catalog preserves the exact
objects that define resources, permissions, effects, or failures. Record inspects and transforms data without reading
inherited properties or ordinary getters.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

A **definition** is a JavaScript object that describes an allowed operation, such as a read permission. Some utilities
recognize the exact object with `===`, not just its text ID. A catalog therefore holds the original objects. An ordinary
record, such as `{ title: 'Draft' }`, instead carries data that can be copied and changed. These two jobs need different
copying rules.

Choose Catalog when identity matters. Choose Record when the values themselves matter. Copying a resource definition as
JSON cannot preserve the identity its consumers use.

## Select definitions for one consumer

A deployment can narrow a shared catalog, then an endpoint can narrow that selection again. The selected definitions
remain the same objects, and a later selection cannot recover a definition excluded earlier.

From a checkout of this experimental workspace, run `mise trust`, `mise install`, then `mise run prepare -- --kind deps` at the repository root. Save the following program as `select-definitions.ts` and run `mise exec -- deno run select-definitions.ts`. These commands use the workspace export maps; they do not assume a published registry version.

```ts runnable=select-definitions.ts
import { catalog } from '@okikio/collection';

const Read = { id: 'asset.read', kind: 'permission' } as const;
const Write = { id: 'asset.write', kind: 'permission' } as const;
const available = catalog.create('assets', { Read, Write });
// Narrow the available definitions without cloning them or inventing new identities.
const deployment = catalog.select(available, ['Read']);
const endpoint = catalog.select(deployment, ['Read']);
console.log(endpoint.Read === Read);
console.log(catalog.has(endpoint, Write));
console.log(JSON.stringify(catalog.ids(endpoint)));
```

```text output
true
false
{"Read":"asset.read"}
```

The string `assets` is a label for lookup and diagnostics. It does not authorize a tenant, schedule work, or create a
global registry. Catalog checks conflict and membership rules; an application still decides who may use a definition.

## Copy and update ordinary data

Record's JSON functions accept finite JSON values. A diff records additions, replacements, and removals explicitly, so
deleting a property cannot be confused with assigning an undefined value. The patch owns its returned data and leaves
both inputs unchanged.

Save this complete variation as `update-settings.ts` and run `mise exec -- deno run update-settings.ts` after the same checkout setup.

```ts runnable=update-settings.ts
import { record } from '@okikio/collection';

const budget = { maximumNodes: 1000, maximumStringCodeUnits: 10_000 };
const before = record.json.copy({ title: 'Draft', tags: ['review'] }, budget);
const after = { title: 'Published', tags: [] };
const changes = record.change.diff(before, after, budget);
const updated = record.change.patch(before, changes, budget);
console.log(JSON.stringify(updated));
console.log(record.change.equal(updated, after));
```

```text output
{"title":"Published","tags":[]}
true
```

JSON copies use fresh arrays and null-prototype records. Keys such as `constructor` and `__proto__` stay own data
fields; patches never follow inherited properties. Cycles, sparse arrays, ordinary getters, classes, Maps, Sets,
undefined, and non-finite numbers do not have this JSON data contract and reject. Validate the patched result with an
application schema if a more specific result type is needed.

## Imports that fit the job

| Import                             | Independent value                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `@okikio/collection/iterable` | Yield chunks lazily or collect a bounded index with explicit duplicate policy. |
| `@okikio/collection`               | `catalog` and `record` families, plus direct Catalog operations                               |
| `@okikio/collection/catalog`       | Create, select, compose, inspect, and resolve exact definitions                               |
| `@okikio/collection/record`        | Inspect authored records, pick exact keys, snapshot outer values; exposes `json` and `change` |
| `@okikio/collection/record/json`   | Validate and copy finite JSON with depth, node, and aggregate text budgets                    |
| `@okikio/collection/record/change` | Compare, diff, and patch the same JSON model                                                  |

Catalog materializes finite authored definitions for repeated lookup. It is not a live event collection. Record
validates containers, while Schema owns the meanings of their fields. Input can collect a user's request; Record can
prepare a bounded data copy; Schema can validate that request before an application accepts it.

Read the [Catalog guide](./catalog/README.md), [Record guide](./record/README.md), [JSON contract](./record/json.md),
and [change contract](./record/change.md).

## Choose identity-preserving catalogs or copied data

A permission catalog must preserve exact declaration objects. An editable JSON settings document instead needs detached
copies and explicit additions or removals.

Choose Catalog for identity-bearing definitions and Record for data. Add Schema to validate field meaning; use Record
change operations when a whole-document replacement is insufficient.

Selecting a catalog is not authorization. JSON patching does not persist or validate a business document; the
application owns those decisions.

## Choose an entry point

Use the table to find a focused import for the job you need. Contract links open the exact public source, including its
options and types.

| Import                             | Use it to                                                                              | Exact contract                 |
| ---------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------ |
| `@okikio/collection/iterable` | Chunk values lazily or collect bounded groups and indexes. | [Contract](./iterable.ts) |
| `@okikio/collection/catalog`       | Select and resolve canonical definitions while preserving exact object identity.       | [Contract](./catalog/mod.ts)   |
| `@okikio/collection/catalog/types` | Import public types for this capability; this entry does not start work.               | [Contract](./catalog/types.ts) |
| `@okikio/collection/record`        | Inspect own data fields and transform plain records without invoking ordinary getters. | [Contract](./record/mod.ts)    |
| `@okikio/collection/record/types`  | Import public types for this capability; this entry does not start work.               | [Contract](./record/types.ts)  |
| `@okikio/collection/record/json`   | Copy finite JSON data under explicit depth, node, and text budgets.                    | [Contract](./record/json.ts)   |
| `@okikio/collection/record/change` | Compare, diff, and patch JSON values with explicit removals.                           | [Contract](./record/change.ts) |
| `@okikio/collection`               | Use the package entry shown in the complete examples above.                            | [Contract](./mod.ts)           |

## Transform owned data and write deterministic JSON

`record.omit`, `record.map` and `record.filter` preserve the own-data safety contract and return frozen null-prototype
records. All input descriptors are checked before a callback runs. Callback values remain `unknown` because structural
TypeScript types can hide runtime keys. Callback defects propagate.

`record.fromEntries(source, { maximumItems, duplicates })` requires finite entry admission and `first`, `last` or
`reject` collision policy. Duplicates count toward the input cap; early failure closes the iterator. Values are
borrowed. Prototype-shaped names remain ordinary own data.

`json.stringify(value, { maximumBytes })` validates finite JSON, sorts record keys by UTF-16 lexical order, preserves
array order and uses native JSON primitive rendering. It is a local deterministic profile, not RFC 8785 canonical JSON.
The byte cap includes UTF-8 and escaping; the existing copy depth/node/aggregate-text limits also apply.

`change.invert(base, changes)` returns a value inverse. `change.compose(base, first, second)` validates both sequential
patches and returns a patch from the original base to the final value. Both require the exact base; neither promises to
preserve the submitted operation list or alias identity.

## Choose lazy iteration or bounded collection

`@okikio/collection/iterable` yields chunks without exhausting the source:

Save this complete variation as `example-3.ts` and run `mise exec -- deno run example-3.ts` after the same checkout setup.

```ts runnable
import { chunk, index } from '@okikio/collection/iterable';

// Lazy chunking reads only the next group needed by this loop.
for (const values of chunk([1, 2, 3], 2)) {
	console.log(JSON.stringify(values));
}
const rows = [{ id: 'a', value: 1 }, { id: 'a', value: 2 }];

// Indexing instead collects a Map, so both input and retained-key limits are required.
const selected = index(rows, (row) => row.id, {
	maximumItems: 2,
	maximumKeys: 1,
	duplicates: 'last',
});
console.log(selected.get('a')?.value);
```

```text output
[1,2]
[3]
2
```

The two limits protect different things. `maximumKeys: 1` bounds the retained index in this example.
`maximumItems: 2` also bounds how much source work may be scanned: a million duplicate rows still take work even
though they need only one retained key. The duplicate policy is explicit because keeping the first value, keeping
the last value and rejecting the source produce different application results. No policy is universally correct.

`chunk()` and `unique()` are single-pass lazy iterators. Early exit and callback failure close the source. `group()` and
`index()` deliberately collect a bounded input into a caller-owned Map. Chunk and group arrays are frozen; their values
and keys are borrowed. `unique`, `group` and `index` require both `maximumItems` (all scanned items, including
duplicates) and `maximumKeys` (distinct SameValueZero keys). Exceeding a bound throws; no partial collected Map is
returned. Indexing requires `first`, `last` or `reject` for duplicates; replacement preserves the key's first insertion
position. See the [contract](./iterable.ts) and [benchmark baselines](./iterable.bench.ts), which identify native Set's
weaker unbounded collection semantics.

## Measure record growth and copying

The focused benchmarks measure 10–100,000 own keys; mapping and bounded sorted JSON and catalog lookup among 10–100,000
definitions. The benchmark compares against native trusted mutable records. Native references omit hostile-input checks
and immutable output.

The record workload uses named Mitata key-count parameters. Its untimed oracle checks every mapped key/value pair,
the frozen null-prototype result, and decoded JSON values and key order. Corpus creation is outside timing; mapping,
sorting and serialization stay inside their respective operations. Native mapping remains a cost reference with fewer
guarantees, rather than an equivalent replacement.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
deno task --cwd=packages/collection test
deno task --cwd=packages/collection bench:check
deno task --cwd=packages/collection bench
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.
