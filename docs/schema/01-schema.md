# Check input before application code uses it

An incoming profile can be a perfectly valid JavaScript object and still contain an impossible age. A **schema** checks
its actual fields at runtime. TypeScript types help the author before execution; schema validation protects the running
operation from values it cannot use.

Run the profile below first. Use the [package examples](../../packages/schema/README.md) when choosing native builders or
an existing validator. Continue with the [codec guide](02-codec.md) when a saved timestamp string must become a Date and
be converted back again.

## Validate a value through one contract

Start with built-in rules such as `string()`, `number()`, and `object()`. They are enough to check the profile below.
If your project already uses a validator such as Zod or Valibot, you can reuse a schema that supports Standard Schema.
That shared interface lets different libraries ask the same question: does this value pass, and what checked value or
issues should I get back?

## Check a submitted profile before saving

After `mise trust`, `mise install`, and `mise run prepare -- --kind deps` in this checkout, save the following as `profile.ts` at the root and run `mise exec -- deno run profile.ts`. The record is local input, so the example needs no network or environment permission.

```ts runnable=profile.ts
import * as schema from '@okikio/schema';

const ProfileSchema = schema.object({
	name: schema.string({ minLength: 1 }),
	age: schema.number({ integer: true, minimum: 0 }),
});
// parse() returns checked data or throws, which suits a path that cannot proceed with invalid input.
const profile = await schema.parse(ProfileSchema, { name: 'Ada', age: 36 });
console.log(profile.name, profile.age);
// validate() instead returns issues, so a form can ask the user to correct the input.
const rejected = await schema.validate(ProfileSchema, { name: 'Ada', age: -1 });
console.log(rejected.issues === undefined ? 'accepted' : 'Correct the age before saving');
```

```text output
Ada 36
Correct the age before saving
```

The incoming value may come from a form or `response.json()`; its contents are not trustworthy just because JavaScript produced an object. A schema is the executable rule for the values your application accepts. Here a name cannot be empty and an age must be a nonnegative integer. `parse` returns the checked object or rejects its Promise. `validate` returns either `value` or `issues`, so expected bad input can be shown to a user without catching exceptions. `await` waits for that result before saving anything. Neither function writes to storage.

Keep the failure branch before your write. Validation cannot undo a write performed earlier. Native builders provide a synchronous `.parse()` when appropriate; the shared asynchronous functions also accept third-party validators. The later interoperability reference matters only when you already have such a validator.

## Keep the schema faithful to its source

A validator proves only the contract it actually validates. Do not use a narrow schema to hide a broader external or
durable source.

Suppose a database column is unconstrained text but the application currently recognizes three states. The storage
adapter should first expose `string`:

Save this complete variation as `known-status.ts` and run `mise exec -- deno run known-status.ts` after the same checkout setup.

```ts runnable=known-status.ts
import * as schema from '@okikio/schema';

const row: { status: unknown } = { status: 'paused' };
const PersistedStatusSchema = schema.string();

const KnownStatusSchema = schema.oneOf([
	'queued',
	'running',
	'completed',
]);

const persisted = await schema.parse(PersistedStatusSchema, row.status);
const known = await schema.validate(KnownStatusSchema, persisted);
console.log(known.issues === undefined ? known.value : `Unrecognized status: ${persisted}`);
```

```text output
Unrecognized status: paused
```

The second validation is an application classification step. It must not be confused with a guarantee made by the
database.

If the store or provider really accepts only those names, keep that exact type in your adapter. Changing it
back to `string` would let callers supply other names.

## Choose a validator that matches the value

`schema.validate()` awaits the provider's sync or async result. It preserves the returned value and issue details in an
immutable wrapper, copying the issue list without rewriting its paths or vendor fields. Successful values remain
borrowed.

`schema.parse()` returns the typed output or throws `SchemaValidationError` with the original structured issues.

`schema.prefixIssues()` creates new issue objects with a parent path. It does not mutate provider-owned issue objects.

The package owns no business schema and performs no I/O.

## Add structure and constraints as the value grows

Read [complete compositions](../03-composition.md) for a bounded CSV import, allowed-page discovery and a
resource-backed operation. Each example names its result and owner. Use [the outcome guide](../07-outcomes.md) to choose
additional mechanisms when the application needs them.

## Convenience and the manual equivalent

| Convenience         | Manual equivalent                                                                                        | Concrete value                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `schema.validate()` | call `schema['~standard'].validate()`, await either result form, and preserve its value or issue details | one Standard Schema validation path            |
| `schema.parse()`    | call validate, throw a consistent `SchemaValidationError`, and preserve exact output inference manually  | throwing parse without schema-library coupling |
| `prefixIssues()`    | copy every issue and prepend a path segment while preserving existing paths                              | composed validators retain precise locations   |

