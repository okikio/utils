# `@okikio/schema`

Use one Standard Schema validation call across validator libraries. Reading a validator-specific result shape in every
utility otherwise forces consumers to use the same schema engine.

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

## Build on the example

Start with parse() when invalid input should throw, then use result-oriented validation where a caller needs structured
issues. Keep coercion in the schema that owns the meaning. JSON Schema projection is a separate capability and can fail
for values that have no faithful wire representation. Import a validator adapter explicitly; the generic validation core
does not silently choose one.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Purpose

`@okikio/schema` provides the small Standard Schema operations shared by the other generic utilities.

It recognizes Standard Schema V1 contracts, validates values, parses typed outputs, throws one structured
`SchemaValidationError`, and prefixes issue paths when a larger composed value reports nested validation failures.

## Start here

```ts
import * as schema from '@okikio/schema';
import { z } from 'zod';

const PortSchema = z.coerce.number().int().min(1).max(65535);
const port = await schema.parse(PortSchema, '8787');
```

The same call works with any Standard Schema V1 validator. The package does not inspect Zod internals.

## Inspect issues without throwing

```ts
const checked = await schema.validate(PortSchema, 'not-a-port');

if ('issues' in checked) {
	for (const issue of checked.issues) console.error(issue.message);
} else {
	console.log(checked.value);
}
```

Use `validate()` when issues are part of normal caller control flow. Use `parse()` when invalid input should throw
`SchemaValidationError`.

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
const PersistedStatusSchema = z.string();

const KnownStatusSchema = z.enum([
	'queued',
	'running',
	'completed',
]);

const persisted = await schema.parse(PersistedStatusSchema, row.status);
const known = KnownStatusSchema.safeParse(persisted);
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

The README is the primary user documentation. It intentionally stays close to the public source instead of maintaining a
separate hand-written API reference.

## Standard JSON Schema

Standard Schema validation and Standard JSON Schema representation are related but separate contracts. A conforming
validator can expose both under the same `~standard` properties:

```ts
const standard = value['~standard'];
const checked = await standard.validate(input);
const inputSchema = standard.jsonSchema?.input({ target: 'draft-2020-12' });
const outputSchema = standard.jsonSchema?.output({ target: 'draft-2020-12' });
```

Do not assume that the two JSON Schemas are identical. Coercions, defaults, codecs, and transforms can make accepted
input different from validated output.

`@okikio/schema` does not require Zod to obtain this representation. Current Zod releases expose Standard JSON Schema
through the standard protocol. A provider-specific adapter is only useful when the common protocol omits behavior or
metadata that the caller actually needs.
