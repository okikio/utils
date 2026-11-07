# Separate raw configuration from validated options

Read caller-selected sources, apply an explicit precedence order, and validate the resulting strings before opening
resources. A schema can convert values and supply defaults. Keep the source of each field visible when explaining a bad
startup option.

The application decides when to read its environment. Importing a reusable module should not discover configuration or
start resources. Vendor metadata is optional; validation uses Standard Schema.

A port setting may come from deployment defaults and then a test override. Source selection and validation are separate:
a source can win precedence while still supplying an invalid port.

| Source order | PORT input | Result |
| --- | --- | --- |
| Deployment first | 8787 | Used unless a later source supplies a string |
| Test override last | 4321 | Replaces deployment PORT |
| Later source omits PORT | undefined | Falls through to the deployment value |
| Later source supplies an empty string | Empty text | Wins selection, then must pass the field schema |

```text
Raw sources → select by precedence → schema validates/converts → checked startup options → open listener
                                              └── invalid input → report configuration error; do not start
```

The flow describes startup order, not a running server. Merging sources does not compose field definitions or give a
copied definition the identity of its original. The examples keep those two operations separate.

## Parse a service port before opening a listener

The application supplies port text and asks its environment definition for a checked number. Parsing happens before any
listener is opened, so an invalid setting can be corrected without starting a partially configured service.

Run from this checkout after `mise run prepare -- --kind deps`. Save the runnable block as `example.ts` at the checkout root and use
`mise exec -- deno run example.ts`.

```ts runnable=package-task.ts
import * as env from '@okikio/env';
import * as schema from '@okikio/schema';

// Define validation once. Parsing reads only the explicit source supplied below.
const Service = env.define({
	PORT: env.variable(
		schema.defaults(schema.coerce.number({ integer: true, minimum: 1, maximum: 65535 }), () => 8787),
		{ description: 'TCP port used by the service.' },
	),
});

// The source contains text; the schema converts and checks it before application use.
const values = Service.parseSync(env.record({ PORT: '4321' }));
console.log('Listen on port', values.PORT);
```

Expected output:

```text output
Listen on port 4321
```

The description is required because the same field definition can explain its setting in deployment instructions.
The description does not choose a value: the schema provides the default, and the chosen source provides any override.
For this example, omitting `PORT` selects `8787`; an invalid port still fails the same range check.

## Separate field rules from the chosen source

Concrete packages define the environment fields they need. An executable host selects raw sources and parses those
definitions during startup. Importing a definition never reads ambient process state.

Metadata can produce an operator's configuration checklist. `secret()` keeps the credential value out of that generated
template, so the same definitions used for startup checks can also produce safe deployment instructions:

Save this complete variation as `configuration-template.ts` and run `mise exec -- deno run configuration-template.ts` after the same checkout setup.

```ts runnable=configuration-template.ts
import * as env from '@okikio/env';
import * as schema from '@okikio/schema';

const ServiceEnvironment = env.define({
	PORT: env.variable(
		schema.defaults(schema.coerce.number({ integer: true, minimum: 1, maximum: 65535 }), () => 8787),
		{ title: 'HTTP port', description: 'Port used by the service listener.', example: '8787' },
	),
	DATABASE_URL: env.secret(schema.string({ minLength: 1 }), {
		description: 'PostgreSQL connection string.',
	}),
});

console.log(env.example(ServiceEnvironment));
```

```text output
# PostgreSQL connection string.
DATABASE_URL=<secret>

# HTTP port
# Port used by the service listener.
PORT=8787
```

The definition is import-safe. Creating it does not read ambient state, connect to a provider, or configure a process.
The service entrypoint owns the source and decides when startup validation occurs.

Field collections are ordinary records. Use an object literal or a null-prototype record with own enumerable string
properties. `env.define()` snapshots that record into a frozen null-prototype object so keys such as `__proto__` and
`constructor` stay ordinary environment keys. It rejects class instances, hidden properties, accessors, and symbol keys
rather than silently dropping data that the TypeScript field type claimed was present.

## Public vocabulary

Import the package as a namespace so the verbs stay short without becoming ambiguous:

