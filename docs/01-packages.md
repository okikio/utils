# Find a package and its public submodules

Choose the task you want to finish, then follow one complete example. You can adopt one utility without learning the
whole workspace:

| Your task | First complete workflow |
| --- | --- |
| Preview and validate contact rows | [CSV](./csv.md), then [bounded import](./recipes/01-import.md) |
| Stop a download and release what it owns | [Context](./context/01-guide.md) |
| Receive a request and return JSON | [HTTP](../packages/server/http/README.md) |
| Save work that can recover after a worker exits | [Workflow](./workflows/01-basics.md) |
| Choose another capability | Use the package and guide tables below. |

This checkout has 27 packages. A subpath is the part of an import after the package name. For example, install
`@okikio/format` and import `@okikio/format/csv` to use just its CSV functions. The table shows those suffixes in the
second column. Start with the package README for a runnable example, then follow a guide when you need a larger task
or an exact limit. The numbers help you find pages; you do not need to read them in order.

## Consolidated package map

| Package                                        | Focused subpaths                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [Collection](../packages/collection/README.md) | `/catalog`, `/record`, `/record/json`, `/record/change`                                                           |
| [Context](../packages/context/README.md)       | root lifetimes, `/state`, `/events`                                                                               |
| [Duration](../packages/duration/README.md)     | `/units`, `/conversion`, `/instant`, `/temporal`                                                                  |
| [Query](../packages/query/README.md)           | root typed definitions, `/expression`, `/pagination`, `/url`                                                      |
| [Input](../packages/input/README.md)           | `/commands`, `/keys`, `/pointer`, `/gestures`, `/text`, `/forms`, `/files`, `/clipboard`, `/gamepad`, `/feedback` |
| [Scheduler](../packages/scheduler/README.md)   | `/capacity`, `/queue`, `/concurrency`                                                                             |
| [Capability](../packages/capability/README.md) | `/resource`, `/requirement`, `/effect`, `/resilience`, `/execution`                                               |
| [Worker](../packages/worker/README.md)         | `/thread`, `/process`, `/protocol`                                                                                |
| [Format](../packages/format/README.md)         | `/csv`, `/sitemap`                                                                                                |
| [Storage](../packages/storage/README.md)       | `/queue`, `/queue/postgres`, `/workflow`, `/workflow/postgres`                                                    |
| [Runtime](../packages/runtime/README.md)       | `/deno/*`, `/node/*`, `/bun/worker`, `/browser/worker`                                                            |
| [Result](../packages/result/README.md)         | root results, `/failure`, `/fault`                                                                                |

Duration and Dispose remain focused packages. Context composes their time and cleanup lifetimes without hiding imports.
The capability guide table below keeps the detailed chapters accessible after the package moves.

