# 11 — Wait for an event

An import may need approval after validation. A research run may need a callback from an external service. The workflow
should stop at that point. It should continue when the matching event arrives.

`wait(Approved, { key })` describes that wait once `Approved` declares its value shape. `client.send()` saves a delivery for a durable run. The existing `signal()`
function declares the event's name and value schema. It does not deliver anything by itself.

For an ordinary event inside one running process, use Observables directly. No workflow is needed:

```ts runnable
import { createEventDispatcher, waitForEvent } from '@okikio/observables';

const events = createEventDispatcher<{ approved: boolean }>();
try {
	const waiting = waitForEvent<{ approved: boolean }, 'approved'>(events, 'approved');
	events.emit('approved', true);
	console.log(await waiting);
} finally {
	events.close();
}
```

```text output
true
```

The listener must exist before delivery. Its subscription ends when the event arrives, the bus closes, or the supplied
`signal` aborts. This wait and any replay buffer are process-local.

Use the workflow adapter when local work also needs run/key matching and retained early delivery. The adapter uses
Observables' dispatcher and `waitForEvent()` for live notifications. It adds a bounded inbox, schema checks, duplicate
checks, and workflow deadlines. PostgreSQL provides the separate saved inbox for restart recovery.

The import has three possible answers: approved, rejected, or expired. In the complete local flow below:

1. `Approved` declares the boolean message; `Import` declares input and result shapes.
2. The inbox saves `true` at run `import:42`, event `import.approved`, key `review` before execution starts.
3. `workflow.run` steps through the generator. `yield* workflow.wait(...)` asks the scheduler for that address.
4. The inbox supplies its retained value, the generator returns `approved`, and the ordinary outer `await` receives it.

`yield*` pauses a generator at an instruction. It is how the scheduler sees the wait; it does not keep an async function
alive in a durable worker. Context owns local cleanup, the inbox owns addressed messages, and the scheduler connects
the program to that inbox. These memory owners disappear with the process.

After `mise run prepare -- --kind deps`, save this block as `approval.ts` and run
`mise exec -- deno run approval.ts`. No database or service is required:

```ts runnable
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as schema from '@okikio/schema';
import * as context from '@okikio/context';
import * as workflow from '@okikio/workflow';

const Approved = workflow.signal({ id: 'import.approved', value: schema.boolean() });
const Import = workflow.define({
	id: 'import.review',
	version: '1',
	input: schema.object({ until: schema.string() }),
	result: schema.oneOf(['approved', 'rejected', 'expired']),
});
const Review = workflow.implement(Import, function* (ctx) {
	const approval = yield* workflow.wait(Approved, { key: 'review', until: ctx.input.until });
	if (approval.type === 'timeout') return 'expired';
	return approval.value ? 'approved' : 'rejected';
});

await using owner = context.create({ id: 'example' });
using inbox = workflow.events({ capacity: 10 });
await using scheduler = workflow.scheduler({ events: inbox });
await using ctx = await workflow.context({
	definition: Import,
	input: { until: '2099-01-01T00:00:00Z' },
	runId: 'import:42',
	ctx: owner,
});
// Delivery can happen before the workflow reaches the wait.
await inbox.send(ctx.runId, Approved, true, { key: 'review' });
console.log(await workflow.run({ ctx, implementation: Review, scheduler }));
```

```text output
approved
```

The delivery address contains the run, event name, and logical key. Use a different key for each separate approval or
callback. Two instruction positions cannot consume the same address. This is one delivery per logical wait, not a
broadcast channel or an unbounded event stream.

The value is checked against the event schema. The event result has two forms: `{ type: 'received', value }` and
`{ type: 'timeout' }`. A received `undefined` value remains distinguishable from a timeout. Use schemas that accept
their saved representation through an explicit codec when it differs from the application value.

## Use a saved wait

The [worker fixture](../../tests/workflows/scenarios/events.ts) lists the definitions, policy, resources, engine,
capacity, and worker setup. It is executable source used by the recovery suite. In an application service, use the same
definition and policy with a PostgreSQL store:

```ts
import postgresjs from 'postgres';
import * as postgres from '@okikio/storage/workflow/postgres';
import * as workflow from '@okikio/workflow';
// Application declarations. See the complete fixture linked above for its policy.
import { Approved, Import, Policy } from './definitions.ts';

const sql = postgresjs(databaseUrl);
try {
	await using store = postgres.open({ database: sql, namespace: 'imports' });
	const client = workflow.client({ store, policy: Policy });
	const ref = await client.submit(Import, { until: approvalDeadline }, {
		scope: accountId,
		key: requestId,
	});
	// A later authorized request or callback uses the saved reference.
	await client.send(ref, Approved, true, { key: 'review' });
} finally {
	await sql.end();
}
```

The application owns authorization, the saved reference, callback authentication, and the deadline. Possessing a
reference is not an authorization check. The service must check the account before accepting or sending work.
`client.send()` currently commits its own store transaction. It is not part of the `client.in(tx)` view.

Run `postgres.migrate({ database: sql })` as an explicit deployment step before starting this version's workers. It adds
the event inbox, report storage, and instruction fields. Store readiness checks for these additions. The workflow policy
can require `workflow.events`. This describes adapter support; it does not prove that an external callback service is
online.

The worker saves the wait and releases its workflow slot. No activity slot or live subscription is held while the run
waits. An event accepted before the wait is retained. An event accepted after the wait saves its result and makes the
run eligible to continue. The sender needs no live worker. A replacement reads the saved result and continues the
workflow.

Use an absolute `until` value from saved input or an earlier recorded instruction. Do not calculate a new deadline from
the wall clock each time the generator runs. Replay checks the event name, key, and deadline. Changing them for a saved
instruction causes a replay conflict. Omit `until` only when an indefinite wait is intentional.

PostgreSQL serializes delivery and timeout changes for the same run. Its clock determines receipt and expiry. An early
event counts only if it was saved by the deadline. A new delivery after a saved wait expires is rejected. The worker's
recovery scan records timeout and resumes the workflow. If every worker is down, the deadline still expires, but the
workflow continues only after a worker returns.

Sending the same value to the same address again succeeds without a second delivery. Sending a different value
conflicts. A new delivery to a terminal or blocked run is rejected. An already accepted duplicate remains idempotent
after completion. Cancellation stops the run; it does not undo previously accepted events or business writes.

## Limits and recovery

Saved events and instruction results count against `historyBytes`. Early events are bounded too. Oversized delivery
rejects before it commits. Keep callback values small. Store a stable object reference when the callback refers to large
data. The retention policy describes preservation obligations; it does not install an automatic deletion service.

The local inbox has different storage ownership. Its capacity counts all retained addresses, including completed and
timed-out waits. Closing it releases local waiters and clears memory. Process loss clears the inbox. Supply the same
clock to the inbox and scheduler when using a test clock.

The deprecated `wait(signal, input)` signature remains available for custom local command handlers. The PostgreSQL
service does not implement that general custom command. Use `wait(Approved, { key })` for the saved delivery contract
described here.

The [event recovery suite](../../tests/workflows/events.test.ts) kills worker processes. It checks early delivery,
delivery while the worker is down, timeout after replacement, changed duplicates, namespace checks, cancellation, and
storage limits. It uses PostgreSQL in Testcontainers. The existing
[container suite](../../tests/workflows/containers.test.ts) covers service and worker containers for the larger Core and
Intelligence scenarios.
