# Convert between stored representations and application values

JSON can store a timestamp string, but your JavaScript code may need a `Date` to compare times. A **codec** supplies two
checked conversions: decode an external representation into an application value, and encode the application value
back to that representation. A timestamp codec converts a string; an object codec converts a record containing fields.
Parsing or writing JSON text is a separate step. “Wire” means the representation sent to another component, whether through HTTP or a saved JSON record.

```text
saved timestamp string -- decode --> Date used by application code
saved timestamp string <-- encode -- Date used by application code
```

Read each arrow as one explicit conversion, not an automatic inverse. For example, formatting a Date does not tell the
library which timestamp spellings your application accepts. The [package example](../../packages/schema/codec/README.md)
shows the smallest conversion; this guide keeps those directions when the record has several fields.

## Choose a saved representation separately from the application value

`@okikio/schema` supplies the common Standard Schema validation operations. `@okikio/schema/codec` adds bidirectional
composition on top of those operations.

Use `schema` when a value only needs validation or normalization. Use `codec` when callers must also convert the
validated value back to a different external form.

The codec utility does not own transport, persistence, HTTP, or provider behavior.

These are three different values, even when a console makes them look similar:

| Stage | Example | What the next operation can do |
| --- | --- | --- |
| Saved field | `'2026-01-01T00:00:00.000Z'` | Decode the string with the timestamp codec. |
| Application field | A `Date` object | Call methods such as `getUTCFullYear()`. |
| JSON text | `'{"createdAt":"2026-01-01T00:00:00.000Z"}'` | Parse the text into a record, then decode its fields. |

`JSON.parse()` alone does not create a Date. Conversely, the codec returns a checked record, not a file or HTTP response.

## Convert a complete stored user record

Object, optional, nullable and array codecs apply the same two directions to larger values. A missing optional field
stays `undefined`; an explicitly nullable field can stay `null`. This stored user has a creation date, no deletion date
and one visit.

```ts runnable=stored-user.ts
import { array, decode, encode, nullable, object, optional } from '@okikio/schema/codec';
import { DateSchema as InstantCodec } from '@okikio/schema/time';

// Declare how each saved field becomes an application value.
const UserCodec = object({
	createdAt: InstantCodec,
	deletedAt: optional(nullable(InstantCodec)),
	visits: array(InstantCodec),
});

// Decode before application code calls Date methods.
const user = await decode(UserCodec, {
	createdAt: '2026-01-01T00:00:00.000Z',
	deletedAt: null,
	visits: ['2026-01-02T00:00:00.000Z'],
});

console.log(user.createdAt.getUTCFullYear(), user.deletedAt);
// Encode the fields first; JSON then turns the saved record into text.
console.log(JSON.stringify(await encode(UserCodec, user)));
```

```text output
2026 null
{"createdAt":"2026-01-01T00:00:00.000Z","deletedAt":null,"visits":["2026-01-02T00:00:00.000Z"]}
```

Invalid nested input reports its property/index path, such as `['visits', 0]`. The utility creates converted containers
without mutating the external input. The generated outer objects are frozen; nested `Date` values retain normal Date
behavior and ownership.

## Save, reload and diagnose the same user

The complete variation below uses a plain record as its saved representation. Encoding produces a record with timestamp strings. `JSON.stringify()` writes that record as text;
`JSON.parse()` reads the text, and decoding converts the fields back into Dates. The final input has a bad first visit, so the issue points to `visits` and index `0`. A real storage adapter must still own persistence, concurrency and byte limits.

Save this complete variation as `reload-user.ts` and run `mise exec -- deno run reload-user.ts` after the same checkout setup.

```ts runnable=reload-user.ts
import * as codec from '@okikio/schema/codec';
import * as schema from '@okikio/schema';
import { DateSchema } from '@okikio/schema/time';

// The same field contract is used when reopening the saved record.
const UserCodec = codec.object({
	createdAt: DateSchema,
	deletedAt: codec.optional(codec.nullable(DateSchema)),
	visits: codec.array(DateSchema),
});
const user = await codec.decode(UserCodec, {
	createdAt: '2026-01-01T00:00:00.000Z',
	deletedAt: null,
	visits: ['2026-01-02T00:00:00.000Z'],
});

const saved = await codec.encode(UserCodec, user);
// JSON owns text serialization; the codec owns checked field conversions.
const text = JSON.stringify(saved);
const loaded: unknown = JSON.parse(text);
const reopened = await codec.decode(UserCodec, loaded);
console.log(reopened.visits[0]?.getUTCDate());

// Invalid saved data names the field that needs correction.
try {
	await codec.decode(UserCodec, { ...saved, visits: ['yesterday'] });
} catch (error) {
	if (!(error instanceof schema.SchemaValidationError)) throw error;
	console.log(JSON.stringify(error.issues[0]?.path));
}
```

```text output
2
["visits",0]
```

Correct the saved visit or report it to the person who supplied the record. Do not substitute today's date silently: that would change the meaning of the imported visit. The in-memory record is a runnable conversion demonstration, not a durability or restart test. For saved values that must outlive an owner, continue with [stored state](../context/03-stored-state.md). The [composition guide](../03-composition.md) then places validation in a larger import.

## Convenience and the manual equivalent

| Convenience                                   | Manual equivalent                                                                                                                    | Concrete value                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `codec.object()`                              | validate every property with its decode schema, prefix issue paths, build the application object, then reverse the process on encode | one bidirectional object contract                       |
| `codec.optional()` / `nullable()` / `array()` | branch around the inner codec and repeat decode/encode validation for each container case                                            | composable wrappers without duplicating schema plumbing |

`@okikio/schema/codec` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics by calling a
Standard Schema validator before and after your own encode/decode functions.

The utility packages those two directions into one immutable contract and keeps validation behavior consistent.

## Validation helper

`assert()` is the strict runtime guard for a codec definition. Use it when accepting a definition from untyped JavaScript before storing or
composing a caller-supplied codec. Ordinary typed application code normally calls `decode()` or `encode()` directly.

## Source guide

The paths below are relative to the [package directory](../../packages/schema/codec).

Start with the package README linked above, then use the source in this order when you need more detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*.test.ts` files show edge cases, cancellation, invalid input, and lifecycle behavior as executable examples.
4. Read internal implementation files only when you need the exact state transition or performance-sensitive loop.

The [public source](../../packages/schema/codec/mod.ts) lists every public function and type. These examples teach the
common paths and the design decisions behind those contracts.
