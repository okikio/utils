# Copy finite JSON data

Passing an object to another function passes a reference to the same object. If the caller later changes a nested
array, the recipient sees that change too. Use `copy(value, options)` when the recipient needs a separate data snapshot.
Unlike a spread such as `{ ...value }`, it also copies accepted nested containers. It rejects ordinary getters rather
than invoking code while inspecting them.
The result contains only null, booleans, finite numbers, strings, arrays without gaps, and plain record values. It
uses new objects and arrays. If two input fields refer to the same object, each gets its own copy. Signed zero
becomes zero.

Follow the [checkout setup](../../../README.md#work-on-the-repository). Save the example as `copy-json.ts` at the
repository root and run `mise exec -- deno run copy-json.ts`. The new label goes into the input array, so the printed
copy still contains only `draft`.

```ts runnable=copy-json.ts
import { copy } from '@okikio/collection/record/json';

const input = { labels: ['draft'] };
// Copy within explicit traversal bounds so later mutations of input cannot change this owned value.
const owned = copy(input, { maximumNodes: 100, maximumStringCodeUnits: 1000 });
input.labels.push('changed');
console.log(JSON.stringify(owned));
```

```text output
{"labels":["draft"]}
```

| Option                   | Counted representation                                              | Default    |
| ------------------------ | ------------------------------------------------------------------- | ---------- |
| `maximumDepth`           | Object/array nesting; a primitive root has depth zero               | 128        |
| `maximumNodes`           | Every primitive or container occurrence, including repeated aliases | 1,000,000  |
| `maximumStringCodeUnits` | UTF-16 code units across all record keys and string values          | 16,777,216 |

These budgets describe the expanded copied representation. A supplementary Unicode character occupies two UTF-16 code
units. The text budget is not a UTF-8 byte budget; transport owners must enforce their own byte limits before decoding.

Ordinary and null-prototype records are accepted, including ordinary records from another realm. Copied records have
null prototypes, so own `__proto__`, `constructor`, and `prototype` keys remain data. Arrays must be dense and have no
extra properties. Accessors, symbols, class instances, non-finite numbers, undefined, functions, cycles, Maps, and Sets
reject with `TypeError`. Exceeded budgets reject with `RangeError`; malformed budget options reject with `TypeError`.

Inspection uses property descriptors, so ordinary getters do not run. A Proxy can still run traps during inspection;
this operation is a data validator, not a JavaScript sandbox. It does not parse bytes or strings as JSON and does not
validate business fields. Use Schema for required fields, ranges, and application meaning.

The same `Options` type is used by [changes](./change.md) and Schema's JSON reader. Source field contracts are in
[json.ts](./json.ts).
