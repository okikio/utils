# @okikio/utils

`@okikio/utils` contains generic TypeScript mechanisms shared across Okikio
projects. The workspace has 41 focused `@okikio/*` packages plus the
`@okikio/utils` installation package.

Focused packages own their implementation and dependencies. `@okikio/utils`
provides matching re-export subpaths for applications that prefer one dependency
declaration.

## Install

Deno and JSR are the canonical source and runtime model:

```sh
deno add jsr:@okikio/utils
```

Import the capability used by the current module:

```ts
import * as context from '@okikio/utils/context';
import * as queue from '@okikio/utils/queue';
import * as workflow from '@okikio/utils/workflow';
```

A reusable package can depend on a focused package directly:

```sh
deno add jsr:@okikio/queue
```

```ts
import * as queue from '@okikio/queue';
```

Use `@okikio/utils/all` only at a composition root that intentionally needs the
broad namespace graph.

## What the repository owns

The repository contains product-neutral mechanisms such as:

- execution context, cancellation, clocks, and disposal
- bounded concurrency, pools, queues, streams, and resilience
- schema, result, failure, fault, requirement, and permission mechanics
- HTTP, endpoint, service, gateway, process, activity, and workflow primitives
- generic CSV, HTML, CSS, robots, sitemap, email, and version utilities.

Applications own product policy, provider selection, global logging
configuration, CLI presentation, and deployment composition.

See [`docs/composition.md`](docs/composition.md) for dependency ownership and
composition rules.

## Service compilation

`@okikio/server` compiles endpoint, middleware, resource, requirement, response,
problem, and resilience definitions before traffic begins. The resulting
`CompiledService` contains a handler-free route plan and prepared operation
information that the Fetch runtime can consume directly.

```text
@okikio/http                 Web and HTTP protocol mechanics
        |
        v
@okikio/server               service compiler and Fetch runtime
        |
        +--> @okikio/hono    Hono host adapter
        +--> MCP adapter     protocol package or application adapter
        +--> gateway         network forwarding and trust policy
```

The service compiler remains independent of Hono and MCP. Protocol adapters use
Web `Request` and `Response` rather than changing endpoint definitions.

Read [`docs/server.md`](docs/server.md) for the compiler, request lifecycle,
prepared routing, request state, mounts, gateways, OpenAPI, and MCP transport
hosting.

## Schema and HTTP representations

Standard Schema is the validator interoperability contract. Standard JSON Schema
lets a validator describe accepted input and validated output. HTTP query syntax
and serialized responses can provide explicit wire schemas when those
representations differ from the validator's JavaScript values.

This separation keeps generated OpenAPI aligned with what an HTTP client sends
and receives, including schemas that coerce or transform values.

## Packages and tree-shaking

Applications can install `@okikio/utils` once while retaining focused imports:

```ts
import { parseQuery } from '@okikio/utils/http/request';
import { prepareRoutes } from '@okikio/utils/server/http';
```

The umbrella modules re-export focused package entries. They do not contain a
second implementation. Release checks compare representative focused and
umbrella bundles to catch eager barrels and import-time effects.

Read [`docs/packaging.md`](docs/packaging.md) for public subpaths, side-effect
rules, build output, tree-shaking evidence, and package-artifact checks.

## Tests

Package-local tests protect focused contracts. Root [`tests/`](tests/) contains
cross-package scenarios, public-import checks, and consumer flows.

```sh
mise install
mise run install
mise run verify
```

Read [`docs/testing.md`](docs/testing.md) for test placement and evidence rules.

## Benchmarks

Package-local benchmarks measure focused mechanisms. Root [`bench/`](bench/)
contains multi-package benchmark scenarios.

```sh
mise run bench
```

Read [`docs/benchmarks.md`](docs/benchmarks.md) for representative workloads,
reference implementations, and performance-reporting rules.

## Releases

Bumpy owns release intent, semantic version propagation, individual package
changelogs, version PRs, Git tags, and GitHub release notes. JSR publication runs
per workspace member. npm publication is disabled.

```sh
mise run release-check
```

Read [`docs/releases.md`](docs/releases.md) for the release workflow.

## Documentation map

- [`docs/composition.md`](docs/composition.md) explains package ownership and composition.
- [`docs/server.md`](docs/server.md) explains service compilation and request execution.
- [`docs/packaging.md`](docs/packaging.md) explains exports, tree-shaking, and artifact checks.
- [`docs/testing.md`](docs/testing.md) explains correctness and consumer tests.
- [`docs/benchmarks.md`](docs/benchmarks.md) explains performance evidence.
- [`docs/duplicates.md`](docs/duplicates.md) explains AST evidence, source-policy signals, and ownership review.
- [`docs/releases.md`](docs/releases.md) explains versioning and publication.
