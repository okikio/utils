# `@okikio/record`

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

The [full API reference](API.md) shows exact key/value inference and rejection contracts.

## Run a complete example

```ts runnable
import * as record from '@okikio/record';
const options = { host: 'localhost', port: 4321 } as const;
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

| Call                             | Contract                                                           | Boundary                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `is(value)`                      | Unknown value → boolean, with TypeScript narrowing                 | Accepts plain or null-prototype objects with only own enumerable string-keyed data properties.                 |
| `assert(value, name?)`           | Returns nothing on success; throws `TypeError` on a rejected shape | Does not check nested values or field meanings.                                                                |
| `keys(value)` / `entries(value)` | Readonly keys / readonly typed key-value pairs                     | Validates first, then freezes the returned containers. Key/value relationships remain available to TypeScript. |
| `snapshot(value)`                | Accepted object → frozen null-prototype outer copy                 | Nested values are borrowed, not cloned or deep-frozen.                                                         |

Under the hood, the check first rejects arrays and unusual prototypes. It then checks for symbol keys and examines own
property descriptors. A descriptor says whether a field stores data or runs a getter, without reading the field value.
Only enumerable data properties pass. Snapshotting copies those accepted values into a fresh outer object.

This stricter design prevents a typed field map from silently losing invisible fields during enumeration. It also
rejects getters before they are read. It is a contract for authored data, not a sandbox: a Proxy can run traps during
inspection. For trusted objects that need no such check, `Object.keys()` remains a useful ordinary choice.

## Build on the example

- Check authored field maps before composing [Environment](../env/README.md) or [Codec](../codec/README.md) definitions.
  This package protects the map's shape; those packages validate or convert the values they own.
- Use [Schema](../schema/README.md) for external payload meaning. Do not substitute a record-shape check for validation
  of a request's required fields, ranges or nested structures.

## Try checking structure before checking meaning

An import-safe options map can still contain an invalid value. This mini-demo uses Record for its outer shape and Schema
for the port's meaning, so each check answers a distinct question.

```ts runnable=checked-options.ts
import * as record from '@okikio/record';
import * as schema from '@okikio/schema';
import { z } from 'zod';

const options = record.snapshot({ host: 'localhost', port: '4321' });
const PortSchema = z.coerce.number().int().min(1).max(65535);
const port = await schema.parse(PortSchema, options.port);
console.log(`${options.host}:${port}`);
const accessor = Object.defineProperty({}, 'port', {
	enumerable: true,
	get() {
		throw new Error('Must not run.');
	},
});
console.log(record.is(accessor));
```

Expected output:

```text output
localhost:4321
false
```

The snapshot keeps the supplied plain fields; the schema converts the port text to a valid number. The last check
rejects the getter-backed shape without running its getter. Change the plain port to `'70000'` to fail the value check
instead. Snapshotting is shallow: nested objects would still need their own ownership and validation rules.

## Immutable snapshots

```ts
import { snapshot } from '@okikio/record';

const source = { ['__proto__']: 'ordinary-data', host: 'localhost' };
const options = snapshot(source);
console.log(options.__proto__); // ordinary-data
console.log(Object.getPrototypeOf(options) === null); // true
```

`snapshot()` validates first, then copies every own enumerable string data property into a frozen null-prototype object.
Keys such as `__proto__` therefore remain ordinary data.

## Convenience and the manual equivalent

| Convenience         | Manual equivalent                                                                        | Concrete value                                                     |
| ------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `record.assert()`   | inspect prototype, symbols, and every property descriptor before enumeration             | prove `Object.keys()`/`entries()` sees the complete data shape     |
| `record.snapshot()` | validate, copy own enumerable data properties to a null-prototype object, then freeze it | an immutable record whose runtime keys match its TypeScript record |

The manual implementation uses `Object.getPrototypeOf()`, `Object.getOwnPropertySymbols()`, and
`Object.getOwnPropertyDescriptors()` to prove that enumeration sees the complete data shape. Exact `keys()`/`entries()`
need one narrow TypeScript assertion after that runtime proof because the standard library intentionally widens object
enumeration to `string`/`unknown`.

Use this utility when **record shape itself is part of the contract**. Do not use it as a generic validator for
arbitrary JSON objects, class instances, HTTP payloads, or fault diagnostics.

## Source guide

1. `mod.ts` contains the complete runtime rules and snapshot operation.
2. `types.ts` contains the exact entry type.
3. `mod.test.ts` covers prototype, accessor, symbol, hidden-property, and `__proto__` behavior.
4. `types.test.ts` locks exact key/value inference.
