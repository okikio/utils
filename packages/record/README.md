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

For shared terms such as `await` and `await using`, see
[the short glossary](../../docs/learn.md#read-the-small-amount-of-code-you-need).

For the exact functions, types and field explanations, read the [generated contract reference](API.md).

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

## Build on the example

- Check authored field maps before composing [Environment](../env/README.md) or [Codec](../codec/README.md) definitions.
  This package protects the map's shape; those packages validate or convert the values they own.
- Use [Schema](../schema/README.md) for external payload meaning. Do not substitute a record-shape check for validation
  of a request's required fields, ranges or nested structures.

Validate authored options before snapshotting them, then use typed keys and entries to retain exact key/value
relationships. Use the ordinary Web or JavaScript API when data is already trusted and the stronger record contract adds
no value. Record inspection does not recursively validate application values or make external objects immutable.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

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

## Purpose

`@okikio/record` defines the small JavaScript object shape used when a utility needs an ordinary string-keyed data map
whose runtime enumeration must agree with its TypeScript record type.

## Start here

```ts
import * as record from '@okikio/record';

const input = { host: 'localhost', port: 4321 } as const;
record.assert(input, 'server options');

record.keys(input); // ('host' | 'port')[]
record.entries(input); // exact key/value pairs
```

## Why this exists

`Object.keys()` and `Object.entries()` ignore inherited and non-enumerable properties. Accessor properties can also
execute code when a later operation reads them. A generic API that accepts an arbitrary object and then snapshots it
with enumeration can therefore let TypeScript promise fields that runtime drops.

The accepted shape is deliberately small:

- a normal object literal or a null-prototype object;
- own string keys only;
- every property enumerable;
- every property a data property, not a getter/setter.

`record.is()` checks that shape. `record.assert()` rejects anything else.

## Immutable snapshots

```ts
const source = Object.create(null);
source.__proto__ = 'ordinary-data';

const snapshot = record.snapshot(source);
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
