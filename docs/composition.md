Utility composition
===================

The Okikio utilities are small because each package owns one mechanism. A useful
application normally combines several of them at an explicit composition root.
Composition should make ownership clearer, not create a new umbrella runtime.

The rule is directional:

```text
application / reusable package
          |
          +--> focused utility
          |       |
          |       `--> smaller utility dependency
          |
          `--> another focused utility
```

`@okikio/utils` is only an installation convenience. Its subpaths re-export the
same focused packages.

Discovery example
-----------------

A web-discovery component can combine four independent utilities:

```ts
import * as concurrency from '@okikio/concurrency';
import * as context from '@okikio/context';
import * as robots from '@okikio/robots';
import * as sitemap from '@okikio/sitemap';

await using ctx = context.create({ id: 'discover-example.com' });
const policy = robots.parse(await fetchRobots(ctx));

for await (const records of concurrency.mapPooledUnordered({
  items: robots.getSitemapUrls(policy),
  concurrency: 4,
  signal: ctx.signal,
  async map(url, { signal }) {
    const response = await fetch(url, { signal });
    const found = [];

    await sitemap.parseStream({
      stream: response.body!,
      url,
      signal,
      onRecord(record) {
        found.push(record);
      },
    });

    return found;
  },
})) {
  for (const record of records) {
    if (robots.match(policy, { userAgent: 'KaijuBot', url: record.loc })) {
      await addCandidate(record.loc);
    }
  }
}
```

The ownership stays visible:

| Package | Owns | Does not own |
| --- | --- | --- |
| `context` | cancellation/deadline lifetime | HTTP or discovery policy |
| `concurrency` | bounded in-process admission | durable queue/retry state |
| `robots` | robots syntax and local rule matching | fetching/cache authority |
| `sitemap` | Sitemap/feed/text syntax | network or crawl admission |

Service example
---------------

A service can combine resource acquisition, a finite task, and bounded work:

```ts
import * as concurrency from '@okikio/concurrency';
import * as resource from '@okikio/resource';
import * as task from '@okikio/task';

const Database = resource.define<{ query(sql: string): Promise<unknown> }>({
  id: 'database',
});

await using resources = resource.create(Implementations, { host });

await using operation = task.start(async (ctx) => {
  const database = await ctx.get(Database);

  await concurrency.runBoundedQueue({
    items: domains,
    concurrency: 8,
    signal: ctx.signal,
    async run(domain) {
      await database.query(buildQuery(domain));
    },
  });
}, { resources, allowed: [Database] });

await operation.done;
```

`resource` owns how dependencies are acquired and released. `task` owns the
finite process-local operation lifetime. `concurrency` limits work inside that
lifetime. The application still owns the domain-specific query and result.

Diagnostics example
-------------------

Telemetry composes beside lifecycle utilities rather than becoming their owner.
A development host can retain detailed queue and Worker history while keeping
normal output quiet:

```ts
import * as telemetry from '@okikio/telemetry';
import * as lifecycle from '@okikio/telemetry/lifecycle';

const output = telemetry.memory();
const history = telemetry.buffer(output, { capacity: 64 });
const run = telemetry.create(history, {
  fields: { operation_id: 'research:example.com' },
});

using queueLogs = jobs.events.subscribe(
  lifecycle.queue(run, { queue_id: 'research' }),
);
using workerLogs = worker.events.subscribe(
  lifecycle.worker(run, { worker_id: worker.id }),
);

try {
  await executeResearch();
  history.discard('research:example.com');
} catch (error) {
  await run.report({
    name: 'research.failed',
    level: 'error',
    error,
  });
}
```

`queue` and `worker` still own their state. `telemetry` keeps only observational
records. The host can replace the memory reporter with a LogTape adapter,
OpenTelemetry-aware correlation, JSONL writer, test recorder, or remote exporter
without changing the queue or Worker implementation.

Durable work example
--------------------

When work must survive process loss, process-local concurrency is no longer the
correct abstraction by itself. A workflow can admit durable activity items while
independent executors own live runtime resources:

```text
workflow history
      |
      v
durable dispatch <---- executor ----> Worker/process provider
      |                    |
      |                    `--> context + resource lifetime
      v
item / claim / result
```

Use `@okikio/task` for one process-local operation. Use `@okikio/workflow` when
identity, history, retry, replay, or restart recovery must survive the process.
Use `@okikio/queue` for generic claimed work. Use
`@okikio/workflow/dispatch` when activity placement, executor generations, and
stored workflow-facing results must share one durable authority.

Choosing an import
------------------

Use `@okikio/<name>` when a reusable package wants an explicit minimal
dependency. Use `@okikio/utils/<name>` when an application installs the complete
suite but still wants focused imports. Use `@okikio/utils/all` only at a
composition root that deliberately needs the full namespace graph.

A focused import should remain import-safe. Runtime-specific surfaces such as
Deno, process, Worker, or Hono adapters stay explicit so a browser-safe utility
does not accidentally load unrelated host integrations.