```text
env.define(...)       create a definition
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

`compose` combines definitions. `merge` combines sources. The different verbs make the two halves visible at the call
site.

`isSource()` is mainly for adapters that accept either an existing source or a raw record. `requirementReport()` is
useful at deployment and startup checks when an operator needs to see which canonical keys are required and why without
printing the corresponding secret values.

## Apply precedence and stop an invalid startup

The last source with a concrete string wins. In this complete variation the test override replaces deployment port `8787` with `4321`. The second parse deliberately supplies `70000`; no listener should open after that failure.

Save this complete variation as `startup-rejection.ts` and run `mise exec -- deno run startup-rejection.ts` after the same checkout setup.

```ts runnable=startup-rejection.ts
import * as env from '@okikio/env';
import * as schema from '@okikio/schema';
const ServiceEnvironment = env.define({
	PORT: env.variable(schema.coerce.number({ integer: true, minimum: 1, maximum: 65535 }), {
		description: 'Service listener port.',
	}),
});

const deployment = env.record({ PORT: '8787' });
const testOverride = env.record({ PORT: '4321' });
// Supply sources from lowest to highest precedence.
const selected = env.merge(deployment, testOverride);

// Validation happens after source selection and before a listener could open.
console.log(ServiceEnvironment.parseSync(selected).PORT);
try {
	ServiceEnvironment.parseSync(env.record({ PORT: '70000' }));
} catch (error) {
	if (!(error instanceof env.EnvironmentError)) throw error;
	console.log('Correct PORT before opening the listener');
}
```

```text output
4321
Correct PORT before opening the listener
```

An empty string is a real override; only `undefined` falls through. Decide whether blanks are valid in the field schema. To diagnose which source won without exposing raw values, use the [same-port provenance example](../packages/env/README.md#resolve-once-and-retain-key-only-provenance). The optional adapters below change authoring metadata, not these startup responsibilities.

## Optional validator metadata adapters

Use `@okikio/schema` with `env.variable()` and `env.secret()` for ordinary definitions, as above. These optional
adapters help applications that already author their validators with another library. They preserve that library's
metadata while returning the same environment field contracts.

### Zod adapter

Bare Zod schemas become ordinary variables. The adapter reads metadata through Zod 4's public `.meta()` and
`.describe()` APIs:

```ts
import * as env from '@okikio/env/zod';
import { z } from 'zod';

const ServiceEnvironment = env.define({
	LOG_LEVEL: z.enum(['debug', 'info', 'warning', 'error']).default('info').meta({
		title: 'Log level',
		description: 'Minimum diagnostic severity emitted by the service.',
		examples: ['info'],
	}),
});
console.log(ServiceEnvironment.parseSync({}).LOG_LEVEL); // info
```

Secret classification remains explicit because secrecy is a deployment rule, not a validation property:

```ts
import * as env from '@okikio/env/zod';
import { z } from 'zod';

const ServiceEnvironment = env.define({
	API_TOKEN: env.secret(
		z.string().min(1).describe('Token used to call the provider API.'),
	),
});
console.log(env.example(ServiceEnvironment)); // API_TOKEN=<secret>, with its description
```

### Valibot adapter

```ts
import * as env from '@okikio/env/valibot';
import * as v from 'valibot';

const PortSchema = v.pipe(
	v.string(),
	v.title('HTTP port'),
	v.description('Port used by the service listener.'),
	v.examples(['8787']),
);

const ServiceEnvironment = env.define({ PORT: PortSchema });
console.log(ServiceEnvironment.parseSync({ PORT: '8787' }).PORT); // '8787': this schema keeps text
```

The adapter uses Valibot's public `getTitle`, `getDescription`, `getMetadata`, and `getExamples` functions. The original
Valibot schema remains the runtime validator and the source of inferred output types.

### Generic Standard Schema

Standard Schema defines validation interoperability but does not define a shared metadata protocol. Generic callers
therefore provide environment metadata explicitly:

Save this complete variation as `standard-schema.ts` and run `mise exec -- deno run standard-schema.ts` after the same checkout setup.

```ts runnable=standard-schema.ts
import * as env from '@okikio/env';
import * as schema from '@okikio/schema';

