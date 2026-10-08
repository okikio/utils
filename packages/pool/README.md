# `@okikio/pool`

Opening a database connection or browser page can cost more than one operation that uses it. `@okikio/pool` keeps a
limited set of reusable values and lends one to each caller. When all values are busy, another caller waits instead of
opening an unlimited number of resources.

A **lease** is a temporary loan. The pool owns the underlying value; the caller owns the lease and returns it after use.
This prevents two unrelated callers from accidentally using the same value at the same time.

```text
Pool owns at most 2 connections
       |
       +-> acquire -> caller borrows connection -> dispose lease -> idle again
       |
       +-> no available value -> caller waits, or acquisition fails

Dispose pool -> finish owned transitions and close its values
```

This shows borrowing and cleanup, not a database transaction or cross-machine connection broker. The application
supplies creation, health checks, and closing behavior for the actual resource.

## Save two notes through one reusable session

The explicit polyfill imports let this example run when the host lacks Temporal or disposal globals. An existing native
implementation is preserved.

```ts runnable
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
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
		create() {
			opened++;
			const pending = new Map<string, string>();
			return {
				stage(id: string, text: string): void {
					pending.set(id, text);
				},
				async commit(): Promise<void> {
					await Promise.resolve();
					for (const [id, text] of pending) saved.set(id, text);
					pending.clear();
				},
				close(): void {
					pending.clear();
					closed++;
				},
			};
		},
		close: (session) => session.close(),
	});
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

The supplied session is an offline transaction adapter: it stages writes, commits them to the `saved` Map, and clears
uncommitted work on close. It simulates a client API, not a database server or durable transaction. Two `save()` calls
start together, but the pool lends the only session to one caller at a time. The second waits, then reuses the returned
session. On this successful path, each commit clears the session's pending writes before the next borrower uses it.

The first output proves both notes were saved. `1 0` means one session was opened and no leases remain. The final `1`
means pool disposal called the client's close operation once. A real database adapter supplies connection creation,
commit, and close through the same callback boundary; it owns the actual transactional guarantees.

The fixture's commit cannot fail. With a real client, a failed commit may leave a transaction open or its outcome
unknown. The borrower must roll it back or reset it before returning the lease, according to the client's contract. If
the session cannot be proved safe for reuse, call `lease.invalidate(error)` before disposal so the pool closes it.
Returning a lease does not itself roll back a transaction, clear staged writes, or make an external commit atomic.

`create()` returns `Promise<Pool<Value>>`; `acquire()` returns `Promise<Lease<Value>>` for that session type. A lease
borrows the session until its block ends. Returning a lease permits reuse; disposing the pool closes the underlying
session. Keeping those actions separate lets a host amortize connection setup without allowing concurrent borrowers to
mix session state.

The Context passed here is the owner's cancellation signal, clock, and cleanup lifetime. An acquisition can use another
caller Context so one cancelled request stops waiting without cancelling the pool. `await using lease` returns the value
at the end of that block. `await using connections` closes retained values at the end of the pool's block.

| Contract               | Fields or methods that matter first                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `CreateOptions<Value>` | `ctx`, `maximum`, `create(ctx): Value \| Promise<Value>`, and `close(value): void \| Promise<void>`. |
| `Pool<Value>`          | `acquire(ctx): Promise<Lease<Value>>`, `stats()`, and `drain(): Promise<void>`.                      |
| `Lease<Value>`         | `value`, `acquiredAt`, `invalid`, and `invalidate(reason)`, plus async disposal.                     |

The pool keeps idle values, current leases, creation/closing transitions, and a FIFO waiter list. Acquisition first
tries an idle value, checks it if configured, and creates another value only when the total owned count permits it.
Lease disposal returns a healthy value to idle or closes an invalid value. A borrower should call `invalidate()` after a
failure only when that failure makes the underlying connection unsafe to reuse; an ordinary missing database row does
not necessarily mean a broken connection. The [contract reference](API.md) explains optional age and wait limits.

- **Check many pages with a few browser instances:** combine this pool with [Concurrency](../concurrency/README.md). The
  mapper limits admitted operations; each operation borrows a browser value from the pool and returns its lease.
- **Reuse Worker threads for conversions:** create and close [Worker](../worker/README.md) handles through pool
  callbacks. The pool owns handle lifetimes, the Worker protocol validates requests, and a
  [Context](../context/README.md) carries cancellation for each acquisition and request.

## Build on the example

Replace the example value with a database connection, browser page or Worker handle, then configure validation, idle age
and acquisition timeout. Release a lease after each use; close the pool at the owning host lifetime. The pool owns
created values while callers borrow leased values. A limit controls resource count, not queue-job authority or
distributed placement.

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

## Larger example

```ts
await using clients = await pool.create({
	ctx,
	minimum: 2,
	maximum: 8,
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

## Convenience and the manual equivalent

| Convenience                   | Manual equivalent                                                                                                            | Concrete value                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `pool.create()` + `acquire()` | track idle/leased/creating values, FIFO waiters, limits, abort/timeouts, provider create/health/close, and releases manually | resource reuse without losing ownership state              |
| `pool.drain()`                | wait for leases, creations, health checks, rejection cleanup, and close operations before resolving                          | shutdown cannot finish while pool-owned transitions remain |

`@okikio/pool` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics with arrays for idle
values, a Map for leases, counters for creation, FIFO waiters, AbortSignal cleanup, health checks, and explicit close
calls.

The utility exists because the difficult part is not storing reusable values. It is keeping ownership correct during
cancellation, creation, release, drain, and cleanup races.

## Expected acquisition failures

Two errors are deliberately part of normal pool control flow:

- `PoolAcquireTimeoutError` means an acquisition waited longer than its caller-selected timeout.
- `PoolUnavailableError` means the pool cannot supply another value under its current/closing state.

Both are preferable to silently exceeding the configured maximum.

## Source guide

Start with this README, then use the source in this order when you need more detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*.test.ts` files show edge cases, cancellation, invalid input, and lifecycle behavior as executable examples.
4. Read internal implementation files only when you need the exact state transition or performance-sensitive loop.

Read the [generated API reference](API.md) for the complete exported contracts and field descriptions.
