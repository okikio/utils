# Reuse a resource while preserving exclusive ownership

Opening a database connection or a browser page can involve setup work. Opening a new one for every request repeats
that cost. Keeping one reusable value saves setup, but creates another question: what happens when two callers need it
at once? If that value supports only one active operation, giving it to both callers can mix their state.

A **pool** keeps a bounded set of reusable values. A caller borrows one through a **lease**, an object whose disposal
returns that borrow. The next caller can then reuse the value. Callers should dispose the lease rather than close the
underlying value themselves, because the pool may need it again.

When every value is busy, the pool waits within its configured bounds. When a lease returns, the pool either keeps
the value for reuse or closes it. At shutdown, the pool must also wait for callers to return their active leases.

Pooling saves acquisition cost but adds waiting and shutdown obligations. A borrowed client must not be closed by a
caller that does not own it.

## Save two notes through one reusable session

Two saves compete for a pool containing at most one session. Both notes are committed, only one session is opened, and
no lease remains after the saves. Exiting the pool scope closes that retained session.

Run from this checkout after `mise run prepare -- --kind deps`. Save the runnable block as a `.ts` file in your project and use
`mise exec -- deno run example.ts`.

```ts runnable
import * as context from '@okikio/context';
import * as pool from '@okikio/pool';
await using ctx = context.create({ id: 'connection-owner' });
const saved = new Map<string, string>();
let opened = 0;
let closed = 0;
{
	await using connections = await pool.create({
		ctx,
		maximum: 1,
		maximumWaiting: 32,
		/** Create one demo session with its own staged writes. This is not a real database connection. */
		create() {
			opened++;
			const pending = new Map<string, string>();
			return {
				/** Keep writes private to the leased session until commit. */
				stage(id: string, text: string): void {
					pending.set(id, text);
				},
				/** Publish the staged values to this demo's in-memory store before releasing the lease. */
				async commit(): Promise<void> {
					await Promise.resolve();
					for (const [id, text] of pending) saved.set(id, text);
					pending.clear();
				},
				/** Discard unfinished staged values when the pool closes the owned session. */
				close(): void {
					pending.clear();
					closed++;
				},
			};
		},
		close: (session) => session.close(),
	});
	/** Hold the exclusive lease through commit so concurrent callers cannot mix staged writes. */
	async function save(id: string, text: string): Promise<void> {
		await using lease = await connections.acquire(ctx);
		lease.value.stage(id, text);
		await lease.value.commit();
	}
	await Promise.all([save('note-1', 'Ada'), save('note-2', 'Lin')]);
	console.log(saved.get('note-1'), saved.get('note-2'));
	console.log(opened, connections.stats().leased);
}
console.log(closed);
```

Expected output:

```text output
Ada Lin
1 0
1
```

## Ownership and admission

The pool enforces minimum and maximum size, optional idle limits, idle age, and acquisition timeout. Acquisition is FIFO
when callers must wait.

A lease owns one borrowed value until disposal. Returning the lease either puts a healthy value back in the idle set or
closes an invalid value.

Cancellation is checked while a value is being created. If creation finishes after the caller has cancelled, the pool
closes that value instead of leaking it.

Draining stops new acquisition, waits for active leases, and closes retained values. Close failures are collected
without leaving waiters asleep forever.

## Drain is a lifecycle barrier

`drain()` does not mean "the idle array is empty." It is a lifecycle barrier. It resolves only after every pool-owned
transition that can still create, lease, inspect, reject, or close a value has settled. In particular, drain waits for:

- leased values;
- in-flight creation;
- a creation that resolves after drain starts and must be rejected/closed;
- asynchronous health checks that started during release;
- rejection cleanup and provider `close()` calls.

This rule is what makes process shutdown safe.

Read the following table as the life of one value, rather than four different values. A returned borrow can still be
using pool capacity while its health check or close operation runs:

| Stage | Who may use the value? | What must finish before shutdown can complete? |
| --- | --- | --- |
| Borrowed | The lease holder alone | The holder returns the lease. |
| Checking after return | The pool's health callback | The check accepts reuse or sends the value to close. |
| Idle | No caller; the pool retains it for reuse | Drain closes the retained value. |
| Closing | The pool's close callback | Actual close settles, including any failure. |

