# Compare and patch JSON data

Suppose an editor changes a draft and another component needs to apply those edits. `diff(before, after)` describes
which values were added, replaced or removed. `patch(base, changes)` applies that description to a new copy, leaving the
original unchanged. A **path** names the changed location, such as `['items', 0]` for the first array element.

These are data operations, not a synchronization protocol. They do not detect that another editor changed the saved base
in the meantime. Your storage layer must check a version before accepting a patch. Use `equal(left, right)` when only
comparison is needed; it validates both values without building a change list.

Follow the [checkout setup](../../../README.md#work-on-the-repository). Save the example as `patch-json.ts` at the
repository root and run `mise exec -- deno run patch-json.ts`. The last line shows that the original draft still
has two items after the patch.

```ts runnable=patch-json.ts
import { diff, equal, patch } from '@okikio/collection/record/change';

const before = { items: ['draft', 'review'], obsolete: true };
const after = { items: ['published'] };
const changes = diff(before, after);
// Apply the changes to a new value; the final length check shows that the original remains unchanged.
const updated = patch(before, changes);
console.log(JSON.stringify(updated));
console.log(equal(updated, after));
console.log(before.items.length);
```

```text output
{"items":["published"]}
true
2
```

A change contains `type`, `path`, and, for an addition or replacement, `value`. A path is an array of string object keys
and numeric array indexes. String `'0'` is not array index `0`. A root replacement has an empty path. Removing the root
rejects because absence is not a JSON value.

| Operation                      | Required state                                                         |
| ------------------------------ | ---------------------------------------------------------------------- |
| Add record field               | Field must be absent from that record.                                 |
| Replace or remove record field | Field must be an own field of that record.                             |
| Add array value                | Index may address an existing position or the end; later values shift. |
| Replace or remove array value  | Index must exist. Removal shifts later values.                         |
| Traverse a parent path         | Every parent must already exist as own data.                           |

Diff removes array indexes in descending order to preserve the meaning of subsequent indexes. Inserted values are
copied. Neither input nor the authored changes are mutated. Prototype-shaped record names are supported because
traversal operates only on copied null-prototype records and own fields. A missing `__proto__` or `constructor` path
cannot reach `Object.prototype`.

Options reuse the [JSON depth, node, and text budgets](./json.md). Each input, inserted value, and final result must fit
those budgets. `maximumChanges` additionally bounds the produced or accepted operation count, defaulting to 100,000.
Equality does not use that change count. These operations materialize copies and a diff list; they are intended for
bounded documents, not unbounded streams.

The result of patch is the shared JSON `Value` type. It is deliberately not typed as the original object, since a patch
can replace the entire root with a different JSON value. Parse the result through your own schema when the application
needs a specific type. [change.ts](./change.ts) documents exact source contracts.
