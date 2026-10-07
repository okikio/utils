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
Focused and umbrella imports resolve to one implementation. Fresh installed ESM and CommonJS children check that pure
imports leave native, missing-constructor and missing-symbol globals unchanged; explicit `/polyfill` remains the
application-owned installer.

A normal import must not start a worker, connect to a provider, read environment configuration, configure logging, or
register mutable global state.

## Tree-shaking evidence

`sideEffects` metadata is not enough to prove tree-shaking. The repository uses `tools/check-treeshake.ts` to bundle
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

`tsdown.config.ts` defines the staged npm projection with ESM and CommonJS output. Unbundled source-module granularity
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

- canonical workspace and Deno source export maps agree
- staged npm export maps preserve every supported source subpath and explicitly exclude runtime-specific adapters
- every public export target exists
- side-effect metadata matches import-time behavior
- focused and umbrella imports resolve to the intended modules
- representative consumer bundles remove unused modules
- declaration entry points resolve correctly
- package contents exclude unintended source or validation files
- the exact delivered artifact matches the files that were verified

`tools/check-packaging.ts` checks package structure. `tools/sync-utils-exports.ts` generates and checks umbrella export
parity. `tools/check-treeshake.ts` checks representative consumer bundles.

## Node and npm projection

Deno source and JSR exports stay canonical. The additional npm build reads their package metadata and stages independent
packages under `.artifacts/npm/`. It does not rewrite source manifests or flatten the focused implementations into the
umbrella.

```sh
mise run install
mise run npm-verify
```

CI bootstraps the tested mise 2026.10.3 manager. The runtime versions remain declared once in `mise.toml`; the action
manager pin controls that bootstrap, not a second runtime configuration.

The task uses the pinned stable tsdown release and its supported TypeScript 6.0.3 declaration API. Source and
installed-consumer type gates invoke the separate TypeScript 7.0.2 CLI alias explicitly. The pinned declaration plugin
marks its TypeScript 7 integration experimental; fail-on-warning remains enabled. Each member builds in a fresh serial
process so declaration graphs are released between packages. Each supported public subpath has an ESM JavaScript entry,
a CommonJS JavaScript entry, and declarations for both module formats. Workspace dependencies remain external and become
exact member versions in the staged manifests. Explicit polyfills retain side-effect metadata for their emitted files.

The source-only `@okikio/deno` package and `process/deno` and `worker/deno` adapters are excluded from npm. Their
umbrella subpaths are also excluded. The npm `utils/all` entry intentionally loads every supported npm namespace and
omits Deno. The lightweight npm root inventory likewise lists only supported npm members. This is a distribution
projection, not a second implementation or a replacement for those JSR capabilities.

`tools/npm.ts` checks every staged JavaScript and declaration target and rejects source runtime imports and hard Deno
dependencies. Optional `globalThis.Deno` detection in the environment source is retained because it does not require
Deno in Node. Build-time source copies are removed before packing. The task packs every staged member, checks actual
archive contents, extracts the exact archives, runs strict publint and Are the Types Wrong?, and writes SHA-256
receipts.

The empty consumer is created outside the checkout, so unresolved imports cannot fall back to workspace ancestors. Its
location is recorded in `.artifacts/npm/consumer-location.json`. It installs physical copies of those archives and
imports and requires every public subpath. It also type-checks every subpath from clean ESM and CommonJS consumers
without Deno ambient types, then runs CSV parsing, result matching, duration conversion and an owned Node subprocess
through the installed packages. Explicit unsupported imports must fail. Installed focused and umbrella result consumers
are bundled and executed; their module graphs must exclude unrelated adapters and their emitted implementations must
agree.

These checks qualify the configured Node version and package projection. A browser-selected bundle executed in a Node
Web API host remains bundle evidence, not an executed browser guarantee. npm publication is separate from artifact
qualification and is not performed by these commands.

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
ownership scenarios. It builds those test consumers into ESM and CommonJS while keeping every production package
external, then executes both formats against installed artifacts. Test code is reused; production source is never copied
into the clean consumer.
