# Choose utilities by the outcome you need

Start with the annoying job in your application. Choose the smallest mechanism that makes that job explicit, then add
the owners needed to run it. Every package below starts with a complete example, expected output and ways to extend it.
The `runnable` fence identifies a complete program through public imports; its following `output` fence records the
expected result. Unmarked fragments explain options and may require named application dependencies. Read the
[example convention](./composition.md#read-the-examples) before copying a fragment into a program.

The packages are experimental at version `0.0.0`. Native Web APIs remain useful: these utilities add explicit limits,
validated contracts, ownership or replay where a short built-in call does not capture the required behavior.

## Own and bound concurrent work

| Utility                                          | What changes for the caller                                                                                                                                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [duration](../packages/duration/README.md)       | Convert human-readable Temporal durations to one deterministic numeric value. A month needs a calendar anchor; repeating that decision across queues, retries and timeouts produces inconsistent answers.                    |
| [dispose](../packages/dispose/README.md)         | Dispose owned values in a predictable order while preserving both the operation failure and any cleanup failure. Hand-written finally blocks often skip later cleanup when one callback throws.                              |
| [context](../packages/context/README.md)         | Give nested work one cancellation signal, deadline, clock and cleanup owner. Passing separate signals and timers through every call otherwise makes it easy to outlive the caller or forget a temporary resource.            |
| [task](../packages/task/README.md)               | Control one process-local operation with cooperative pause, cancellation and joined cleanup. A Promise alone cannot request a pause or communicate whether cancellation and resource disposal have finished.                 |
| [concurrency](../packages/concurrency/README.md) | Bound active asynchronous work while choosing whether consumers need input order or completion order. Promise.all starts every operation immediately and gives cancellation no ownership over admitted siblings.             |
| [capacity](../packages/capacity/README.md)       | Reserve several scarce resources together. Separate counters can admit half of a request and leave work holding a browser while it waits forever for an upload slot.                                                         |
| [pool](../packages/pool/README.md)               | Reuse a bounded set of expensive resources while retaining explicit lease ownership. Opening a connection for every request wastes setup work; sharing one connection without leases can interleave incompatible operations. |
| [queue](../packages/queue/README.md)             | Give queued work an expiring claim and fenced completion. Removing an item from an array loses it when a worker dies; leaving it in place without a claim permits concurrent duplicate ownership.                            |
| [streams](../packages/streams/README.md)         | Consume asynchronous data with explicit item, byte and line budgets. A successful Array.fromAsync can still exhaust memory if the source never ends or one record is enormous.                                               |
| [resilience](../packages/resilience/README.md)   | Describe timeout, retry and admission policies as inspectable values before a host applies them. Putting retry loops around every call can repeat unsafe side effects and hide who owns the timer or storage.                |

## Name contracts and authority

| Utility                                          | What changes for the caller                                                                                                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [record](../packages/record/README.md)           | Inspect plain data records without accidentally invoking hidden getters or trusting inherited configuration. Object.keys plus direct reads can execute accessors and silently ignore properties that validation never saw.      |
| [catalog](../packages/catalog/README.md)         | Keep one canonical set of imported definitions and select subsets without losing exact object identity. A map keyed only by strings can silently replace a permission or response with a different same-ID definition.          |
| [schema](../packages/schema/README.md)           | Use one Standard Schema validation call across validator libraries. Reading a validator-specific result shape in every utility otherwise forces consumers to use the same schema engine.                                        |
| [result](../packages/result/README.md)           | Represent an expected success or failure as data and force call sites to choose a branch. Throwing for every missing value makes ordinary control flow indistinguishable from an unexpected provider fault.                     |
| [failure](../packages/failure/README.md)         | Give expected rejection a stable identity and validated data that can cross a process or storage boundary. Catching every Error by message makes a renamed sentence change application behavior.                                |
| [fault](../packages/fault/README.md)             | Project unexpected errors into bounded diagnostics without retaining the live object or invoking user getters. JSON.stringify(Error) usually drops the message; arbitrary coercion can execute application code.                |
| [requirement](../packages/requirement/README.md) | Keep declarations of required capabilities separate from the host that interprets them. Hard-coding a billing or permission SDK into each resource makes definitions impossible to inspect without starting that SDK.           |
| [permission](../packages/permission/README.md)   | Check exact capabilities and schema-validated targets through an explicit evaluator. A boolean on a context cannot express actor-specific checks or distinguish two independently authored same-name permissions.               |
| [entitlement](../packages/entitlement/README.md) | Declare which paid or enabled feature an operation requires without coupling its definition to a billing provider. Scattered plan-name comparisons otherwise make the same feature mean different things in different services. |
| [resource](../packages/resource/README.md)       | Create expensive dependencies once, borrow them through declared access and close them at their owner lifetime. Hand-built dependency bags make missing implementations, cycles and cleanup ordering hard to detect.            |
| [effect](../packages/effect/README.md)           | Represent an externally visible fact separately from delivery. Logging that a file was saved does not prove an outbox or billing ledger accepted that fact.                                                                     |
| [meter](../packages/meter/README.md)             | Record a validated usage fact through the same authoritative effect owner as the operation. Incrementing an in-memory counter cannot prove a billing or audit sink accepted the measurement.                                    |
| [telemetry](../packages/telemetry/README.md)     | Report correlated diagnostic events without letting a broken reporter fail the operation. Console messages have no shared correlation contract and cannot buffer the useful history preceding a failure.                        |

## Place work and resume it

| Utility                                    | What changes for the caller                                                                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [activity](../packages/activity/README.md) | Turn a provider operation into a named, versioned unit of work with validated inputs, results and engine placement. A plain function leaves every caller to repeat those checks and decide which runtime may run it. |
| [worker](../packages/worker/README.md)     | Call a standard Worker with validated, correlated requests instead of a hand-built postMessage listener. Correlation, reverse calls, cancellation and shutdown need distinct authority even when messages race.      |
| [process](../packages/process/README.md)   | Own subprocess termination and bounded output with one lifecycle contract across Deno and Node. A raw spawn plus scattered listeners can leave descendants alive or report success before output collection settles. |
| [workflow](../packages/workflow/README.md) | Resume a named sequence from recorded instruction completions and send activities to eligible executors. Retrying a long function from its first line can repeat expensive work and duplicate an external commit.    |

## Build a host and a service

| Utility                                | What changes for the caller                                                                                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [env](../packages/env/README.md)       | Parse configuration once into typed values and keep secret values out of diagnostics. Reading process.env throughout an application spreads defaults, coercion and validation across unrelated code.                         |
| [deno](../packages/deno/README.md)     | Express Deno permission grants as data and convert them to correctly escaped CLI arguments. Hand-built flags can accidentally grant a whole directory or mishandle paths containing commas.                                  |
| [http](../packages/http/README.md)     | Preserve HTTP syntax and trust decisions before application validation. Collapsing repeated query parameters or forwarding incoming credentials blindly changes what the caller asked for and what the next service can see. |
| [server](../packages/server/README.md) | Compose a portable fetch application from route and middleware values. A large if chain mixes routing, exception mapping and security headers, making it hard to mount the same service on another host.                     |
| [hono](../packages/hono/README.md)     | Reuse framework-neutral HTTP middleware around a Hono application. Reimplementing request correlation and response headers inside each framework makes the host contracts drift.                                             |
| [utils](../packages/utils/README.md)   | Install the suite once while importing only the focused surface a consumer needs. An eager namespace import can otherwise pull parsers, adapters and server implementations into a small program.                            |

## Read and represent external data

| Utility                                  | What changes for the caller                                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [csv](../packages/csv/README.md)         | Turn a messy spreadsheet export into bounded text rows with header evidence and diagnostics. Splitting on commas loses quoted commas, multiline cells, duplicate headers and byte-encoding errors.           |
| [html](../packages/html/README.md)       | Parse imperfect HTML and query it through one consistent tree adapter. A selector library and a parser with incompatible trees can silently return no matches even when the element exists.                  |
| [css](../packages/css/README.md)         | Extract stylesheet dependencies and feature evidence through a CSS parser. A regular expression cannot reliably distinguish a URL token from a quoted string, a comment or a nested rule.                    |
| [robots](../packages/robots/README.md)   | Apply user-agent-specific robots rules with overlap and wildcard semantics. Collecting every Disallow line mixes unrelated groups and cannot tell whether a more specific Allow rule wins.                   |
| [sitemap](../packages/sitemap/README.md) | Read sitemap, feed and text discovery sources through one record model. Looking for every XML loc element loses source kind, alternate links and malformed-document evidence.                                |
| [email](../packages/email/README.md)     | Normalize and classify email-domain evidence without inventing application policy. Comparing raw addresses or maintaining ad hoc domain lists makes casing and subdomain behavior inconsistent.              |
| [version](../packages/version/README.md) | Resolve release evidence by scheme and precision instead of trusting lexical order or whichever detector has the highest priority. A coarse version observation should not erase a compatible exact release. |
| [codec](../packages/codec/README.md)     | Describe both directions of a transport conversion together. Independent encoder and decoder functions easily drift when an API changes its timestamp format.                                                |

## Grow one useful job in stages

Begin with the [complete bounded import](./composition.md#import-rows-with-bounded-work), which validates two company
rows and stores their domain/name pairs. The [allowed-page example](./composition.md#discover-allowed-pages) combines
robots and sitemap data. Both mirror inspected consumer patterns with local inputs and an explicit result.

For an import that also enriches each row from a provider, add only the mechanisms its requirements need:

1. Parse a bounded input with `csv`, retaining the original column and row evidence. Use `streams.batch` for bounded
   writes. A naive comma split loses quoted cells; collecting an unbounded stream loses the memory budget.
2. Validate domain input with `schema`, then choose `result` or a declared `failure` for expected rejection. Reserve
   `fault` for unexpected diagnostics. A generic thrown string cannot tell a caller whether to fix input or report a
   provider incident.
3. Give the import a `context`. Derive deadlines for slow calls, use `concurrency` for bounded fan-out and `pool` when a
   provider resource can be reused. The caller now owns cancellation and cleanup through one lifetime rather than a
   collection of unrelated timers and connections.
4. Declare that provider as a `resource`, then declare an `activity` with its schemas, placement and requirements. The
   definition can be inspected without opening the provider. `permission` evaluates the current actor and target;
   declaration alone does not authorize the operation.
5. Compose activity requests in a `workflow` when partial progress must survive a retry. A history adapter records
   instruction completions; dispatch owns claims, attempts and fencing. Use `effect` when an authoritative sink must
   accept an external fact. A telemetry event is observation and cannot replace that acceptance.
6. Choose a local, `activity/worker` or `activity/process` provider. The scheduler and workflow keep their contract
   while the provider changes where the attempt runs. The provider sends validated data and correlated frames; it never
   serializes a live socket, JavaScript closure or cleanup stack.

The [activity example](../packages/activity/README.md) proves a local attempt. The
[workflow example](../packages/workflow/README.md) adds dispatch, history, scheduler and an eligible executor. The
[Worker example](../packages/worker/README.md) has both complete modules; the
[process example](../packages/process/README.md) starts a real child and collects bounded output. Read them in that
order when moving from one function to independent execution domains.

## What moving work actually means

An engine requirement selects an eligible executor capability. A provider owns one concrete Worker or process handle and
its transport. A workflow instruction and its input can cross that transport; its result comes back under the same
activity contract. An application can register providers for chosen threads or processes and make their eligibility
explicit.

Recovery is re-admission of a validated attempt under authoritative dispatch and history, rather than live migration of
the old JavaScript stack. The native [Worker restart scenario](../tests/restartable-worker.test.ts) terminates a Worker,
replaces it, fences stale completion and replays accepted history through fresh runtime owners. The
[process fan-out scenario](../tests/process-orchestration.test.ts) crashes a child, retries through a replacement host,
and fans results back in. They model history ownership without a deployed database; memory providers lose state when
their process exits. A durable backend must provide equivalent atomic claim and completion guarantees.

The abstraction can represent future host, cluster, pod and container placement. This repository currently implements
local execution, standard Workers and child processes. It supplies no Kubernetes scheduler, container migration or
deployed cross-machine storage adapter. Adding one requires explicit admission, transport, fencing, resource ownership
and failure tests at that boundary.

## When Temporal is missing

`@okikio/duration/temporal` exports a local Temporal ponyfill. Import it when the caller wants instant and calendar
arithmetic without changing global objects. `@okikio/duration/polyfill` installs it only when the host has no Temporal
global. Import that entry before the lifecycle packages when the host needs their global Temporal contract. Each Worker
and child process has its own realm and needs its own application setup. The same optional entries are available through
`@okikio/utils/duration/*`.

This enables deadlines, logical clocks, queue expiry and workflow timing on a missing-global host. It does not make a
queue durable or a calendar month a fixed number of milliseconds. The [duration guide](../packages/duration/README.md)
shows both forms and explains the calendar anchor and ownership limits.

## Evidence and changes

For local cleanup without global installation, import `DisposableStack`, `AsyncDisposableStack`, `SuppressedError` and
the protocol keys from `@okikio/dispose/ponyfill`. This makes cleanup order and failure preservation available on a host
that lacks native constructors. The [disposal guide](../packages/dispose/README.md) starts with one owned stack, then
shows how to release a CSV input reader with other utilities. Ambient lifecycle packages still need their explicit
application setup when they rely on missing globals.

Read [testing](./testing.md) for behavioral and type contracts, [benchmarks](./benchmarks.md) for measured workloads,
[runtime boundaries](./runtime.md) for portability and ownership, and [comparison decisions](./comparison.md) for why
consumer changes were retained or omitted. The [cross-repository review](./utils-review-20261006.md) preserves the
2026-10-06 counts and validation receipt; current qualification commands and limitations are recorded separately.
