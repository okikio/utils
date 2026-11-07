# Scheduler

Choose by the operation you need to perform:

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

| Task | Import | What you control |
| --- | --- | --- |
| Download many documents two at a time | `@okikio/scheduler/concurrency` | How many callbacks are in progress and which result comes next. |
| Start an upload only when memory and a connection are free | `@okikio/scheduler/capacity` | Reserve all required local limits together. |
| Leave an invoice calculation for another executor | `@okikio/scheduler/queue` | Retain a logical item and give one attempt temporary permission to finish it. |

Start with an ordinary function for one call. These modules do not create threads. A queue **claim** is temporary
permission for one item; its **lease** ends at an expiry time. The queue examples below introduce those rules with an
inspectable calculation. The root exports the three namespaces for applications that combine them.

From the repository root, run `mise run prepare -- --kind deps` once. Save the complete block as the named `.ts` file and run
`mise exec -- deno run invoice.ts`. These examples use workspace imports; they need no published package or network service.

An operation awaiting network input is still active. `await` lets other JavaScript
callbacks run, but does not release its mapper slot, capacity reservation or
resource borrow. Those limits protect different things and end at different
times. Choose separate workers for parallel CPU work; a synchronous loop still
occupies its thread.

The limits count different things. Keeping them separate prevents an awaited network call from accidentally releasing
the resource or job ownership it still needs:

| Capability | What remains counted | When it is released |
| --- | --- | --- |
| Concurrency | An admitted mapper call; ordered results can also occupy retained item slots | The applicable mapper/consumer acknowledgement completes, or joined cancellation finishes. |
| Capacity | Every unit in one granted reservation | That caller releases its lease, including after awaited work. |
| Queue | One attempt's permission to settle one logical item | Completion, failure, retry, cancellation or lease-expiry recovery changes queue ownership. |

Ordinary `await` releases none of those ownership rules by itself. A queue token from an expired or replaced attempt
cannot publish over the current attempt. None of these counters makes an external side effect repeat-safe.

## Claim and finish one local item

Add a number, claim its queued calculation, and complete it with twice that value. Looking up the result through the
original reference returns 42. This queue is in memory and needs no background service.

```ts runnable
import { queue } from '@okikio/scheduler';

await using jobs = queue.fifo(queue.memory<number, number>());

// Admission creates the logical item; it has no answer yet.
const ref = await jobs.add(21);

// Taking an item grants an attempt. The result remains pending until that attempt completes.
const attempt = await jobs.take();
if (attempt === undefined) throw new Error('Expected the queued item.');

// Commit this attempt's answer to the local queue; this example has no persistent store.
await attempt.complete(attempt.value * 2);

console.log(await jobs.result(ref));
```

```text output
42
```

## Bound work without introducing a queue

Use a mapper when values only need bounded local execution. These data URLs supply real document bytes without a network
service.

```ts runnable=focused-example.ts
import { mapPooledOrdered } from '@okikio/scheduler/concurrency';
const values = mapPooledOrdered({
	items: ['data:text/plain,first', 'data:text/plain,second', 'data:text/plain,third'],
	concurrency: 2,
	async map(url, { signal }) {
		const response = await fetch(url, { signal });
		if (!response.ok) throw new Error(`Document request failed: ${response.status}`);
		return (await response.arrayBuffer()).byteLength;
	},
});
console.log(JSON.stringify(await Array.fromAsync(values)));
```

Expected output:

```text output
[5,6,5]
```

The same operation is described in the [focused guide](./concurrency/README.md), including its ownership rules and
failure behavior.

## Choose bounded work, admission, or queued jobs

Four concurrent downloads need a mapper limit; an upload that needs memory and a connection needs capacity admission; an
invoice awaiting an executor needs a queue claim.

Use Concurrency for active callbacks, Capacity for atomic resource reservations, and Queue for logical ownership and
retries. Add Worker for another host and Storage for persisted claims.

None of these operations rolls back an external side effect. Memory queues lose state at process exit, and lease expiry
can permit another attempt.

Memory queue defaults admit 10,000 active items, retain 10,000 terminal records for 24 hours, and allow 1,000 local
waiting operations. Configure finite limits for your workload. Pruning ends the retained deduplication window; process
loss ends all memory state. Use the [PostgreSQL queue adapter](../storage/queue/postgres.ts) for persistent claims.
Neither expiry nor cancellation reverses an external write. The [queue guide](./queue/README.md) shows a replaced
invoice attempt rejecting an old result.

## Choose an entry point

Use the table to find a focused import for the job you need. Contract links open the exact public source, including its
options and types.

| Import                                  | Use it to                                                                | Exact contract                       |
| --------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------ |
| `@okikio/scheduler/capacity`            | Reserve several named local resources atomically.                        | [Contract](./capacity/mod.ts)        |
| `@okikio/scheduler/capacity/standard`   | Describe and validate capacity relationships through Standard Schema.    | [Contract](./capacity/standard.ts)   |
| `@okikio/scheduler/capacity/types`      | Import public types for this capability; this entry does not start work. | [Contract](./capacity/types.ts)      |
| `@okikio/scheduler/concurrency`         | Bound local asynchronous operations and choose result order.             | [Contract](./concurrency/mod.ts)     |
| `@okikio/scheduler/concurrency/bounded` | Use the focused bounded-mapping implementation.                          | [Contract](./concurrency/bounded.ts) |
| `@okikio/scheduler/concurrency/channel` | Coordinate producers and consumers with a bounded channel.               | [Contract](./concurrency/channel.ts) |
| `@okikio/scheduler/queue`               | Admit logical work and fence mutations with live claims.                 | [Contract](./queue/mod.ts)           |
| `@okikio/scheduler/queue/types`         | Import public types for this capability; this entry does not start work. | [Contract](./queue/types.ts)         |
| `@okikio/scheduler/queue/fifo`          | Use take/complete/retry operations over a claimed-work queue.            | [Contract](./queue/fifo.ts)          |
| `@okikio/scheduler/queue/policy`        | Validate queue admission, retention, and lease policy.                   | [Contract](./queue/policy.ts)        |
| `@okikio/scheduler`                     | Use the package entry shown in the complete examples above.              | [Contract](./mod.ts)                 |

