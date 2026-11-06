# Packaging and tree-shaking

This guide helps maintainers preserve small consumer bundles while the Okikio utility suite grows. The public package
graph supports focused dependencies and a single-install application dependency without duplicating implementations.

## Public package layout

A reusable package can depend on one focused package. An application can install `@okikio/utils` once and import the
matching deep subpath.

```text
focused dependency                 single-install dependency
@okikio/http                       @okikio/utils/http
@okikio/server                     @okikio/utils/server
@okikio/server/http/router         @okikio/utils/server/http/router
```

Each focused package owns its source and public exports. The umbrella contains generated re-export modules for those
exports. A deep umbrella import must reach the same implementation as the matching focused import.

The root `@okikio/utils` entry exposes suite inventory. `@okikio/utils/all` loads the broad namespace graph
intentionally. Application modules should prefer focused subpaths unless they are composition roots that need many
namespaces.

## Import-time behavior

Most packages declare `sideEffects: false`. That declaration is valid only when module evaluation has no required
observable effect.

The disposal and Temporal polyfills change the host runtime. Focused packages and the umbrella list their exact polyfill
module files as side-effectful and keep them behind explicit subpaths. The source packaging gate validates those
declarations and physical files. Fresh-runtime compatibility tests and exact installed consumers separately verify their
actual setup behavior.

Both compatibility families have pure direct-import entries: `duration/temporal` exports local Temporal and
`dispose/ponyfill` exports local stack constructors and protocol keys. The disposal root exports those same bindings.
Focused and umbrella imports resolve to one implementation. Fresh installed ESM children check that pure
imports leave native, missing-constructor and missing-symbol globals unchanged; explicit `/polyfill` remains the
application-owned installer.

A normal import must not start a worker, connect to a provider, read environment configuration, configure logging, or
register mutable global state.

## Tree-shaking evidence

`sideEffects` metadata is not enough to prove tree-shaking. The repository uses `tools/packages/bundles.ts` to bundle
representative consumers.

The check compares equivalent imports such as:

```text
@okikio/result
      and
@okikio/utils/result

@okikio/http/request
      and
@okikio/utils/http/request
```

The test includes named imports and a namespace-import case. Each emitted consumer executes meaningful result, query, or
route behavior in Node. Retained focused-module graphs must agree after allowing the selected umbrella bridge; retaining
an unrelated capability fails. Bundle byte counts remain informational, without a fixed byte overhead or timing
threshold.

A release report should keep bundle evidence separate from runtime benchmark results. A smaller bundle does not prove
faster request handling, and a faster router does not prove that unused modules disappear from an application bundle.

## Build output

`tsdown.config.ts` defines the staged npm projection with ESM output. Unbundled source-module granularity
keeps independently removable modules available to downstream bundlers. Tests, fixtures, and benchmarks are not runtime
entry points.

Runtime JavaScript and TypeScript declarations have different performance costs. Fine JavaScript granularity helps
bundlers. Declaration size and generic expansion affect editor and type-check performance. Measure these costs
separately before changing declaration bundling.

## Dependency policy

Generic packages should depend on protocols and focused foundational utilities. They should not depend on a validator
provider only to inspect its internal schema representation.

Standard Schema owns validator interoperability. Standard JSON Schema owns a validator's input and output schema
projections. Current Zod releases expose that protocol directly, so `@okikio/schema` does not need a Zod runtime
dependency only to generate an OpenAPI schema.

Provider-specific adapters are appropriate when they expose behavior or metadata that the common protocol does not
represent.

## Release checks

A packaging change is verified against the produced artifact as well as the working tree. The normal sequence is:

```text
source checks
    |
    v
build or package
    |
    v
extract or install the exact artifact
    |
    v
repeat structural and consumer checks
```

The release checks should confirm these properties:

- authored focused-package source export maps agree with the generated Deno and umbrella exports
- staged npm export maps preserve every supported source subpath and explicitly exclude runtime-specific adapters
- every public export target exists
- side-effect metadata matches import-time behavior
- focused and umbrella imports resolve to the intended modules
- representative consumer bundles remove unused modules
- declaration entry points resolve correctly
- package contents exclude unintended source or validation files
- the exact delivered artifact matches the files that were verified

