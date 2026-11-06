# Place nested work and share host capacity

A deployment registers executors. A caller chooses required boundaries, and the
queue grants work only to an eligible executor with free capacity. This complete
in-memory example registers a thread under a process, container, pod, and node,
then claims one activity inside that pod. The labels describe trusted deployment
metadata; the example does not start infrastructure.

An **executor** is a registered host that may run work. An **engine** names the execution capability an activity needs,
such as a local JavaScript function or a supplied process provider. Placement narrows which registered executor may
claim a job; it does not create a process, open a network connection, or copy a live resource there. A required pod
keeps work within that pod. A preferred location is only a preference and cannot override a requirement.

In the program below, registration supplies this deployment metadata locally. The printed claim demonstrates selection,
not a real pod or thread launch.

After the [checkout setup](../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`example.ts` at that root, then run `mise exec -- deno run example.ts`.

```ts runnable
import * as context from '@okikio/context';
import * as workflow from '@okikio/workflow';
import * as dispatch from '@okikio/workflow/dispatch';

await using ctx = context.create({ id: 'placement-example' });
await using queue = dispatch.memory();

// Deployment supplies this trusted ancestry. Joining describes an executor;
// it does not create any of the named node, pod, container or native hosts.
const host = await queue.join(ctx, {
	engineId: 'analysis',
	hostId: 'executor-a',
	protocolVersion: 1,
	capacity: 4,
	activities: [{ id: 'analyze', version: '1' }],
	compute: {
		id: 'thread-a',
		generation: 1,
		parent: 'process-a',
		ancestors: [
			{ id: 'node-a', generation: 1 },
			{ id: 'pod-a', generation: 1, parent: 'node-a' },
			{ id: 'container-a', generation: 1, parent: 'pod-a', capacity: 2 },
			{ id: 'process-a', generation: 1, parent: 'container-a' },
		],
	},
});

// The required pod boundary intersects the executor path during admission.
// Origin identifies the logical workflow instruction independently of placement.
await queue.add(ctx, {
	activityId: 'analyze',
	activityVersion: '1',
	input: 'sample',
	context: context.snapshot(ctx),
	origin: {
		workflowId: 'example',
		workflowVersion: '1',
		runId: 'example',
		instructionPath: '0',
		instructionFingerprint: 'example-step',
	},
	placement: [{ engine: 'analysis', mode: 'required' }],
	location: workflow.placement.within({ id: 'pod-a', generation: 1 }),
}, { key: 'example-step' });

const [claim] = await queue.claim(ctx, host, { limit: 1, duration: 'PT1M' });
if (!claim) throw new Error('Expected an eligible claim.');
await queue.complete(ctx, claim, { type: 'success', value: { kind: 'undefined' } });
```

## Select and inherit a location

`workflow.placement.within(reference)` accepts descendants and the boundary
itself. `on(reference)` requires the exact registered leaf. `intersect(parent,
child)` combines requirements; a child cannot replace its parent's location.
Contradictory generations or exact targets throw before admission. Other
incompatible combinations remain queued until an eligible path exists. There
is no fallback outside a required boundary.

Pass `location` in activity options or child-workflow options. Wrap a local
program with `placement.scope(selection, program)` to apply requirements lazily
to its activity commands, child requests, parallel/race/map/retry branches, and
cleanup. A custom local child-command host must pass the child command's
location into the child program's scope. Logical ownership alone does not imply
physical colocation.

For saved execution, `client.trigger(definition, input, { scope, key, location })`
persists the root selection. The PostgreSQL store intersects child and successor
locations with the saved parent and applies the inherited selection to activity
jobs and cleanup. `workflow.serve({ ..., compute, affinity })` registers the
worker's path and scalar capabilities. Workflow activations may replay on any
compatible coordinator; the selection constrains their activity work. A parked
parent frees its activation slot while a child or saved wait is pending.

`placement.on(executor)` selects a registered executor. To choose one native
host inside its pool, use `placement.host(executor, hostReference)`. References
come from `provider.hosts()` or an activity's `ctx.physicalHost`. A selected busy
or lost host never falls back to a sibling. See [Physical hosts](./19-hosts.md)
for the complete example, identity, retirement and saved-work rules. A resource
such as a browser context still has its own [session lifetime](./18-sessions.md).

## Account for all capacity

| Limit | What holds a slot | When the slot returns |
| --- | --- | --- |
| Provider `maximum` | One physical Worker or child process | Physical host close/return follows pool policy |
| Provider `concurrency` | One complete activity attempt on a physical host | Result, cancellation, and attempt cleanup have joined |
| Provider `maximumWaiting` | One queued host acquisition | Grant, cancellation, timeout, or drain |
| Executor activity capacity | One claimed activity | Settlement or fenced expiry |
| Compute boundary `capacity` | Claimed attempts across descendant executors | Settlement or fenced expiry |
| Durable activation capacity | One running replay/advancement | Parking or settlement |

Worker and process providers default to `concurrency: 1`. Opt into a higher
value when implementations and their host resources permit sharing. With
`maximum: 2, concurrency: 4`, eight attempts may overlap across two hosts. Queue
acquisitions are FIFO and bounded; `maximumWaiting` defaults to that product.
A zero waiting budget permits available slots and rejects saturation.

Ordinary `await fetch(...)` retains its attempt slot, but another admitted
attempt can run on the same event loop. Set workflow engine binding capacity
and durable activity capacity consistently with provider capacity. The serving
module's `maximumRequests` defaults to 1000 and must cover the parent provider's
per-host concurrency. Pool statistics report physical hosts; `waiting` reports
queued acquisitions, not every in-flight activity.

A protocol fault or forced termination can lose all attempts sharing that host.
Cooperative cancellation is correlated per request; it joins cleanup before
returning the slot. Choose exclusive hosts for work that needs that failure or
resource isolation. Observation through EventTarget, Observables, and streams
remains separate from authoritative cancellation, leases, and terminal results.

Ancestor budgets are reserved atomically in memory and PostgreSQL. PostgreSQL
serializes placement admission and topology registration within one namespace;
this adds contention and SQL work compared with independent flat host checks.
There is no tenant-weighted fairness or CPU-time accounting guarantee. Pending
work does not consume a physical slot merely because its parent is waiting.

## Yield during CPU work

`await scheduler.yield(signal)` from `@okikio/scheduler` gives the host a timer
turn between bounded CPU chunks. It checks cancellation before and after the
turn. A resolved Promise alone can keep host events waiting in the microtask
queue. A yield retains the attempt and its resources. It does not preempt a long
synchronous call, release a durable claim, or move a live JavaScript stack.
Choose chunk sizes by cancellation latency and measured throughput. Use separate
executors for CPU isolation and saved workflow waits for durable suspension.

## Replace executors and migrate storage

Paths contain at most 64 boundaries, ordered root to leaf. Each boundary has a
stable namespace-local ID and positive monotonically increasing generation.
Changing parent or capacity requires a new generation. Replacing an ancestor
fences descendants still registered under its old generation; late results and
host renewals are rejected. Register descendants with the new path before
expecting them to claim replacement work. Legacy `parent` metadata without a
complete ancestry path cannot prove ancestor membership.

Registration is a trusted deployment operation, not authorization or automatic
infrastructure discovery. Keep IDs stable and bounded: retained generation
records prevent rollback after host departure. Names alone do not establish
that an executor is physically inside a container or pod. Deployment owns that
truth and starts/stops those resources. Kubernetes provisioning and resource
session recovery are outside this contract.

PostgreSQL schema revision **3** adds saved locations, activity affinity, and
compute registration records. Drain old workers, use `migrationStatus` and
`planMigrations`, then run the existing explicit migration procedure before
starting new workers. Do not mix schema revisions. Adding location or affinity
to an already recorded instruction changes its fingerprint; version workflows
when changing saved command requirements.

## Evidence and limits

Portable tests cover path validation, nested controls and cleanup, bounded FIFO
sharing, and generation fences. Native Deno fixtures exercise real Workers and
child processes, including overlap during I/O and forced shared-host termination.
PostgreSQL tests cover competing ancestor reservations, filtering before bounded
scans, child inheritance across store replacement, and stale result rejection.
Native Node tests now run parent → child → activity work on selected actual
threads and child processes in both memory and durable execution. The container
checks run those same physical hosts inside separate containers and
restarts a selected owner after the first activity commits. Saved progress is
reused; unfinished portable work receives a new resource instance. Owner-local
resource reuse and attempt cleanup are tested. The [resource-session tests](./18-sessions.md) separately cover saved
references returning to their exact owner. Forced termination can bypass a resource's own close method, so external
orphan recovery still belongs to the application. Pod ancestry remains registration metadata; no live Kubernetes
cluster is claimed.

For exact physical targeting within a multi-host provider, use the [host reference](./19-hosts.md) returned by that
provider. Registering one host per provider is also possible, but is not required. Node providers can pass
`create: (module, options) => native.create(module, { name: options.name })` from
`@okikio/runtime/node/worker` to the activity Worker factory. Keep the provider
alive until its borrowed scheduler or durable worker has stopped. See the
[testing guide](../maintenance/01-testing.md) for runnable test commands
and [capability checks](../maintenance/06-capabilities.md) for evidence limits.
Local implementation ledgers are not prerequisites for this workflow.

Stateful resources can now use the explicit [resource session contract](./18-sessions.md). Exact placement routes a reference; session authority controls borrowing and loss. Resource-specific reconstruction remains an application decision.
