# `@okikio/utils`

An application may need safe result handling, CSV parsing, and cancellation together. `@okikio/utils` lets you declare
one suite dependency, then import each capability through its own path. It is an installation convenience: the focused
packages still own their behavior and can also be installed separately.

A **subpath import** names one part of a package, such as `@okikio/utils/result`. A **leaf package** is the
corresponding focused package, such as `@okikio/result`. The umbrella provides a bridge to it rather than another
implementation.

| Consumer needs                | Import                 | What it selects            |
| ----------------------------- | ---------------------- | -------------------------- |
| Success/failure values        | `@okikio/utils/result` | The focused Result surface |
| Record keys                   | `@okikio/utils/record` | The focused Record surface |
| Suite membership              | `@okikio/utils`        | A lightweight inventory    |
| Every namespace intentionally | `@okikio/utils/all`    | The eager complete facade  |

The table shows import selection, not a promise that any arbitrary bundler removes all unused code. The focused paths
keep runtime ownership clear; representative built consumers are checked separately as described below.

## Use a familiar function through one suite dependency

```ts runnable
import * as result from '@okikio/utils/result';
import * as record from '@okikio/utils/record';
const value = result.ok({ id: 'asset-1' });
console.log(record.keys(result.unwrap(value)).join(','));
```

Expected output:

```text output
id
```

The mini-demo creates a successful Result containing `{ id: 'asset-1' }`. `unwrap()` retrieves that successful value,
and `record.keys()` returns its key names, so the final text is `id`. Both utilities are imported through umbrella
subpaths. Try adding a `name` property to the value to see another key appear; the umbrella does not change either
utility's semantics. Read [Result](../result/README.md) before unwrapping values whose success is not already known.

- **Build a small import tool:** use [CSV](../csv/README.md), [Streams](../streams/README.md), and
  [Context](../context/README.md) through their corresponding umbrella subpaths. CSV understands rows, Streams groups
  them, and Context carries the operation lifetime.
- **Publish a reusable parser library:** install only the needed [Codec](../codec/README.md) or other focused package
  when the narrow dependency declaration is useful. Suite installation is optional; consumers retain direct public
  imports and the same contracts.

## What the umbrella adds under the hood

These imports select the same implementation:

```ts
import { parseQuery } from '@okikio/http/request';
// Or, after installing the suite:
import { parseQuery as suiteParseQuery } from '@okikio/utils/http/request';
```

The generated umbrella module contains `export * from '@okikio/http/request'`. There is no wrapper callback, second
parser or extra context passed to the function. Its return remains the same readonly string/string-array record. The
root `packages` value is a frozen array of package names, while `PackageName` is the TypeScript union derived from those
literal names. These are inventory data, not registrations that start runtimes.

You can use a single familiar parser before learning any of the lifetime or workflow packages:

```ts runnable=suite-search.ts
import { parseQuery } from '@okikio/utils/http/request';

const incoming = new Request('https://service.invalid/search?tag=film&tag=music');
const filters = parseQuery(new URL(incoming.url).search);
const outgoing = Response.json(filters);
console.log(await outgoing.text());
```

```text output
{"tag":["film","music"]}
```

The benefit is installation and import organization. The focused packages own validation, cancellation, resources and
all other runtime behavior. Start with one useful function, then add another when the application needs it. Importing
the eager `all` facade is optional and reaches a much larger graph. See the [suite contracts](API.md) for the inventory
and the focused README for the selected utility's actual behavior.

## Build on the example

Use @okikio/utils/<package> for one-install convenience or install @okikio/<package> independently. Deep subpaths
preserve each focused export, including explicit polyfills and runtime adapters. The root inventory is lightweight; the
all facade is a deliberate eager choice. All packages are currently version 0.0.0 and experimental, so validate the
exact export and contract when upgrading.

