`@okikio/env`
============

Purpose
-------

`@okikio/env` separates environment definitions from environment sources. A
definition owns validation, documentation, and secret classification. A source
owns the raw strings available to one host.

How it fits
-----------

Concrete packages define the environment fields they need. An executable host
selects raw sources and parses those definitions during startup. Importing a
definition never reads ambient process state.

`@okikio/env` keeps two related responsibilities separate:

1. an **environment definition** describes, validates, documents, and classifies values;
2. an **environment source** supplies the raw strings available to one host.

They meet only when a host parses a definition:

```ts
import * as env from '@okikio/env/zod';
import { z } from 'zod';

const ServiceEnvironment = env.define({
	PORT: z.coerce.number().int().positive().default(8787).meta({
		title: 'HTTP port',
		description: 'Port used by the service listener.',
		examples: ['8787'],
	}),
	DATABASE_URL: env.secret(
		z.string().min(1).describe('PostgreSQL connection string.'),
	),
});

const values = ServiceEnvironment.parseSync(
	env.merge(env.env, { PORT: '4321' }),
);
```

The definition is import-safe. Creating it does not read ambient state, connect to a
provider, or configure a process. The service entrypoint owns the source and decides
when startup validation occurs.

Field collections are ordinary records. Use an object literal or a null-prototype
record with own enumerable string properties. `env.environment()` snapshots that
record into a frozen null-prototype object so keys such as `__proto__` and
`constructor` stay ordinary environment keys. It rejects class instances, hidden
properties, accessors, and symbol keys rather than silently dropping data that the
TypeScript field type claimed was present.

Public vocabulary
-----------------

Import the package as a namespace so the verbs stay short without becoming ambiguous:

```text
env.define(...)       create a definition
env.environment(...)  equivalent concise authoring form
env.compose(...)      combine definitions through canonical field identity

env.env               lazy Deno/Node ambient source
env.record(...)       capture deterministic raw values
env.merge(...)        combine sparse sources by precedence
env.select(...)       read a bounded raw record without defining schemas
env.isSource(...)     detect an existing pull-based environment source

env.variable(...)     classify an ordinary host variable
env.secret(...)       classify protected secret material

env.manifest(...)     project deployment metadata
env.example(...)      generate a safe .env.example
env.requirement(...)  explain why a resource selects canonical fields
env.requirementReport(...) project selected requirements without exposing secret values
```

`compose` combines definitions. `merge` combines sources. The different verbs make
the two halves visible at the call site.

`isSource()` is mainly for adapters that accept either an existing source or a
raw record. `requirementReport()` is useful at deployment/startup boundaries
when an operator needs to see which canonical keys are required and why without
printing the corresponding secret values.

Start here
----------

### Zod

```ts
import * as env from '@okikio/env/zod';
```

Bare Zod schemas become ordinary variables. The adapter reads metadata through Zod
4's public `.meta()` and `.describe()` APIs:

```ts
const ServiceEnvironment = env.define({
	LOG_LEVEL: z.enum(['debug', 'info', 'warning', 'error']).default('info').meta({
		title: 'Log level',
		description: 'Minimum diagnostic severity emitted by the service.',
		examples: ['info'],
	}),
});
```

Secret classification remains explicit because secrecy is a deployment rule, not a validation property:

```ts
const ServiceEnvironment = env.define({
	API_TOKEN: env.secret(
		z.string().min(1).describe('Token used to call the provider API.'),
	),
});
```

### Valibot

```ts
import * as env from '@okikio/env/valibot';
import * as v from 'valibot';

const Port = v.pipe(
	v.string(),
	v.title('HTTP port'),
	v.description('Port used by the service listener.'),
	v.examples(['8787']),
);

const ServiceEnvironment = env.define({ PORT: Port });
```

The adapter uses Valibot's public `getTitle`, `getDescription`, `getMetadata`, and
`getExamples` functions. The original Valibot schema remains the runtime validator and
the source of inferred output types.

### Generic Standard Schema

