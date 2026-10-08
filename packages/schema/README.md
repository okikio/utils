# `@okikio/schema`

Configuration arrives as text, but your application needs a valid port number. A **schema** describes which values are
acceptable and any conversion the validator should apply. `schema` gives consumers one way to call compatible
validators, so they can use checked values or inspect issues without learning each validator's result format.

| Supplied input      | Rule in the demo                            | Result                                        |
| ------------------- | ------------------------------------------- | --------------------------------------------- |
| Text `'8787'`       | Convert to an integer from 1 through 65,535 | Number `8787`                                 |
| Text `'not-a-port'` | Same rule                                   | Validation issues; `parse()` rejects.         |
| Number `70000`      | Same rule                                   | Validation issues; outside the allowed range. |

The table describes the chosen port schema. Other schemas can accept different values; this package does not decide
business rules or make validation equivalent to authorization.

The [full API reference](API.md) includes validation branches, issue paths and schema inference.

## Run a complete example

```ts runnable
import * as schema from '@okikio/schema';
import { z } from 'zod';
const PortSchema = z.coerce.number().int().min(1).max(65535);
console.log(await schema.parse(PortSchema, '8787'));
```

Expected output:

```text output
8787
```

For this schema, `parse()` returns `Promise<number>` and resolves to `8787`. It rejects with `SchemaValidationError`
when validation reports issues. It performs no I/O and creates no cleanup owner; the caller decides whether to keep that
rejection exceptional or expose an expected branch.

The demo uses Zod to author the rule, then calls the validator through `schema.parse()`. The output is a number, not the
input string. Try the invalid inputs in the table to inspect a `SchemaValidationError`, or use `validate()` when issues
should be returned as an ordinary branch instead of thrown.

## Show a useful form-validation branch

Most forms need a normal “please correct this field” answer. `validate()` returns that branch as data, so you can use
`if` instead of exception handling. Only the validator authoring below uses Zod-specific syntax.

```ts runnable=port-form.ts
import { validate } from '@okikio/schema';
import { z } from 'zod';

const PortSchema = z.coerce.number().int().min(1).max(65535);
for (const text of ['4321', '70000']) {
	const checked = await validate(PortSchema, text);
	if (checked.issues !== undefined) console.log(`Please correct port ${text}.`);
	else console.log(`Start on port ${checked.value}.`);
}
```

```text output
Start on port 4321.
Please correct port 70000.
```

| Call or value                   | Contract                                                    | Boundary                                                                               |
| ------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Schema                          | Object with `'~standard': { version: 1, vendor, validate }` | A Standard Schema V1 validator owns accepted values and transformations.               |
| `validate(schema, input)`       | Unknown input → `Promise<{ value } \| { issues }>`          | Issues are an ordinary branch. A validator that itself throws still rejects.           |
| `parse(schema, input)`          | Unknown input → `Promise<typed output>`                     | Same validation; reported issues become `SchemaValidationError` with an `issues` list. |
| `prefixIssues(issues, ...path)` | Issues + path segments → prefixed issue list                | Keeps nested error locations when larger objects compose validators.                   |

One level deeper: the package checks the Standard Schema protocol, calls the schema's `validate()` function and awaits
its answer. It then freezes a small value or issue wrapper. `parse()` builds on that same call and throws only when
issues were reported. It does not inspect Zod internals or deep-freeze the returned application value.

This protocol-based design lets utilities share validation without forcing the whole application to use one validator
library. Coercion, defaults and field rules stay in the schema, where the field's meaning is known.

## Build on the example

- Validate text cells from [CSV](../csv/README.md) before importing records. CSV proves how cells are framed; a schema
  proves the particular fields and transformations you declared.
- Use [Codec](../codec/README.md) when checked values also need a reverse conversion for storage or an API. Use
  [Result](../result/README.md) when a consumer must choose explicitly between checked output and rejection.

## How it fits

This package prevents each utility from implementing its own schema-library adapter. `failure`, `codec`, `activity`,
`workflow`, `http`, and other packages can accept Standard Schema contracts without requiring Zod or Valibot in their
core APIs.

Use schema-library-specific packages only where their richer authoring metadata is part of the job. For example,
`@okikio/env/zod` can read Zod metadata while the generic environment package still validates through Standard Schema.

## Schema authority

A validator proves only the contract it actually validates. Do not use a narrow schema to hide a broader external or
durable source.

Suppose a database column is unconstrained text but the application currently recognizes three states. The storage
adapter should first expose `string`:

```ts
import { parse } from '@okikio/schema';
import { z } from 'zod';

const row: { status: unknown } = { status: 'paused' };
const PersistedStatusSchema = z.string();

const KnownStatusSchema = z.enum([
	'queued',
	'running',
	'completed',
]);

const persisted = await parse(PersistedStatusSchema, row.status);
const known = KnownStatusSchema.safeParse(persisted);
console.log(known.success ? known.data : `Unrecognized status: ${persisted}`); // Unrecognized status: paused
```

The second validation is an application classification step. It must not be confused with a guarantee made by the
database.

The opposite case is also useful: if the durable schema or provider contract really enforces the finite vocabulary,
retain that exact type through the adapter instead of widening it back to `string`.

## Rules

`schema.validate()` returns the Standard Schema result without inventing a new issue model.

`schema.parse()` returns the typed output or throws `SchemaValidationError` with the original structured issues.

`schema.prefixIssues()` creates new issue objects with a parent path. It does not mutate provider-owned issue objects.

The package owns no business schema and performs no I/O.

## Progressive usage

Read [complete compositions](../../docs/composition.md) for a bounded CSV import, allowed-page discovery and a
resource-backed operation. Each example names its result and owner. Use [the outcome guide](../../docs/outcomes.md) to
choose additional mechanisms when the application needs them.

## Convenience and the manual equivalent

| Convenience         | Manual equivalent                                                                                       | Concrete value                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `schema.validate()` | call `schema['~standard'].validate()`, await sync/async results, and normalize issues yourself          | one Standard Schema validation path            |
| `schema.parse()`    | call validate, throw a consistent `SchemaValidationError`, and preserve exact output inference manually | throwing parse without schema-library coupling |
| `prefixIssues()`    | copy every issue and prepend a path segment while preserving existing paths                             | composed validators retain precise locations   |

`@okikio/schema` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics by calling
`schema["~standard"].validate(value)` and inspecting its issues.

The utility normalizes sync/async validation, issue paths, parse/assert behavior, and Standard Schema interoperability.

## Source guide

Start with this README, then use the source in this order when you need more detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*.test.ts` files show edge cases, cancellation, invalid input, and lifecycle behavior as executable examples.
4. Read internal implementation files only when you need the exact state transition or performance-sensitive loop.

The [generated API reference](API.md) lists every public function and type. These examples teach the common paths and
the design decisions behind those contracts.

## Standard JSON Schema

Standard Schema validation and Standard JSON Schema representation are related but separate contracts. A conforming
validator can expose both under the same `~standard` properties. These are separate capabilities:

```text
~standard.validate(input)                       check data and return the transformed value or issues
~standard.jsonSchema.input({ target })          describe accepted wire input, when supported
~standard.jsonSchema.output({ target })         describe validated output, when supported
```

Do not assume that the two JSON Schemas are identical. Coercions, defaults, codecs, and transforms can make accepted
input different from validated output.

`@okikio/schema` does not require Zod to obtain this representation. Current Zod releases expose Standard JSON Schema
through the standard protocol. A provider-specific adapter is only useful when the common protocol omits behavior or
metadata that the caller actually needs.