`tools/packages/check.ts` checks package structure. `tools/packages/exports.ts` generates and checks umbrella export
parity. `tools/packages/bundles.ts` checks representative consumer bundles.

## Node and npm projection

TypeScript is the implementation source for both distributions. Each focused package's `package.json` owns its public
source export map. `tools/packages/exports.ts` projects those decisions into Deno manifests and umbrella modules. Deno
manifests own JSR publication settings and imports; tsdown emits npm JavaScript and declarations from the same source.
The npm build stages independent packages under `.tmp/artifacts/npm/`. It does not rewrite source manifests or flatten
the focused implementations into the umbrella.

```sh
mise run prepare -- --kind deps
mise run test -- --suite packages
```

CI bootstraps the tested mise 2026.10.3 manager. The runtime versions remain declared once in `mise.toml`; the action
manager pin controls that bootstrap, not a second runtime configuration.

The task uses the pinned stable tsdown release and its supported TypeScript 6.0.3 declaration API. Source and
installed-consumer type gates invoke the separate TypeScript 7.0.2 CLI alias explicitly. The pinned declaration plugin
marks its TypeScript 7 integration experimental; fail-on-warning remains enabled. Each member builds in a fresh serial
process so declaration graphs are released between packages. Each supported public subpath has an ESM JavaScript entry and matching declarations. Workspace dependencies remain external and become
exact member versions in the staged manifests. Explicit polyfills retain side-effect metadata for their emitted files.

The `@okikio/runtime/deno` entry and all `/deno/*` adapters are excluded from npm, along with their matching umbrella
subpaths. The Runtime root and explicit Node, Bun and browser adapters are included. The npm `utils/all` entry loads
every supported npm namespace while omitting Deno-specific exports. This is a distribution projection, not a second
implementation or a replacement for those JSR capabilities.

`tools/packages/npm.ts` checks every staged JavaScript and declaration target and rejects source runtime imports and hard Deno
dependencies. Optional `globalThis.Deno` detection in the environment source is retained because it does not require
Deno in Node. Build-time source copies are removed before packing. The task packs every staged member, checks actual
archive contents, extracts the exact archives, runs strict publint and Are the Types Wrong?, and writes SHA-256
receipts. Each native command retains stdout, stderr and exit status under
`.tmp/artifacts/npm/commands/`, including failed installs and compiler checks.

The empty consumer is created outside the checkout, so unresolved imports cannot fall back to workspace ancestors. Its
location is recorded in `.tmp/artifacts/npm/consumer-location.json`. It installs physical copies of those archives and
imports every public subpath. It also type-checks every subpath from clean ESM consumers
without Deno ambient types, including the public inference fixture. It then runs CSV parsing, result matching, duration
conversion and an owned Node subprocess through the installed packages. Explicit unsupported imports must fail. Installed focused and umbrella result consumers
are bundled and executed; their module graphs must exclude unrelated adapters and their emitted implementations must
agree.

The archive build checks the configured Node version and package projection. The following behavior lane also runs
portable canonical tests against those installed archives in Deno and Bun. Deno uses the installed npm projection here;
its source-only `/deno/*` adapters remain covered by native source tests. A browser-selected bundle executed in a Node
Web API host remains bundle evidence, not an executed browser guarantee. npm publication is separate from artifact
checks and is not performed by these commands.

## npm registry setup

The focused packages retain their standard-library dependencies through JSR's npm compatibility layer. Recent pnpm
versions configure that registry automatically. npm consumers must configure the public `@jsr` scope in their project
`.npmrc` before installing the suite:

```ini
@jsr:registry=https://npm.jsr.io
```

