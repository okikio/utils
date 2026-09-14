Packaging and tree-shaking
==========================

This guide helps maintainers preserve small consumer bundles while the Okikio
utility suite grows. The public package graph supports focused dependencies and a
single-install application dependency without duplicating implementations.

Public package layout
---------------------

A reusable package can depend on one focused package. An application can install
`@okikio/utils` once and import the matching deep subpath.

~~~~ text
focused dependency                 single-install dependency
@okikio/http                       @okikio/utils/http
@okikio/server                     @okikio/utils/server
@okikio/server/http/router         @okikio/utils/server/http/router
~~~~

Each focused package owns its source and public exports. The umbrella contains
generated re-export modules for those exports. A deep umbrella import must reach
the same implementation as the matching focused import.

The root `@okikio/utils` entry exposes suite inventory. `@okikio/utils/all`
loads the broad namespace graph intentionally. Application modules should prefer
focused subpaths unless they are composition roots that need many namespaces.

Import-time behavior
--------------------

Most packages declare `sideEffects: false`. That declaration is valid only when
module evaluation has no required observable effect.

The disposal polyfill is intentionally different. It changes the host runtime,
so the umbrella lists `./dispose/polyfill.ts` as side-effectful and keeps it
behind an explicit subpath.

A normal import must not start a worker, connect to a provider, read environment
configuration, configure logging, or register mutable global state.

Tree-shaking evidence
---------------------

`sideEffects` metadata is not enough to prove tree-shaking. The repository uses
`tools/check-treeshake.ts` to bundle representative consumers.

The check compares equivalent imports such as:

~~~~ text
@okikio/result
      and
@okikio/utils/result

@okikio/http/request
      and
@okikio/utils/http/request
~~~~

The test includes named imports and a namespace-import case. It catches eager
barrels, unexpected initialization, and umbrella imports that retain unrelated
modules.

A release report should keep bundle evidence separate from runtime benchmark
results. A smaller bundle does not prove faster request handling, and a faster
router does not prove that unused modules disappear from an application bundle.

Build output
------------

`tsdown.config.ts` emits neutral ESM with unbundled source-module granularity.
The output keeps independently removable modules available to downstream
bundlers. Tests, fixtures, and benchmarks are not runtime entry points.

Runtime JavaScript and TypeScript declarations have different performance costs.
Fine JavaScript granularity helps bundlers. Declaration size and generic
expansion affect editor and type-check performance. Measure these costs
separately before changing declaration bundling.

Dependency policy
-----------------

Generic packages should depend on protocols and focused foundational utilities.
They should not depend on a validator provider only to inspect its internal
schema representation.

Standard Schema owns validator interoperability. Standard JSON Schema owns a
validator's input and output schema projections. Current Zod releases expose
that protocol directly, so `@okikio/schema` does not need a Zod runtime
dependency only to generate an OpenAPI schema.

Provider-specific adapters are appropriate when they expose behavior or metadata
that the common protocol does not represent.

Release checks
--------------

A packaging change is verified against the produced artifact as well as the
working tree. The normal sequence is:

~~~~ text
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
~~~~

The release checks should confirm these properties:

 -  npm and Deno export maps agree
 -  every public export target exists
 -  side-effect metadata matches import-time behavior
 -  focused and umbrella imports resolve to the intended modules
 -  representative consumer bundles remove unused modules
 -  declaration entry points resolve correctly
 -  package contents exclude unintended source or validation files
 -  the exact delivered artifact matches the files that were verified

`tools/check-packaging.ts` checks package structure.
`tools/sync-utils-exports.ts` generates and checks umbrella export parity.
`tools/check-treeshake.ts` checks representative consumer bundles.