| Package                                                     | Guide                                    | Why this depth                                                              |
| ----------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| [activity](../packages/activity/README.md)                  | [Guide](./activity.md)                   | A named job with checked input and output                                   |
| [capacity](../packages/scheduler/capacity/README.md)        | [Guide](./capacity.md)                   | Reserve room before starting work                                           |
| [catalog](../packages/collection/catalog/README.md)         | [One page](./packages/01-catalog.md)     | Select named definitions without owning their runtime.                      |
| [concurrency](../packages/scheduler/concurrency/README.md)  | [Guide](./concurrency.md)                | Bound active work without collecting every input                            |
| [context](../packages/context/README.md)                    | [Guide](./context/01-guide.md)           | Give related work a shared lifetime                                         |
| [csv](../packages/format/csv/README.md)                     | [Guide](./csv.md)                        | Keep source bytes distinct from interpreted rows                            |
| [deno](../packages/runtime/deno/README.md)                  | [One page](./packages/04-deno.md)        | Translate declared permissions into Deno arguments.                         |
| [dispose](../packages/dispose/README.md)                    | [Guide](./dispose.md)                    | Give cleanup one owner                                                      |
| [duration](../packages/duration/README.md)                  | [One page](./packages/05-duration.md)    | Construct units, convert elapsed time, and handle calendar-relative values. |
| [effect](../packages/capability/effect/README.md)           | [Guide](./effect/01-guide.md)            | Deliver business announcements and timestamped usage facts                  |
| [env](../packages/env/README.md)                            | [Guide](./env.md)                        | Separate raw configuration from validated options                           |
| [failure](../packages/result/failure/README.md)             | [One page](./packages/08-failure.md)     | Declare expected domain failures and their data.                            |
| [fault](../packages/result/fault/README.md)                 | [One page](./packages/09-fault.md)       | Bound unexpected diagnostic values before reporting them.                   |
| [hash](../packages/hash/README.md)                          | [One page](./packages/10-hash.md)        | Hash exact bytes and derive reproducible compact IDs.                       |
| [hono](../packages/hono/README.md)                          | [One page](./packages/11-hono.md)        | Adapt an existing Hono application to the server contract.                  |
| [http](../packages/http/README.md)                          | [Guide](./http/01-guide.md)              | Preserve wire meaning before applying application policy                    |
| [input](../packages/input/README.md)                        | [Guide](./input/01-collection.md)        | Collect values, bind interactions, observe changes, and provide feedback.   |
| [authz](../packages/authz/README.md)                        | [Guide](./authz/01-guide.md)             | Declare permissions, roles, and plan features; check access                 |
| [pool](../packages/pool/README.md)                          | [Guide](./pool.md)                       | Reuse a resource while preserving exclusive ownership                       |
| [postgres](../packages/storage/README.md)                   | [Guide](./postgres/01-workflow.md)       | Save workflow progress beside business state                                |
| [process](../packages/worker/process/README.md)             | [Guide](./process.md)                    | Own a child process and its streams                                         |
| [query](../packages/query/README.md)                        | [Guide](./query.md)                      | Describe an allowed query before applying it                                |
| [queue](../packages/scheduler/queue/README.md)              | [Guide](./queue.md)                      | Separate accepted work from a worker's attempt                              |
| [record](../packages/collection/record/README.md)           | [One page](./packages/15-record.md)      | Select record fields and apply bounded JSON changes.                        |
| [requirement](../packages/capability/requirement/README.md) | [One page](./packages/16-requirement.md) | Describe required capabilities and compare them to supplied values.         |
| [resilience](../packages/capability/resilience/README.md)   | [Guide](./resilience.md)                 | Choose whether and when another try is allowed                              |
| [resource](../packages/capability/resource/README.md)       | [Guide](./resource.md)                   | Declare a dependency separately from acquiring it                           |
| [result](../packages/result/README.md)                      | [One page](./packages/17-result.md)      | Return success or failure as an inspectable value.                          |
| [schema](../packages/schema/README.md)                      | [Guide](./schema/01-schema.md)           | Validate values and bidirectional conversions.                              |
| [server](../packages/server/README.md)                      | [Guide](./server/01-guide.md)            | Separate an API contract from its live host                                 |
| [sitemap](../packages/format/sitemap/README.md)             | [One page](./packages/21-sitemap.md)     | Parse sitemap entries under explicit input budgets.                         |
| [streams](../packages/streams/README.md)                    | [Guide](./streams.md)                    | Pass bounded data while respecting the reader                               |
| [task](../packages/task/README.md)                          | [Guide](./task/01-guide.md)              | Control one local operation and await its result                            |
| [telemetry](../packages/telemetry/README.md)                | [Guide](./telemetry/01-guide.md)         | Observe execution without owning its outcome                                |
| [utils](../packages/utils/README.md)                        | [One page](./packages/22-utils.md)       | Choose focused imports or the umbrella export.                              |
| [worker](../packages/worker/thread/README.md)               | [Guide](./worker.md)                     | Call code in another execution environment                                  |
| [workflow](../packages/workflow/README.md)                  | [Guide](./workflows/README.md)           | Follow service admission, saved work, workers, and crash recovery.          |

The workflow reading path additionally connects service admission, worker binding, SQL receipts, crash recovery, and
complete application examples. Start at [workflows](./workflows/README.md).

Use [telemetry design](./telemetry/03-design.md) to understand event reporting, tracing, metrics, and profiling. This
index is for readers. CI does not enforce a separate documentation coverage matrix.

For a result spanning several packages, choose a [workflow recipe](./recipes/README.md). Every package README now lists
all of its public entries, including the focused submodules omitted from this high-level table. Read those maps before
writing a replacement utility.
