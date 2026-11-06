# `@okikio/utils`

An application may need safe result handling, CSV parsing, and cancellation together. `@okikio/utils` lets you declare
one suite dependency, then import each capability through its own path. It is an installation convenience: the focused
packages still own their behavior and can also be installed separately.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

A **subpath import** names one part of a package, such as `@okikio/utils/result`. A **leaf package** is the
corresponding focused package, such as `@okikio/result`. The umbrella provides a bridge to it rather than another
implementation.

| Consumer needs                | Import                            | What it selects            |
| ----------------------------- | --------------------------------- | -------------------------- |
| Success/failure values        | `@okikio/utils/result`            | The focused Result surface |
| Record keys                   | `@okikio/utils/collection/record` | The focused Record surface |
| Suite membership              | `@okikio/utils`                   | A lightweight inventory    |
| Every namespace intentionally | `@okikio/utils/all`               | The eager complete facade  |

The table shows import selection, not a promise that any arbitrary bundler removes all unused code. The focused paths
keep runtime ownership clear; representative built consumers are checked separately as described below.

## Preserve every selected search filter

Read two values for the same search parameter through a focused umbrella import. The returned array preserves both
choices, just as the independently installed HTTP package does.

From a checkout of this experimental workspace, run `mise trust`, `mise install`, then `mise run prepare -- --kind deps` at the repository root. Save the following program as `example.ts` and run `mise exec -- deno run example.ts`. These commands use the workspace export maps; they do not assume a published registry version.

```ts runnable
import { parseQuery } from '@okikio/utils/http/request';

const incoming = new Request('https://service.invalid/search?tag=film&tag=music');
// The umbrella subpath preserves the focused parser's repeated-value behavior.
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

- **Build a small import tool:** use [CSV](../format/csv/README.md), [Streams](../streams/README.md), and
  [Context](../context/README.md) through their corresponding umbrella subpaths. CSV understands rows, Streams groups
  them, and Context carries the operation lifetime.
- **Publish a reusable parser library:** install only the needed [Codec](../schema/codec/README.md) or other focused
  package when the narrow dependency declaration is useful. Suite installation is optional; consumers retain direct
  public imports and the same contracts.

## What the umbrella adds under the hood

Both `@okikio/http/request` and `@okikio/utils/http/request` export the same `parseQuery` implementation. Choose the
first path with a focused dependency, or the second after installing the suite.

The generated umbrella module contains `export * from '@okikio/http/request'`. There is no wrapper callback, second
parser or extra context passed to the function. Its return remains the same readonly string/string-array record. The
root `packages` value is a frozen array of package names, while `PackageName` is the TypeScript union derived from those
literal names. These are inventory data, not registrations that start runtimes.

The benefit is installation and import organization. The focused packages own validation, cancellation, resources and
all other runtime behavior. Start with one useful function, then add another when the application needs it. Importing
the eager `all` facade is optional and reaches a much larger graph. See the [public source contracts](./mod.ts) for the
inventory and the focused README for the selected utility's actual behavior.

## Choose the dependency and import that fit the application

For example, use `@okikio/utils/collection/record` through the suite, or depend on `@okikio/collection` and import `@okikio/collection/record`. Keep every segment of a nested public path. Deep subpaths
preserve each focused export, including explicit polyfills and runtime adapters. The root inventory is lightweight; the
all facade is a deliberate eager choice. All packages are currently version 0.0.0 and experimental, so validate the
exact export and contract when upgrading.

[Choose related utilities by outcome](../../docs/07-outcomes.md). The sections below explain the remaining contracts and
variations. Examples that introduce application-owned clients or schemas are composition sketches; supply those
dependencies before running them.

## Copy settings without adopting a runtime

This focused facade uses only Collection's finite JSON contract. It acquires no resource and starts no work owner.

Save this complete variation as `copy-settings.ts` and run `mise exec -- deno run copy-settings.ts` after the same checkout setup.

```ts runnable=copy-settings.ts
import { copy } from '@okikio/utils/collection/record/json';

const input = { theme: 'light', tags: ['draft'] };
const saved = copy(input, { maximumNodes: 100, maximumStringCodeUnits: 1000 });
input.tags.push('edited');
console.log(JSON.stringify(saved));
```

```text output
{"theme":"light","tags":["draft"]}
```

The copy retains the earlier data. It is not a schema check for permitted themes and does not save to disk. Add Schema
for that business vocabulary or Storage for persistence only when those requirements exist.

## Choose a focused dependency as the application grows

A small consumer can install the umbrella and import one focused entry. A larger workspace can depend on the focused
packages while using the same programming model.

Choose a focused subpath for ordinary use. The all entry is an explicit broad facade; it is not required to use a single
utility.

The facade forwards implementations; it does not add a runtime, dependency injection owner, scheduler, or persistence
guarantee.

## Find every focused submodule

Every focused export is also available below `@okikio/utils/` with the same suffix. For example,
`@okikio/streams/reader` becomes `@okikio/utils/streams/reader`. The [package map](../../docs/01-packages.md) links all
26 implementation packages; each README lists every public submodule, including type-only and optional host entries.
There is no second implementation to learn.

## Measure the forwarding facade

The focused benchmarks measure 1 and 1,000 duration conversions through focused and forwarded entries. The benchmark
compares against the same focused function, with identity asserted. Warm calls cannot prove cold-import or bundle cost.
Those remain root artifact measurements.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
deno task --cwd=packages/utils test
deno task --cwd=packages/utils bench:check
deno task --cwd=packages/utils bench
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.

## Read further

The [Utils guide](https://github.com/okikio/utils/blob/main/docs/packages/22-utils.md) explains the model, manual
alternatives, and composition.