The concurrency entry has a short bounded-map API for consumers that need results:

```ts
import { map } from '@okikio/scheduler/concurrency';
const output = map([1, 2, 3], (value) => value * 2, {
	concurrency: 2,
	maximumBuffered: 2,
	ordering: 'input',
});
console.log(await Array.fromAsync(output)); // [2, 4, 6]
```

`maximumBuffered` is required and must cover `concurrency`; this implementation uses the stricter concurrency limit for
all admitted items, including completed results awaiting consumer acknowledgement. It does not use a larger result
budget to admit extra work. Completion ordering uses the same acknowledgement rule, so a paused consumer stops further
admission once its slots are occupied. Breaking the loop cancels admitted mapper signals and joins their settlement. A
mapper that ignores cancellation can delay cleanup. These limits count items, not payload bytes.

Use `mode: 'settled'` with a mapper returning `Result<Value, Failure>` when missing items or rejected business decisions
are expected. Those results remain data and do not abort siblings. Source exceptions and mapper exceptions still stop
mapping; settled mode does not hide defects by converting every exception into a failure.

## Inspect and redrive retained queue items

```ts
import * as context from '@okikio/context';
import * as queue from '@okikio/scheduler/queue';

await using ctx = context.create({ id: 'operator' });
await using jobs = queue.memory<string, string>();

// Keep this source terminal so its old claims can never become current again.
const source = await jobs.add(ctx, 'resize');
await jobs.cancel(ctx, source);
const page = await jobs.inspect({ state: 'cancelled', limit: 20, maximumScanned: 100 });

// Redrive creates a distinct logical item; the required key deduplicates this operator request.
const replacement = await jobs.redrive(ctx, source, { key: 'operator-retry-1' });
console.log(page.entries, replacement.id !== source.id);
```

Inspection returns frozen metadata in admission order, with no input, output, failure or claim token. Pass a returned
cursor with the same state filter to continue. Each traversal captures an admission watermark; new additions are
excluded, while concurrent state changes and pruning remain visible. Empty filtered pages can have a continuation.
Memory counts examined admission positions, including pruned holes; PostgreSQL counts examined stored rows. Neither
count promises a hard database CPU or heap limit. Limits are 1–1,000 returned entries and 1–10,000 scanned
positions/rows, with the scan budget at least the result limit. Cursors are bounded, provider/queue/filter-bound
continuation data, not authorization or tamper-proof tokens. Memory cursors belong to one instance; PostgreSQL cursors
can cross views of the same namespace and contract.

Redrive copies a retained failed or cancelled item into a new logical identity at attempt zero, preserving input and
priority. Memory borrows the same input value; PostgreSQL copies its saved encoded input. The first new claim has
attempt one. The source stays terminal, and old claims remain stale. A required key makes concurrent copies idempotent
while the copy is retained; reusing an unrelated item's key rejects. Capacity still applies. Pruning ends reference
lookup and deduplication. A missing or already-pruned source rejects; operator authorization belongs to the service
exposing these methods.

## Measure scheduling and queue pressure

The mapping benchmark compares public `map()` with `mapPooledOrdered()` or `mapPooledUnordered()` at concurrency
1, 8 and 64. Both paths use the same ordering and consumer-acknowledgement rules and check exact output multiplicity.
An ordered slow first result can delay delivery even when later results are ready.

Queue cases measure add/claim/complete, bounded inspection pages and repeated-key redrive. The array FIFO reference
only enqueues and dequeues values; it omits validation, claims, leases and fenced completion. Inspection compares first
and continued pages of the same mixed-state queue. These memory measurements do not test database durability.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
deno task --cwd=packages/scheduler test
deno task --cwd=packages/scheduler bench:check
deno task --cwd=packages/scheduler bench
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.

## Reserve now without bypassing older work

`capacity.tryAcquire()` returns a lease or `undefined` synchronously. It never queues or partially reserves a request.
An older FIFO waiter prevents immediate admission even when the newer request uses otherwise idle resources. Impossible
requests and cancellation still throw. Release each successful lease exactly once; repeated release is harmless.

```ts runnable
import * as capacity from '@okikio/scheduler/capacity';
const host = capacity.create({ cpu: 1 }, { maximumPending: 0 });
const lease = capacity.tryAcquire(host, { cpu: 1 });
console.log(capacity.tryAcquire(host, { cpu: 1 }) === undefined);
lease?.release();
console.log(capacity.inspect(host, { cpu: 1 }, { maximumReasons: 1 }).status);
```

```text output
true
available
```

`inspect()` returns a bounded list of deficient resource names and distinguishes older queued work from unavailable
capacity. This snapshot reserves nothing and is not authority for a later request. The [source](./capacity/admission.ts)
and [benchmark](./capacity-immediate.bench.ts) preserve all-or-nothing admission.
