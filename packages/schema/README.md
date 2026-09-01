`@okikio/schema`
===============

Purpose
-------

`@okikio/schema` provides the small Standard Schema operations shared by the
other generic utilities.

It recognizes Standard Schema V1 contracts, validates values, parses typed
outputs, throws one structured `SchemaValidationError`, and prefixes issue paths
when a larger composed value reports nested validation failures.



Start here
----------

```ts
import * as schema from '@okikio/schema';
import { z } from 'zod';

const PortSchema = z.coerce.number().int().min(1).max(65535);
const port = await schema.parse(PortSchema, '8787');
```

The same call works with any Standard Schema V1 validator. The package does not
inspect Zod internals.

Inspect issues without throwing
-------------------------------

```ts
const checked = await schema.validate(PortSchema, 'not-a-port');

if ('issues' in checked) {
  for (const issue of checked.issues) console.error(issue.message);
} else {
  console.log(checked.value);
}
```

Use `validate()` when issues are part of normal caller control flow. Use
`parse()` when invalid input should throw `SchemaValidationError`.

How it fits
-----------

This package prevents each utility from implementing its own schema-library
adapter.  `failure`, `codec`, `activity`, `workflow`, `http`, and other packages
can accept Standard Schema contracts without requiring Zod or Valibot in their
core APIs.

Use schema-library-specific packages only where their richer authoring metadata
is part of the job.  For example, `@okikio/env/zod` can read Zod metadata while
the generic environment package still validates through Standard Schema.



Schema authority
----------------

A validator proves only the contract it actually validates. Do not use a narrow
schema to hide a broader external or durable source.

Suppose a database column is unconstrained text but the application currently
recognizes three states. The storage adapter should first expose `string`:

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

The second validation is an application classification step. It must not be
confused with a guarantee made by the database.

The opposite case is also useful: if the durable schema or provider contract
really enforces the finite vocabulary, retain that exact type through the
adapter instead of widening it back to `string`.


Rules
-----

`schema.validate()` returns the Standard Schema result without inventing a new
issue model.

`schema.parse()` returns the typed output or throws `SchemaValidationError` with
the original structured issues.

`schema.prefixIssues()` creates new issue objects with a parent path.  It does
not mutate provider-owned issue objects.

The package owns no business schema and performs no I/O.

Progressive usage
-----------------

The package participates in the complete domain-enrichment example in
`../../docs/composition.md`.  Read that guide when the
individual helpers make sense in isolation but their place in a service,
resource graph, runtime host, or workflow is not yet clear.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `schema.validate()` | call `schema['~standard'].validate()`, await sync/async results, and normalize issues yourself | one Standard Schema validation path |
| `schema.parse()` | call validate, throw a consistent `SchemaValidationError`, and preserve exact output inference manually | throwing parse without schema-library coupling |
| `prefixIssues()` | copy every issue and prepend a path segment while preserving existing paths | composed validators retain precise locations |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/schema` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with call schema["~standard"].validate(value) and inspect issues yourself.

The utility normalizes sync/async validation, issue paths, parse/assert behavior, and Standard Schema interoperability.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Source guide
------------

Start with this README, then use the source in this order when you need more
detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*_test.ts` files show edge cases, cancellation, invalid input, and lifecycle
   behavior as executable examples.
4. Read internal implementation files only when you need the exact state
   transition or performance-sensitive loop.

The README is the primary user documentation. It intentionally stays close to
the public source instead of maintaining a separate hand-written API reference.