`@okikio/schema` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics by calling
`schema["~standard"].validate(value)` and inspecting its issues.

The utility awaits both validation result forms and supplies typed throwing behavior while preserving provider issues.
Only an explicit `prefixIssues()` call adds a parent location.

## Source guide

The paths below are relative to the [package directory](../../packages/schema).

| Source                                                              | Responsibility                                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `mod.ts` and `types.ts`                                             | Public exports, Standard capabilities and inferred input/output types                                |
| `author.ts`                                                         | Native composition, object key policies, omission metadata and directional JSON projection           |
| `validation.ts`                                                     | Custom sync/async readers, protocol detection, option forwarding and issue-preserving parse behavior |
| `codec/`                                                            | Explicit decoding/encoding contracts and independent object-direction policies                       |
| `time.ts`                                                           | Narrow UTC wire spelling, Temporal calendar validation and Date compatibility                        |
| `projection.test.ts`, `interop.test.ts` and `query-interop.test.ts` | Consumer checks using Ajv, both TypeBox packages, Query and HTTP documentation                       |

The [public source](../../packages/schema/mod.ts) lists every public function and type. These examples teach the common
paths and the design decisions behind those contracts.

## Standard JSON Schema

Standard Schema validation and Standard JSON Schema representation are related but separate contracts built on the
shared Standard Typed identity. A conforming value can expose either capability or both under `~standard`:

| Operation                                 | Caller goal                                                         |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `~standard.validate(input, options?)`     | Check data and return the validated or transformed value, or issues |
| `~standard.jsonSchema.input({ target })`  | Describe the input's JSON structure when supported                  |
| `~standard.jsonSchema.output({ target })` | Describe the output's JSON structure when supported                 |

`schema.jsonSchema()` accepts a converter without requiring validation. `schema.is()` and `schema.parse()` require
validation and do not accept a converter alone. `Input` and `Output` can infer types from either Standard Typed
capability. Native `JsonReader` types retain the converter; custom `define()` and `defineAsync()` readers do not invent
one. See the [Standard JSON Schema specification](https://standardschema.dev/json-schema) for the full independent
contract, including target negotiation and vendor options.

Do not assume that the two JSON Schemas are identical. Coercions, defaults, codecs, and transforms can make accepted
input different from validated output.

The native converter supports JSON Schema draft 07 and 2020-12. If it cannot describe a check, or you ask for
an unsupported version, conversion throws. The original validator still works.

For a transform, the input description shows what can reach the callback. The callback can still reject that
input, and the converter cannot infer what it returns. Conversion does not call your factories or callbacks.
JSON Schema also cannot describe property attributes, who may change an object, or limits on work at run time.

The [package guide](../../packages/schema/README.md) provides complete runnable adapters for Ajv, asynchronous Ajv,
current `typebox` and legacy `@sinclair/typebox`, plus a direction-by-direction support table. Those engines are
optional consumer choices. External JSON Schema stays owned by its declared dialect and engine; adapting it does not
reconstruct an owned authoring graph or preserve serialized JavaScript transform functions.

`@okikio/schema` does not require Zod to obtain this representation. Current Zod releases expose Standard JSON Schema
through the standard protocol. A provider-specific adapter is only useful when the common protocol omits behavior or
metadata that the caller actually needs.

## Native authoring

Start with `string()`, `number()`, `object()`, `array()`, and the other native builders. They preserve their accepted
input and validated output types. `refine()` adds a predicate; `transform()` changes a validated value. Use an explicit
codec when that change needs a reverse conversion.

For a custom validator, `schema.define(read)` exposes a synchronous reader through Standard Schema. The callback returns
the checked value and calls `schema.reject(message, path?)` for expected invalid input. An accidental TypeError or
another unexpected exception propagates instead of becoming a validation issue. Use `defineAsync()` when validation
awaits work. Both readers expose `parse(value)`, with a Promise only for the asynchronous reader.

Import `DateSchema` and `DateType` from `@okikio/schema/time` for UTC ISO Z timestamps decoded to Date and encoded at
millisecond precision. The selected local Temporal implementation validates calendar dates; a narrow lexical guard
retains the four-digit UTC grammar and rejects offsets, annotations and leap seconds. Finer input precision is
truncated. Keep a string or Temporal contract when source precision matters.

## Optional Zod adapter

`@okikio/schema/zod` exports `jsonSchema(schema, io)` so you can describe the input and output separately. For
a schema from another vendor, the function returns `undefined` so you can try a different converter. Install
the Zod peer dependency only to use this adapter. The native builders, `schema/time`, and `schema/codec` do not load it.
