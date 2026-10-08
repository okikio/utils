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

## Preserve every selected search filter

```ts runnable
import { parseQuery } from '@okikio/utils/http/request';

const incoming = new Request('https://service.invalid/search?tag=film&tag=music');
const filters = parseQuery(new URL(incoming.url).search);
const outgoing = Response.json(filters);
console.log(await outgoing.text());
```

Expected output:

```text output
{"tag":["film","music"]}
```

The request represents a search with two selected tags. `parseQuery()` preserves both values instead of silently
choosing one, and the ordinary JSON response carries the filters forward. The utility is imported through a suite
subpath; its behavior is identical to the focused HTTP package. This runs in process without a network connection.

- **Build a small import tool:** use [CSV](../csv/README.md), [Streams](../streams/README.md), and
  [Context](../context/README.md) through their corresponding umbrella subpaths. CSV understands rows, Streams groups
  them, and Context carries the operation lifetime.
- **Publish a reusable parser library:** install only the needed [Codec](../codec/README.md) or other focused package
  when the narrow dependency declaration is useful. Suite installation is optional; consumers retain direct public
  imports and the same contracts.

## What the umbrella adds under the hood

Both `@okikio/http/request` and `@okikio/utils/http/request` export the same `parseQuery` implementation. Choose the
first path with a focused dependency, or the second after installing the suite.

The generated umbrella module contains `export * from '@okikio/http/request'`. There is no wrapper callback, second
parser or extra context passed to the function. Its return remains the same readonly string/string-array record. The
root `packages` value is a frozen array of package names, while `PackageName` is the TypeScript union derived from those
literal names. These are inventory data, not registrations that start runtimes.

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

Import only the capability used by the module. For example, a parser can use `@okikio/utils/http/request` as above,
while a work queue can use `@okikio/utils/queue`.

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

An imported contact-domain file may reorder its columns and contain quoted commas. Compose CSV parsing with domain
normalization to read the domain column by name and compare equivalent spellings before presenting the import preview:

```ts runnable=contact-preview.ts
import { parse } from '@okikio/utils/csv';
import { normalizeDomain } from '@okikio/utils/email';

const document = parse('Name,Domain\n"Doe, Jane",@EXAMPLE.COM\nLee,example.com\n', { headerRow: 1 });
const domainColumn = document.columns.find((column) => column.key === 'domain');
if (domainColumn === undefined) throw new Error('The contact file needs a Domain column.');
const normalized = document.rows.map((row) => normalizeDomain(row.values[domainColumn.index] ?? ''));
const domains = normalized.filter((domain) => domain !== undefined);
console.log(JSON.stringify([...new Set(domains)]));
```

```text output
["example.com"]
```

CSV owns quoting and column positions. Email normalization admits valid domain shapes and canonicalizes their spelling.
The array code deliberately excludes invalid domains and removes duplicates; neither utility proves mailbox existence or
sends email. The umbrella only changes how both capabilities are installed and imported; it adds no execution context or
lifecycle to this job.

Use `@okikio/utils/all` only at an intentional composition root that needs broad namespace access. Its `context`,
`version` and other namespaces give the same operations as the focused entries, but importing it reaches the complete
suite graph.

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

| Capability                   | Suite entry                       | Example export   |
| ---------------------------- | --------------------------------- | ---------------- |
| Read repeated HTTP filters   | `@okikio/utils/http/request`      | `parseQuery`     |
| Prepare method/path matching | `@okikio/utils/server/http`       | `prepareRoutes`  |
| Describe that prepared plan  | `@okikio/utils/server/http/types` | `RoutePlan` type |

These files are generated re-export bridges. They do not contain alternate implementations.
`tools/sync-utils-exports.ts` owns parity with focused package manifests.

## Tree-shaking is tested

`sideEffects: false` is not treated as sufficient proof. The repository bundles representative leaf imports and their
umbrella equivalents and checks that the umbrella adds no meaningful runtime weight. A namespace-import case is included
because barrels can accidentally defeat tree-shaking even when named imports look healthy.

The disposal and Temporal polyfills are explicit exceptions: they install missing globals, are marked side-effectful,
and stay behind their own setup subpaths.