Creation is another pending operation: it may produce a value that drain must immediately close. Consequently,
`stats().leased === 0` is useful information but is not a shutdown receipt. Await `drain()` or pool disposal to join
all those transitions. The table omits acquisition validation and waiting callers, which cannot receive a lease after
draining begins.

## Supply the real client's creation, health and close operations

The earlier note program is complete and local. This configuration shows the later integration with a real client.
Here `ctx` is its owning Context, `connectClient(signal)` is your application factory, and `request` is the input accepted
by that client's `request()` method. Supply those three values before using this configuration. `ping()` must report the
real client's health; the pool cannot infer whether a socket or login session is still usable.

```ts
await using clients = await pool.create({
	ctx,
	minimum: 2,
	maximum: 8,
	maximumWaiting: 32,
	maximumIdle: 4,
	maximumIdleAge: { minutes: 5 },
	acquireTimeout: { seconds: 2 },
	create: (createCtx) => connectClient(createCtx.signal),
	check: (client) => client.ping(),
	close: (client, reason) => client.close(reason),
});

await using lease = await clients.acquire(ctx);
try {
	await lease.value.request(request);
} catch (error) {
	lease.invalidate(error);
	throw error;
}

await clients.maintain();
```

If you implemented this manually, you would need idle and leased collections, capacity counters, FIFO waiters, abort
listener cleanup, health checks, timeout logic, and shutdown fencing. The pool keeps those mechanics generic; the caller
still owns the meaning of `connectClient`, `ping`, and `close`.

## Ownership diagram

```text
Pool
  | owns
  +--> idle value
  +--> idle value
  +--> leased value ---- Lease ----> caller borrows
  |                         |
  |                         `-- dispose -> return or close
  |
  `-- drain()
       +--> reject waiters
       +--> close idle values
       +--> wait for leases
       `--> finish disposal
```

## Expected acquisition failures

Two errors are deliberately part of normal pool control flow:

- `PoolAcquireTimeoutError` means an acquisition waited longer than its caller-selected timeout.
- `PoolUnavailableError` means the pool cannot supply another value under its current/closing state.

Both are preferable to silently exceeding the configured maximum.

Read the [public source](../packages/pool/mod.ts) for the complete exported contracts and field descriptions.

## Decide which bookkeeping to keep in your application

| Convenience                   | Manual equivalent                                                                                                            | Concrete value                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `pool.create()` + `acquire()` | track idle/leased/creating values, FIFO waiters, limits, abort/timeouts, provider create/health/close, and releases manually | resource reuse without losing ownership state              |
| `pool.drain()`                | wait for leases, creations, health checks, rejection cleanup, and close operations before resolving                          | shutdown cannot finish while pool-owned transitions remain |

`@okikio/pool` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics with arrays for idle
values, a Map for leases, counters for creation, FIFO waiters, AbortSignal cleanup, health checks, and explicit close
calls.

The utility exists because the difficult part is not storing reusable values. It is keeping ownership correct during
cancellation, creation, release, drain, and cleanup races.

## Bound acquisition waiting

`maximumWaiting` is required in addition to `maximum`. It counts queued acquisitions, not leases or provider creation.
Use zero to reject blocked requests immediately. A full queue rejects with `PoolWaitLimitError`; cancellation, timeout
and drain release waiting slots. Existing callers must choose a finite bound based on their admitted request budget.
Activity thread/process providers explicitly allow one waiting caller per configured host.

## Return to one particular value

Call `select(ctx, value)` to borrow the same object again. The pool must find one match by `Object.is`.
If the object is busy or missing, the call fails right away. It does not create another object.

Call `retire(value)` to stop the pool from lending that object again. Retirement waits for current borrowers to
finish, then closes the object. Return your lease before awaiting retirement, or each call will wait for the
other. `values()` lists the pool's objects without giving you permission to close them. To pass a reference to a
native activity host, use the [physical-host API](./workflows/19-hosts.md).
