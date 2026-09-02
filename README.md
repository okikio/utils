# @okikio/utils

`@okikio/utils` is the shared home for generic TypeScript utility mechanics used across Okikio projects.

The monorepo contains 41 focused packages plus the `@okikio/utils` convenience package. The focused packages keep ownership and dependency boundaries precise; the umbrella gives applications a one-install path when that precision would only create dependency bookkeeping.

## Install once

For Deno and JSR-native projects:

```sh
deno add jsr:@okikio/utils
```

Then import only the capabilities the program needs:

```ts
import * as context from '@okikio/utils/context';
import * as queue from '@okikio/utils/queue';
import * as workflow from '@okikio/utils/workflow';
```

A project that wants the leaf dependency explicitly can install it directly:

```sh
deno add jsr:@okikio/queue
```

```ts
import * as queue from '@okikio/queue';
```

`@okikio/utils/all` exists for composition roots that intentionally want broad namespace access. It is not the preferred import for ordinary library code.

## Runtime model

Deno source is canonical. JSR publishes that source-native contract directly.

Node/npm is a projection of the capabilities that are truthfully portable. Stable `tsdown` emits ESM, CommonJS, and declarations into a staged npm workspace. Deno-only packages and subpaths are omitted rather than shimmed into a false compatibility claim. In particular, `@okikio/deno` remains Deno-only, while the npm form of `@okikio/utils/all` excludes its namespace.

The npm artifact is currently under qualification in issue #1 / PR #2; it is not yet part of the release workflow.

See [`docs/runtimes.md`](docs/runtimes.md) for the exact distribution boundary.

## What belongs here

This repository owns generic mechanics that remain meaningful outside one product:

- cancellation, clocks, and execution context;
- resource ownership and disposal;
- bounded concurrency, queues, pools, streams, and resilience;
- representation, validation, result, failure, and fault mechanics;
- HTTP/server middleware and service composition primitives;
- process and worker control;
- durable workflow mechanics;
- generic web parsing helpers such as CSV, HTML, CSS, robots, and sitemaps where the API remains product-neutral.

Product policy, application logging configuration, concrete providers, domain registries, CLI presentation, and deployment composition stay with the products that own them.

The initial source was reconciled from Kaiju Platform, Kaiju Crawl, and MediaD rather than copied wholesale from one tree. [`docs/merge-ledger.md`](docs/merge-ledger.md) records retained cross-project differences.

## Verify the repository

Mise owns tool versions and repository tasks:

```sh
mise install
mise run verify
mise run verify-npm
mise run bench-smoke
```

`verify` covers the canonical Deno source, package/release audits, and cross-project scenarios. `verify-npm` builds and exercises staged Node artifacts. `bench-smoke` executes representative Mitata stories without unstable performance thresholds.

Read [`docs/testing.md`](docs/testing.md) for the test model and [`docs/benchmarks.md`](docs/benchmarks.md) for benchmark rules.

## Packages and composition

See [`docs/packages.md`](docs/packages.md) for the complete inventory and [`docs/composition.md`](docs/composition.md) for dependency direction and import guidance.

## Releases

Bumpy bump files are the source for semantic release intent and changelog prose. Leaf packages receive focused changelogs; `@okikio/utils` aggregates the user-facing summaries of leaf changes so single-install consumers can understand one release surface.

JSR publication is wired today. npm publication remains disabled until the staged tsdown artifact, clean-consumer tests, package linters, and lockfiles are fully qualified.

See [`docs/releases.md`](docs/releases.md) for the release model.