[Choose related utilities by outcome](../../docs/outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## The ordinary problem

Without the umbrella, an application that uses several utilities declares each leaf package separately:

```sh
deno add jsr:@okikio/context jsr:@okikio/queue jsr:@okikio/workflow
```

That is useful when a reusable library deliberately wants the smallest possible dependency surface. Applications often
prefer one suite dependency instead.

## Use the umbrella

Install once:

```sh
deno add jsr:@okikio/utils
```

Import only the capabilities used by the module:

```ts
import * as context from '@okikio/utils/context';
import * as queue from '@okikio/utils/queue';
import * as telemetry from '@okikio/utils/telemetry';
import * as workflow from '@okikio/utils/workflow';
```

These subpaths re-export the corresponding leaf packages. Importing `@okikio/utils/queue` therefore does not evaluate
HTML, Hono, Worker, process, or other unrelated runtime surfaces.

The root module is intentionally small:

```ts
import { packages } from '@okikio/utils';

console.log(packages.includes('@okikio/queue')); // true
console.log(packages.includes('@okikio/telemetry')); // true
```

It exposes installation inventory rather than loading the full utility graph.

## Use utilities together

One application can use a `Context` as the lifetime for bounded queue admission without hiding which package owns which
state:

```ts
import * as context from '@okikio/utils/context';
import * as queue from '@okikio/utils/queue';

await using ctx = context.create({ id: 'research-run' });
await using jobs = queue.memory<string, { title: string }>();

const ref = await jobs.add(ctx, 'example.com', { key: 'research:example.com' });
const claim = (await jobs.claim(ctx, { ref, owner: 'local', limit: 1 }))[0];

if (claim) {
	await jobs.complete(ctx, claim, { title: `Research ${claim.value}` });
}
```

`@okikio/context` owns cancellation/deadline state. `@okikio/queue` owns logical work identity and claims. The umbrella
only changes how both packages are installed and imported.

Use `@okikio/utils/all` only at an intentional composition root that needs broad namespace access:

```ts
import * as utils from '@okikio/utils/all';

console.log(utils.context.SystemClock);
console.log(utils.version.semanticVersionScheme.id);
```

A normal leaf module should prefer focused subpaths because they make dependency and runtime ownership obvious.

## Convenience and the manual equivalent

The umbrella changes dependency declaration, not runtime behavior. The manual equivalent is to install and import every
focused package separately.

| Convenience               | Manual equivalent                                  | Utility-owned invariant                                     |
| ------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| `@okikio/utils/<name>`    | declare `@okikio/<name>` as a separate dependency  | one suite installation with the same focused runtime module |
| `@okikio/utils/all`       | import every leaf namespace yourself               | explicit composition-root convenience                       |
| root `packages` inventory | maintain a second package list in application code | suite membership stays inspectable                          |

## Leaf package or umbrella?

| Situation                                            | Import style            |
| ---------------------------------------------------- | ----------------------- |
| reusable package wants minimal declared dependencies | `@okikio/context`       |
| application wants one suite dependency               | `@okikio/utils/context` |
| composition root intentionally needs many namespaces | `@okikio/utils/all`     |
| code only needs suite inventory                      | `@okikio/utils`         |

## Release history

Each focused utility keeps its own changelog. A leaf package change propagates a semantic bump into `@okikio/utils`,
which gives suite consumers a compatible aggregate release without replacing the leaf histories.

## Source guide

1. `mod.ts` contains the immutable package inventory.
2. `all.ts` re-exports every focused namespace.
3. generated `<name>.ts` and `<name>/<subpath>.ts` files re-export focused package entries.
4. `tools/sync-utils-exports.ts` owns deep export parity.
5. `mod.test.ts` proves inventory/subpath consistency.

## Deep focused subpaths

The umbrella mirrors public subpaths from every focused package, including nested paths:

```ts
import { parseQuery } from '@okikio/utils/http/request';
import { prepareRoutes } from '@okikio/utils/server/http';
import type { RoutePlan } from '@okikio/utils/server/http/types';
```

These files are generated re-export bridges. They do not contain alternate implementations.
`tools/sync-utils-exports.ts` owns parity with focused package manifests.

## Tree-shaking is tested

`sideEffects: false` is not treated as sufficient proof. The repository bundles representative leaf imports and their
umbrella equivalents and checks that the umbrella adds no meaningful runtime weight. A namespace-import case is included
because barrels can accidentally defeat tree-shaking even when named imports look healthy.

The disposal and Temporal polyfills are explicit exceptions: they install missing globals, are marked side-effectful,
and stay behind their own setup subpaths.