```ts
import * as env from '@okikio/env/standard';
```

Standard Schema defines validation interoperability but does not define a shared
metadata protocol. Generic callers therefore provide environment metadata explicitly:

```ts
const ServiceEnvironment = env.define({
	PORT: env.variable(PortSchema, {
		description: 'Port used by the service listener.',
		example: '8787',
	}),
});
```

The generic entrypoint never inspects private Zod or Valibot properties.

Metadata ownership and precedence
---------------------------------

Schema metadata should describe the value itself:

```text
title
description
examples
deprecated
```

Environment metadata describes the deployment binding:

```text
variable or secret classification
documentation URL
deployment availability
replacement key
```

Explicit metadata passed to `env.variable()` or `env.secret()` overrides schema
metadata. This lets one reusable schema carry a general description while a service
gives the binding a more specific operational meaning.

Secrets never project examples, including examples attached to the schema.

Raw-source ownership
--------------------

`@okikio/env` consumes raw environment records. It does not discover `.env`
files, read a filesystem, or choose which runtime source has precedence. That
decision belongs to the executable host.

```ts
// Node host
const raw = Object.fromEntries(Object.entries(process.env));
const values = ServiceEnvironment.parseSync(raw);
```

```ts
// Deno host
const values = ServiceEnvironment.parseSync(Deno.env.toObject());
```

A browser-like host can pass deployment bindings. A test can pass a literal
record. If a CLI chooses to parse dotenv syntax, the parser remains CLI/runtime
composition and its result is still just `Record<string, string | undefined>`.

Source-only usage
-----------------

Not every value needs an environment definition. A deployment adapter may need only a few opaque strings:

```ts
import * as env from '@okikio/env';

const values = env.select(
	env.merge(env.env, deploymentOverrides),
	['BUNNY_API_KEY', 'BUNNY_RELEASE_ID'],
);
```

This path has no Zod or Valibot dependency.

Canonical field identity
------------------------

Composition permits the same field object to arrive through several imported definitions:

```ts
export const DatabaseUrl = env.secret(
	z.string().min(1).describe('PostgreSQL connection string.'),
);

export const DatabaseEnvironment = env.define({ DATABASE_URL: DatabaseUrl });
export const WorkerEnvironment = env.define({ DATABASE_URL: DatabaseUrl });

const HostEnvironment = env.compose(DatabaseEnvironment, WorkerEnvironment);
```

Independently declaring another field under `DATABASE_URL` is rejected. Silently
choosing one declaration would lose validation or deployment metadata.

Bare Zod and Valibot schemas are canonicalized by schema-object identity, so reusing
the same schema object in several definitions composes safely.

Runtime behavior
----------------

- `env.env` is lazy and performs no read during import.
- Deno reads remain per-key so hosts can grant narrow environment permissions.
- Node access uses `process.getBuiltinModule('node:process')`, avoiding static
  `node:` imports in browser-compatible graphs.
- `env.record()` snapshots values through `Map`, so prototype-shaped external keys remain ordinary data.
- `env.merge()` is sparse: `undefined` falls through to a lower-precedence source.
- Definitions collect all schema issues before throwing `EnvironmentError`; its message lists each field while `.issues` preserves structured failures.
- `parseSync()` rejects schemas that validate asynchronously and directs callers to `parse()`.

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
| `env.environment()` | validate every field definition, snapshot the map, parse raw strings, prefix issues, and freeze the resolved output | one schema-derived environment contract |
| `env.merge()` / `env.select()` | copy raw source records in precedence order or pick exact keys manually | source acquisition stays outside the utility while composition is deterministic |
| `env.require()` | resolve the definition and throw one structured report for missing/invalid fields | typed startup failure instead of scattered `Deno.env.get()` checks |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/env` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with pass a Record<string, string | undefined> into Zod, Valibot, or another Standard Schema yourself.

The utility adds canonical field identity, source composition, secret classification, manifests, examples, and requirement metadata. It deliberately does not discover files or load dotenv documents.

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
