# Record

A settings object may look like plain data, but reading a property can run code through a getter. Record checks
that the object's own fields are plain data before you read or copy them. Schema can then check their values, such
as whether a port number is in range. To copy nested JSON data, use the
[bounded JSON operations](../../packages/collection/record/json.md); for edits, use the
[change operations](../../packages/collection/record/change.md).

## Try checking structure before checking meaning

An object with plain fields can still contain an invalid port. This example copies the fields, checks the port value,
then tries a second object whose getter must never run.

After the [checkout setup](../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`checked-options.ts` at that root, then run `mise exec -- deno run checked-options.ts`.

```ts runnable=checked-options.ts
import * as record from '@okikio/collection/record';
import * as schema from '@okikio/schema';

const options = record.snapshot({ host: 'localhost', port: '4321' });
const PortSchema = schema.coerce.number({ integer: true, minimum: 1, maximum: 65535 });
const port = await schema.parse(PortSchema, options.port);
console.log(`${options.host}:${port}`);
// A getter can run code. A plain-data check must reject this object without invoking that getter.
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
import { snapshot } from '@okikio/collection/record';

const source = { ['__proto__']: 'ordinary-data', host: 'localhost' };
const options = snapshot(source);
console.log(options.__proto__); // ordinary-data
console.log(Object.getPrototypeOf(options) === null); // true
```

`snapshot()` validates first, then copies every own enumerable string data property into a frozen null-prototype object.
Keys such as `__proto__` therefore remain ordinary data.

## Convenience and the manual equivalent

| Convenience         | Manual equivalent                                                                        | Concrete value                                                 |
| ------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `record.assert()`   | inspect prototype, symbols, and every property descriptor before enumeration             | prove `Object.keys()`/`entries()` sees the complete data shape |
| `record.snapshot()` | validate, copy own enumerable data properties to a null-prototype object, then freeze it | an owned snapshot of validated, enumerable data properties     |

The manual implementation uses `Object.getPrototypeOf()`, `Object.getOwnPropertySymbols()`, and
`Object.getOwnPropertyDescriptors()` to validate the object's data properties. `keys()` and `entries()` still return
runtime string keys and unknown values: structural TypeScript types can omit properties that exist at runtime. Use
`pick()` when a consumer needs an explicitly selected set of statically known fields.

Use the outer shape helpers when **record shape itself is part of the contract**. They do not validate nested values or
application rules. `record.json` validates bounded JSON data, while Schema checks the application-specific meaning of
that data. Class instances and fault diagnostics need their own explicit contracts.

## Source guide

The paths below are relative to the [package directory](../../packages/collection/record).

1. `mod.ts` contains the complete runtime rules and snapshot operation.
2. `types.ts` contains the shared record and entry contracts.
3. `mod.test.ts` covers prototype, accessor, symbol, hidden-property, and `__proto__` behavior.
4. `types.test.ts` checks truthful enumeration types and exact selected fields.
