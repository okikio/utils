# @okikio/utils

Install the complete Okikio utility suite once, then import only the capability a program needs.

```sh
deno add jsr:@okikio/utils
```

```ts
import * as queue from '@okikio/utils/queue';
import * as csv from '@okikio/utils/csv';
```

The umbrella package depends on every focused `@okikio/*` utility. Its subpaths re-export those packages, so one dependency gives an application access to the whole suite without making every import evaluate the whole suite.

Use `@okikio/utils/all` only when a composition root deliberately wants all namespaces:

```ts
import * as utils from '@okikio/utils/all';

const controller = new AbortController();
void utils.context;
controller.abort();
```

The root `@okikio/utils` module intentionally exports only package inventory metadata. This keeps a harmless root import from loading Deno, Node, Hono, workflow, stream, and other optional/runtime-specific modules at once.

## Release history

This package's changelog is the aggregate view of leaf utility releases. A leaf package change propagates its semantic bump into `@okikio/utils`, and the umbrella entry carries the original user-facing summaries rather than requiring consumers to inspect every leaf changelog.
