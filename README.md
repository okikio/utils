# @okikio/utils

`@okikio/utils` is the single source of truth for generic utility mechanics shared by my projects.

The repository contains 41 focused packages plus the `@okikio/utils` convenience package. A project can choose precision or convenience without maintaining another copy of the implementation.

## Install once

```sh
deno add jsr:@okikio/utils
```

Then import focused subpaths:

```ts
import * as context from '@okikio/utils/context';
import * as queue from '@okikio/utils/queue';
```

Or install a leaf package when dependency precision matters:

```sh
deno add jsr:@okikio/queue
```

```ts
import * as queue from '@okikio/queue';
```

## Ownership

This repository owns generic mechanics: cancellation and context, resource ownership, bounded streams and queues, validation and result models, HTTP mechanics, process/worker control, and workflow mechanics. Product policy and concrete providers stay in their product repositories.

The initial source was reconciled from current Kaiju Platform, Kaiju Crawl, and MediaD snapshots. `docs/merge-ledger.md` records every retained cross-project fix and the source hashes used for the extraction.

## Packages

See [`docs/packages.md`](docs/packages.md) for the complete package inventory and [`docs/composition.md`](docs/composition.md) for dependency direction and usage guidance.

## Validation

```sh
deno task check
deno task test
deno task bench
```

Each package also keeps its own `check`, `test`, and where applicable `bench` task so a focused change can be validated without running the whole workspace.

## Releases

Package changes are declared with Bumpy bump files. Bumpy creates focused leaf changelogs and `@okikio/utils` acts as the aggregate release digest for single-install consumers. Publication is JSR-only; npm publication is blocked by private package manifests.

See [`docs/releases.md`](docs/releases.md) for the complete version, changelog, and publication flow.
