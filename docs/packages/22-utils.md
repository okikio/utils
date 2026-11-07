# Utils

Use one suite dependency while importing only the capabilities each module needs. Start with the
[package example](../../packages/utils/README.md), then use this guide to choose between the umbrella and leaf packages.

## Decide what to install

An application that runs background jobs might install three individual packages: `@okikio/context`,
`@okikio/scheduler`, and `@okikio/workflow`.
The import `@okikio/scheduler/queue` is a subpath of the Scheduler dependency, not another package to install.

The difference is in what you install and import:

| If you install | The queue import is |
| --- | --- |
| `@okikio/scheduler` | `@okikio/scheduler/queue` |
| `@okikio/utils` | `@okikio/utils/scheduler/queue` |

Both paths give you the same queue implementation. Choose individual packages when you want to declare each dependency
separately. Choose the umbrella when you want one dependency for several utilities.

## Use the umbrella

The current workspace packages are experimental `0.0.0` sources. In this checkout, run `mise trust`, `mise install`, then `mise run prepare -- --kind deps`. Save the complete contact preview below as `contact-preview.ts` and run `mise exec -- deno run contact-preview.ts`.

For an external application, verify a released registry version and its export map before adding it; this guide does not establish publication.

Import only the capability used by the module. For example, a parser can use `@okikio/utils/http/request`,
while a work queue can use `@okikio/utils/scheduler/queue`.

These subpaths re-export the corresponding leaf packages. Importing `@okikio/utils/scheduler/queue` therefore does not
evaluate HTML, Hono, Worker, process, or other unrelated runtime surfaces.

The root module is intentionally small:

```ts
import { packages } from '@okikio/utils';

// This inventory discovers package names. Import a focused subpath when using its operations.
console.log(packages.includes('@okikio/scheduler')); // true
console.log(packages.includes('@okikio/telemetry')); // true
```

It lists package identities, such as Scheduler, rather than every subpath such as Scheduler Queue. It exposes installation inventory rather than loading the full utility graph.

## Read a named CSV column through the umbrella

An imported contact file may reorder its columns and contain quoted commas. Read the domain column by name. Keep the
source cells intact so the application can validate them and show an import preview.

```ts runnable=contact-preview.ts
import { parse } from '@okikio/utils/format/csv';

const document = parse('Name,Domain\n"Doe, Jane",EXAMPLE.COM\nLee,example.com\n', { headerRow: 1 });
const domainColumn = document.columns.find((column) => column.key === 'domain');
if (domainColumn === undefined) throw new Error('The contact file needs a Domain column.');
const domains = document.rows.map((row) => row.values[domainColumn.index]);
console.log(JSON.stringify(domains));
```

```text output
["EXAMPLE.COM","example.com"]
```

CSV owns quoting and column positions. The application owns domain validation and normalization. The umbrella changes
how the utility is installed and imported. It adds no execution context or lifetime to this job.

Use `@okikio/utils/all` only at an intentional composition root that needs broad namespace access. Its `context`, `task`
and other namespaces give the same operations as the focused entries, but importing it reaches the complete suite graph.

A normal leaf module should prefer focused subpaths because they make dependency and runtime ownership obvious.

## Convenience and the manual equivalent

The umbrella changes dependency declaration, not runtime behavior. The manual equivalent is to install and import every
focused package separately.

| Convenience               | Manual equivalent                                  | Utility-owned invariant                                     |
| ------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| `@okikio/utils/collection/record`    | declare `@okikio/collection` and import its `/record` subpath  | one suite installation with the same focused runtime module |
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

The paths below are relative to the [package directory](../../packages/utils).

1. `mod.ts` contains the immutable package inventory.
2. `all.ts` re-exports every focused namespace.
3. generated `<name>.ts` and `<name>/<subpath>.ts` files re-export focused package entries.
4. `tools/packages/exports.ts` owns deep export parity.
5. `mod.test.ts` proves inventory/subpath consistency.

## Deep focused subpaths

The umbrella mirrors public subpaths from every focused package, including nested paths:

| Capability                   | Suite entry                       | Example export   |
| ---------------------------- | --------------------------------- | ---------------- |
| Read repeated HTTP filters   | `@okikio/utils/http/request`      | `parseQuery`     |
| Prepare method/path matching | `@okikio/utils/server/http`       | `prepareRoutes`  |
| Describe that prepared plan  | `@okikio/utils/server/http/types` | `RoutePlan` type |

These files are generated re-export bridges. They do not contain alternate implementations.
`tools/packages/exports.ts` owns parity with focused package manifests.

## Tree-shaking is tested

`sideEffects: false` is not treated as sufficient proof. The repository bundles representative leaf imports and their
umbrella equivalents and checks that the umbrella adds no meaningful runtime weight. A namespace-import case is included
because barrels can accidentally defeat tree-shaking even when named imports look healthy.

The disposal and Temporal polyfills are explicit exceptions: they install missing globals, are marked side-effectful,
and stay behind their own setup subpaths.