const PortSchema = schema.coerce.number({ integer: true, minimum: 1, maximum: 65535 });
const ServiceEnvironment = env.define({
	PORT: env.variable(PortSchema, {
		description: 'Port used by the service listener.',
		example: '8787',
	}),
});
console.log(ServiceEnvironment.parseSync({ PORT: '8787' }).PORT);
```

```text output
8787
```

The generic entrypoint never inspects private Zod or Valibot properties.

## Metadata ownership and precedence

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

Explicit metadata passed to `env.variable()` or `env.secret()` overrides schema metadata. This lets one reusable schema
carry a general description while a service gives the binding a more specific operational meaning.

Secrets never project examples, including examples attached to the schema.

## Raw-source ownership

`@okikio/env` consumes raw environment records. It does not discover `.env` files, read a filesystem, or choose which
runtime source has precedence. That decision belongs to the executable host.

At the executable root, pass `env.env` to read only the declared keys from the runtime. You can also supply
`process.env` in Node or `Deno.env.toObject()` in Deno when an existing host already owns a complete raw snapshot.

A browser-like host can pass deployment bindings. A test can pass a literal record. If a CLI chooses to parse dotenv
syntax, the parser remains CLI/runtime composition and its result is still just `Record<string, string | undefined>`.

## Source-only usage

Not every value needs an environment definition. A deployment adapter may need only a few opaque strings:

```ts
import * as env from '@okikio/env';

const values = env.select(
	env.merge({ RELEASE_ID: 'stable', REGION: 'us-east' }, { RELEASE_ID: 'preview' }),
	['RELEASE_ID', 'REGION'],
);
console.log(JSON.stringify(values)); // {"RELEASE_ID":"preview","REGION":"us-east"}
```

This path has no Zod or Valibot dependency.

## Canonical field identity

Composition permits the same field object to arrive through several imported definitions:

Save this complete variation as `shared-field.ts` and run `mise exec -- deno run shared-field.ts` after the same checkout setup.

```ts runnable=shared-field.ts
import * as env from '@okikio/env';
import * as schema from '@okikio/schema';

const DatabaseUrl = env.secret(schema.string({ minLength: 1 }), {
	description: 'PostgreSQL connection string.',
});

const DatabaseEnvironment = env.define({ DATABASE_URL: DatabaseUrl });
const WorkerEnvironment = env.define({ DATABASE_URL: DatabaseUrl });

const HostEnvironment = env.compose(DatabaseEnvironment, WorkerEnvironment);
console.log(env.manifest(HostEnvironment).secrets.map((field) => field.key)); // ['DATABASE_URL'], once
```

Independently declaring another field under `DATABASE_URL` is rejected. Silently choosing one declaration would lose
validation or deployment metadata.

Reuse the same `env.variable()` or `env.secret()` field object wherever a binding is shared. The optional Zod and
Valibot adapters also canonicalize bare schemas by schema-object identity.

## Runtime behavior

- `env.env` is lazy and performs no read during import.
- Deno reads remain per-key so hosts can grant narrow environment permissions.
- Node access reads ambient `process.env` without static `node:` imports in browser-compatible graphs.
- `env.record()` snapshots values through `Map`, so prototype-shaped external keys remain ordinary data.
- `env.merge()` is sparse: `undefined` falls through to a lower-precedence source.
- Definitions collect all schema issues before throwing `EnvironmentError`; its message lists each field while `.issues`
  preserves structured failures.
- `parseSync()` rejects schemas that validate asynchronously and directs callers to `parse()`.

## Progressive usage

Read [complete compositions](./03-composition.md) for a bounded CSV import, allowed-page discovery and a resource-backed
operation. Each example names its result and owner. Use [the outcome guide](./07-outcomes.md) to choose additional
mechanisms when the application needs them.

The [public source](../packages/env/mod.ts) lists every public function and type. These examples teach the common paths
and the design decisions behind those contracts.

## Decide which bookkeeping to keep in your application

| Convenience                          | Manual equivalent                                                                       | Concrete value                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `env.define()`                       | validate field definitions, snapshot the field map, parse raw strings and prefix issues | one schema-derived environment contract                                         |
| `env.merge()` / `env.select()`       | copy raw source records in precedence order or pick exact keys manually                 | source acquisition stays outside the utility while composition is deterministic |
| `definition.parse()` / `parseSync()` | resolve the definition and throw one structured report for missing/invalid fields       | typed startup failure instead of scattered `Deno.env.get()` checks              |

`@okikio/env` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics by passing a
`Record<string, string | undefined>` into Zod, Valibot, or another Standard Schema.

The utility adds canonical field identity, source composition, secret classification, manifests, examples, and
requirement metadata. It deliberately does not discover files or load dotenv documents.
