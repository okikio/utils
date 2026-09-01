# `@okikio/concurrency`

Concurrency primitives for running bounded asynchronous work without coupling the caller to a queue or worker implementation.

## Use

```ts
import * as concurrency from '@okikio/concurrency';
```

Use this package when the limit itself is the generic mechanism. Product-specific scheduling and admission policy belongs in the consuming package.