This is the [documented JSR compatibility setup](https://jsr.io/docs/npm-compatibility). The clean archive consumer
writes that explicit project configuration and then installs the exact generated tarballs. It does not depend on a
maintainer's home registry settings. All workspace-owned focused packages still resolve to those physical installed
archives.

The packed behavior lane also reuses the repository's discovery, coordination, HTTP host, workflow and provider
ownership scenarios. It builds those test consumers into ESM while keeping every production package
external, then executes ESM against installed artifacts. The behavior runner also checks inferred public types
with Deno and runs its portable scenarios natively in Deno. Each run retains a unique evidence directory, including
failed command receipts. Test code is reused; production source is never copied into the clean consumer.

## Keep imports within their owner

A workspace resolves a utility by its package name and public export map. For example, a request parser imports
`@okikio/schema`; it does not walk into `../schema/mod.ts`. This keeps the dependency usable when the two packages are
installed in separate locations. Add the dependency to the consuming package's `package.json` as well as using its
public name. Deno resolves the named workspace member through its `deno.jsonc` exports.

| The importing code needs                    | Use                                                      | Where the mapping belongs                                             |
| ------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| Another utility's public behavior           | `@okikio/format/csv`                                     | The provider's exports and consumer's package dependencies            |
| A nearby implementation in the same package | `./reader.ts` or `../types.ts`                           | The relative module graph                                             |
| Repository benchmark and test machinery     | `#tools/bench/run.ts`, `#fixtures/http-parity/corpus.ts` | Root `package.json` imports and root `deno.jsonc` import-map prefixes |
| Another root benchmark fixture              | `#bench/fixtures/http-profile.ts`                        | The same root-only private mappings                                   |
| An artifact or document on disk             | A URL relative to `import.meta.url`                      | The code that owns the filesystem operation                           |

The private names identify their owner. They do not expose a utility API or replace a declared package dependency. Node
resolves them in the nearest package scope, so a workspace member cannot borrow the root's private map. Package
benchmarks own local fixtures and runners; the root collector launches them without becoming their dependency. Composed
benchmarks use `bench/` and its root-private tooling. A nested utility implementation can still use a relative path
within its own package; directory depth alone does not establish a dependency problem.

The npm map uses patterns such as `"#tools/*": "./tools/*"`. The Deno map expresses the same target with a prefix,
`"#tools/": "./tools/"`. Keep their targets aligned. Do not add TypeScript-only `paths` mappings: source execution in
Deno, Node, and Bun must resolve the same imports without a separate rewriting step. These root aliases do not enter the
published utility packages.

## Check JSR source separately from npm artifacts

Run `mise run check -- --kind jsr` before a release. This performs a workspace-wide
`deno publish --dry-run` without uploading anything. It checks the source dependency
graph and reports the publication file list. The release workflow repeats this on
the exact tested revision before registry publication.

Lifecycle event declarations live in `@okikio/telemetry/events`. Pool, Scheduler,
Worker, and Server retain their original type exports. The shared declarations let
Telemetry translate those events without importing their producers and creating
publication cycles. Moving an adapter while retaining a reverse re-export would
not remove such a cycle.

The publication gate requires [explicit public types](https://jsr.io/docs/about-slow-types) and runs without a slow-type
bypass. Keep precise reader and codec types when adding a schema: a broad
`schema.Schema` annotation can discard object field selection, defaulted inputs,
literal unions or the distinction between wire and application values.

This complete example retains both the validated value and the object shape used
by operations such as `schema.pick`. The type annotation describes the reader;
`schema.Output` continues to derive application data from it.

After the [checkout setup](../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`explicit-schema.ts` at that root, then run `mise exec -- deno run explicit-schema.ts`.

```ts runnable=explicit-schema.ts
import * as schema from '@okikio/schema';

/** A nonempty display label. Its length policy belongs to runtime validation. */
const LabelSchema: schema.JsonReader<string, string> = schema.string({ minLength: 1 });
/** Keep object metadata so consumers can select or extend this contract. */
export const ItemSchema: schema.ObjectReader<{ readonly label: typeof LabelSchema }, 'reject'> =
	schema.object({ label: LabelSchema });

const value: schema.Output<typeof ItemSchema> = ItemSchema.parse({ label: 'asset' });
console.log(value.label);
```

```text output
asset
```

`tests/publication.types.test.ts` protects defaulted inputs, required outputs,
selected fields, status unions, codec directions and saved workflow discriminants.
The installed-consumer check compiles the same fixture against emitted ESM declarations. The publication dry-run checks JSR declaration extraction;
it does not establish editor latency or a type-check performance budget.

JSR receives TypeScript source subpaths directly. Tsdown serves the additional
ESM npm projection. Sampo owns npm release versions and publication; Deno publishes JSR source in a separate job.
Testing npm archives does not publish them. See [releases](./03-releases.md) for the two-registry workflow.
