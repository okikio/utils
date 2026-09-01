`@okikio/record`
===============

Purpose
-------

`@okikio/record` defines the small JavaScript object shape used when a utility
needs an ordinary string-keyed data map whose runtime enumeration must agree
with its TypeScript record type.

Start here
----------

```ts
import * as record from '@okikio/record';

const input = { host: 'localhost', port: 4321 } as const;
record.assert(input, 'server options');

record.keys(input);    // ('host' | 'port')[]
record.entries(input); // exact key/value pairs
```

Why this exists
---------------

`Object.keys()` and `Object.entries()` ignore inherited and non-enumerable
properties. Accessor properties can also execute code when a later operation
reads them. A generic API that accepts an arbitrary object and then snapshots it
with enumeration can therefore let TypeScript promise fields that runtime drops.

The accepted shape is deliberately small:

- a normal object literal or a null-prototype object;
- own string keys only;
- every property enumerable;
- every property a data property, not a getter/setter.

`record.is()` checks that shape. `record.assert()` rejects anything else.

Immutable snapshots
-------------------

```ts
const source = Object.create(null);
source.__proto__ = 'ordinary-data';

const snapshot = record.snapshot(source);
```

`snapshot()` validates first, then copies every own enumerable string data
property into a frozen null-prototype object. Keys such as `__proto__` therefore
remain ordinary data.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `record.assert()` | inspect prototype, symbols, and every property descriptor before enumeration | prove `Object.keys()`/`entries()` sees the complete data shape |
| `record.snapshot()` | validate, copy own enumerable data properties to a null-prototype object, then freeze it | an immutable record whose runtime keys match its TypeScript record |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


The manual implementation uses `Object.getPrototypeOf()`,
`Object.getOwnPropertySymbols()`, and `Object.getOwnPropertyDescriptors()` to
prove that enumeration sees the complete data shape. Exact `keys()`/`entries()`
need one narrow TypeScript assertion after that runtime proof because the
standard library intentionally widens object enumeration to `string`/`unknown`.

Use this utility when **record shape itself is part of the contract**. Do not use
it as a generic validator for arbitrary JSON objects, class instances, HTTP
payloads, or fault diagnostics.

Source guide
------------

1. `mod.ts` contains the complete runtime rules and snapshot operation.
2. `types.ts` contains the exact entry type.
3. `mod_test.ts` covers prototype, accessor, symbol, hidden-property, and
   `__proto__` behavior.
4. `type_test.ts` locks exact key/value inference.
