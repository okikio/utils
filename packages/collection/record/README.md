# `@okikio/collection/record`

An options object looks like a simple list of names and values. But an object can hide inherited fields, invisible
properties, or a getter that runs code when read. `record` checks that the object really is an ordinary visible data map
before a utility lists or snapshots its fields. It checks the container, not the business meaning of each value.

| Container shape                     | `record.assert()` | Why                                                     |
| ----------------------------------- | ----------------- | ------------------------------------------------------- |
| `{ host: 'localhost', port: 4321 }` | Accepted          | Visible own string-keyed data fields.                   |
| An object with a getter for `port`  | Rejected          | Reading a field would execute code.                     |
| A class instance or hidden property | Rejected          | Enumeration would not prove the intended data contract. |

This is a shape decision table. It does not prove that `port` is a valid port number or that nested values are
immutable.

The source [operation contracts](./mod.ts) describe shape checks and key selection. The focused [JSON](./json.md) and
[change](./change.md) guides explain copying and transformation.

A **getter** is code that runs when a property is read. An **own** property belongs to the object itself, rather than
being inherited from its prototype. Record distinguishes these cases before it enumerates fields.

## Inspect a plain record without invoking a getter

Check the server options before enumerating them. The output contains only the plain own fields accepted by Record; the
later shape checks explain why getters and hidden properties require different handling.

After the [checkout setup](../../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`example.ts` at that root, then run `mise exec -- deno run example.ts`.

```ts runnable
import * as record from '@okikio/collection/record';
const options = { host: 'localhost', port: 4321 } as const;
// Check that this is inert record data before enumerating it; accessors and class instances are separate contracts.
record.assert(options, 'server options');
console.log(record.keys(options).join(','));
console.log(record.entries(options).map(([key, value]) => `${key}=${value}`).join(' '));
```

Expected output:

```text output
host,port
host=localhost port=4321
```

The demo checks the options object, then prints its exact keys and key/value pairs. Change `port` to `5000` to change
the second line. Replacing that plain field with a getter makes the shape check fail before `entries()` reads it. Use
`snapshot()` when the consumer also needs a frozen copy of the accepted outer record.

## What the shape check actually inspects

These helpers operate on ordinary JavaScript objects. You do not need to construct a special record class.

| Call                             | Contract                                                           | Meaning                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `is(value)`                      | Unknown value → boolean, with TypeScript narrowing                 | Accepts plain or null-prototype objects with only own enumerable string-keyed data properties.                                                                     |
| `assert(value, name?)`           | Returns nothing on success; throws `TypeError` on a rejected shape | Does not check nested values or field meanings.                                                                                                                    |
| `keys(value)` / `entries(value)` | Readonly string keys / readonly string-and-unknown pairs           | Validates first, then freezes the returned containers. Structural types can hide extra runtime keys, so enumeration does not claim an exhaustive static key union. |
| `snapshot(value)`                | Accepted object → frozen null-prototype outer copy                 | Nested values are borrowed, not cloned or deep-frozen.                                                                                                             |

Under the hood, the check first rejects arrays and unusual prototypes. It then checks for symbol keys and examines own
property descriptors. A descriptor says whether a field stores data or runs a getter, without reading the field value.
Only enumerable data properties pass. Snapshotting copies those accepted values into a fresh outer object.

Ordinary records can come from another JavaScript realm, such as a same-origin iframe. The common local-object and
null-prototype paths use a direct prototype comparison. A foreign ordinary prototype is recognized through its native
Object constructor and their own data descriptors; constructor accessors, custom prototypes and class instances remain
rejected. The foreign intrinsic must retain its normal constructor/prototype relationship. An own data field named
`constructor` is still ordinary record data. The [real browser fixture](../fixtures/browser.ts) checks foreign records,
nested JSON, retained own fields and those rejection cases.

This stricter design prevents a typed field map from silently losing invisible fields during enumeration. It also
rejects getters before they are read. It is a contract for authored data, not a sandbox: a Proxy can run traps during
inspection. For trusted objects that need no such check, `Object.keys()` remains a useful ordinary choice.

## Validate field meaning after checking the record

- Check authored field maps before composing [Environment](../../env/README.md) or [Codec](../../schema/codec/README.md)
  definitions. This package protects the map's shape; those packages validate or convert the values they own.
- Use [Schema](../../schema/README.md) for external payload meaning. Do not substitute a record-shape check for
  validation of a request's required fields, ranges or nested structures.

## Exact selection and copied JSON

Use `pick(record, ['port'])` when explicit keys should preserve exact field types. Enumeration returns broad keys and
unknown values because an object typed as `{ port: number }` can still carry other runtime fields. `snapshot()` returns
`Readonly<T>` and freezes its fresh outer record; nested values remain borrowed.

`record/json` owns the finite JSON data model. `copy(value, { maximumDepth, maximumNodes })` returns independent arrays
and null-prototype records, including when the input contains ordinary records or arrays from another realm. It rejects
undefined, non-finite numbers, classes, cycles, symbols, sparse arrays and ordinary getters. Aliases are copied by
value, and prototype-shaped keys remain ordinary data. Proxies can still execute inspection traps; these functions are
data validators, not JavaScript execution sandboxes.

`record/change` provides `diff`, `patch` and `equal` for this same JSON model. Traversal reads only copied own fields,
including prototype-shaped data keys. Changes explicitly add, replace or remove properties and array indexes. Root
replacement is supported, root removal rejects, and array paths use numeric indexes. `patch(base, diff(base, target))`
reconstructs the target without mutating either input. Inserted values are copied. Map, Set, cycles and sparse arrays
are outside this contract. Patch returns a JSON value; parse it with a schema when a more specific application type is
needed.

Use `record.json` and `record.change` from the Record family, or import their focused subpaths directly. Their APIs and
shared value/budget types are the same in either form.

## Choose adjacent capabilities

Use this for structural inspection and data transformation. Schema validates field meanings, while Catalog preserves
identity-bearing declarations.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.

## Read further

The [numbered guide](https://github.com/okikio/utils/blob/main/docs/packages/15-record.md) explains the model, manual
alternatives, and composition.
