`@okikio/utils`
===============

Purpose
-------

`@okikio/utils` is the installation package for the complete Okikio utility
suite. It does not implement a second copy of any utility. Each subpath re-exports
the focused `@okikio/*` package that owns that behavior.

Use the umbrella when an application wants one dependency declaration while
keeping imports focused and tree-shakeable.

The ordinary problem
--------------------

Without the umbrella, an application that uses several utilities declares each
leaf package separately:

```sh
deno add jsr:@okikio/context jsr:@okikio/queue jsr:@okikio/workflow
```

That is useful when a reusable library deliberately wants the smallest possible
dependency surface. Applications often prefer one suite dependency instead.

Use the umbrella
----------------

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

These subpaths re-export the corresponding leaf packages. Importing
`@okikio/utils/queue` therefore does not evaluate HTML, Hono, Worker, process,
or other unrelated runtime surfaces.

The root module is intentionally small:

```ts
import { packages } from '@okikio/utils';

console.log(packages.includes('@okikio/queue')); // true
console.log(packages.includes('@okikio/telemetry')); // true
```

It exposes installation inventory rather than loading the full utility graph.

Use utilities together
----------------------

One application can use a `Context` as the lifetime for bounded queue admission
without hiding which package owns which state:

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

`@okikio/context` owns cancellation/deadline state. `@okikio/queue` owns logical
work identity and claims. The umbrella only changes how both packages are
installed and imported.

Use `@okikio/utils/all` only at an intentional composition root that needs broad
namespace access:

```ts
import * as utils from '@okikio/utils/all';

console.log(utils.context.SystemClock);
console.log(utils.version.semanticVersionScheme.id);
```

A normal leaf module should prefer focused subpaths because they make dependency
and runtime ownership obvious.

Convenience and the manual equivalent
-------------------------------------

The umbrella changes dependency declaration, not runtime behavior. The manual
equivalent is to install and import every focused package separately.

| Convenience | Manual equivalent | Utility-owned invariant |
| --- | --- | --- |
| `@okikio/utils/<name>` | declare `@okikio/<name>` as a separate dependency | one suite installation with the same focused runtime module |
| `@okikio/utils/all` | import every leaf namespace yourself | explicit composition-root convenience |
| root `packages` inventory | maintain a second package list in application code | suite membership stays inspectable |

Leaf package or umbrella?
-------------------------

| Situation | Import style |
| --- | --- |
| reusable package wants minimal declared dependencies | `@okikio/context` |
| application wants one suite dependency | `@okikio/utils/context` |
| composition root intentionally needs many namespaces | `@okikio/utils/all` |
| code only needs suite inventory | `@okikio/utils` |

Release history
---------------

Each focused utility keeps its own changelog. A leaf package change propagates a
semantic bump into `@okikio/utils`, which gives suite consumers a compatible
aggregate release without replacing the leaf histories.

Source guide
------------

1. `mod.ts` contains the immutable package inventory.
2. `all.ts` re-exports every focused namespace.
3. generated `<name>.ts` and `<name>/<subpath>.ts` files re-export focused package entries.
4. `tools/sync-utils-exports.ts` owns deep export parity.
5. `mod.test.ts` proves inventory/subpath consistency.

Deep focused subpaths
---------------------

The umbrella mirrors public subpaths from every focused package, including
nested paths:

```ts
import { parseQuery } from '@okikio/utils/http/request';
import { prepareRoutes } from '@okikio/utils/server/http';
import type { RoutePlan } from '@okikio/utils/server/http/types';
```

These files are generated re-export bridges. They do not contain alternate
implementations. `tools/sync-utils-exports.ts` owns parity with focused package
manifests.

Tree-shaking is tested
----------------------

`sideEffects: false` is not treated as sufficient proof. The repository bundles
representative leaf imports and their umbrella equivalents and checks that the
umbrella adds no meaningful runtime weight. A namespace-import case is included
because barrels can accidentally defeat tree-shaking even when named imports
look healthy.

The disposal polyfill is the explicit exception: it is intentionally marked as
side-effectful and remains behind its own subpath.
