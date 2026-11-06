# `@okikio/pool`

Opening a database connection or browser page can cost more than one operation that uses it. `@okikio/pool` keeps a
limited set of reusable values and lends one to each caller. When all values are busy, another caller waits instead of
opening an unlimited number of resources.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

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

In the code below, `await` waits for acquisition to finish. `await using lease` also registers an automatic return when
the current block ends, even if the callback throws. Returning the lease makes the value available to another caller;
leaving the pool's own block closes the underlying values. Those are different operations.

A callback waiting for network I/O still holds its lease. Other JavaScript can run during that wait, but another caller
must not use the same exclusive connection until the first caller has finished and returned it.

## Borrow, return, and reuse one session

The pool creates reusable sessions; each caller borrows one through a lease. This offline session simply labels a note.
The counters make reuse and final closure visible without introducing a transaction API first.

From the repository root, run `mise run prepare -- --kind deps` once. Save the complete block as the named `.ts` file and run
`mise exec -- deno run borrow-session.ts`. These examples use workspace imports; they need no published package or network service.

```ts runnable=borrow-session.ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as pool from '@okikio/pool';
await using owner = context.create({ id: 'notes' });
let opened = 0, closed = 0;
{
	await using sessions = await pool.create({
		ctx: owner,
		maximum: 1,
		maximumWaiting: 1,
		create: () => ({ id: ++opened, label: (text: string) => text.trim() }),
		close() {
			closed++;
		},
	});
	// Each loop scope returns its lease, allowing the next iteration to reuse the same owned value.
	for (const note of [' Ada ', ' Lin ']) {
		await using lease = await sessions.acquire(owner);
		console.log(lease.value.id, lease.value.label(note));
	}
	console.log('Open:', opened, 'borrowed:', sessions.stats().leased);
}
// Exiting the pool scope closes the resource, rather than merely returning a lease.
console.log('Closed:', closed);
```

```text output
1 Ada
1 Lin
Open: 1 borrowed: 0
Closed: 1
```

Returning the lease keeps session 1 reusable. Ending the pool's block closes session 1. The next version adds real
staging in a Map so two callers can compete for that same session; it still uses no database server.

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
		maximumWaiting: 32,
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
not necessarily mean a broken connection. The [public source contracts](./mod.ts) explains optional age and wait limits.

`drain()` stops admission and waits for idle-value cleanup as well as active leases, creation and health checks.
Concurrent callers join the same shutdown; a lifecycle observer may request drain again without restarting it. The pool
attempts every scheduled close even when one fails. Failed provider closes are reported to their immediate caller and
retained for drain and disposal, so shutdown cannot report successful cleanup after an earlier retirement failed.
`maintain()` groups the failures from that maintenance pass in an `AggregateError`, preserving each original reason,
including `undefined`.

Later `drain()` calls still report retained failures after disposal. Repeated lease or pool disposal returns the same
completion promise, including its rejection, and joins any provider or context cleanup still running. Synchronous
lifecycle observers may request disposal again without beginning another shutdown. Parent contexts remain borrowed.

Each acquisition owns its temporary Context children through Dispose. If setup fails, those children close before the
acquisition rejects. If cleanup fails after a lease was prepared, Pool invalidates and closes the value before rejecting
so no unreachable lease can keep drain waiting. A work failure followed by cleanup failure uses `SuppressedError`;
parallel provider-close failures remain the documented `AggregateError` collection.

This example holds one connection close open to show that both release callers share its completion:

```ts runnable=joined-release.ts
import * as context from '@okikio/context';
import * as pool from '@okikio/pool';
await using owner = context.create({ id: 'joined-close' });
const finish = Promise.withResolvers<void>();
let closed = 0;
await using connections = await pool.create({
	ctx: owner,
	maximum: 1,
	maximumWaiting: 32,
	maximumIdle: 0,
	create: () => ({ id: 'connection' }),
	async close() {
		await finish.promise;
		closed++;
	},
});
const lease = await connections.acquire(owner);
const first = lease[Symbol.asyncDispose]();
const second = lease[Symbol.asyncDispose]();
console.log(first === second);
finish.resolve();
await first;
console.log(closed);
```

```text output
true
1
```

Duration normalization uses the owned native-first Temporal binding. Pool age, acquisition deadlines, and lease
timestamps stay on the supplied Context clock, including a deterministic `TestClock` when the caller provides one.

- **Check many pages with a few browser instances:** combine this pool with
  [Concurrency](../scheduler/concurrency/README.md). The mapper limits admitted operations; each operation borrows a
  browser value from the pool and returns its lease.
- **Reuse Worker threads for conversions:** create and close [Worker](../worker/thread/README.md) handles through pool
  callbacks. The pool owns handle lifetimes, the Worker protocol validates requests, and a
  [Context](../context/README.md) carries cancellation for each acquisition and request.

## Define reuse, waiting, and shutdown policy

Replace the example value with a database connection, browser page or Worker handle, then configure validation, idle age
and acquisition timeout. Release a lease after each use; close the pool at the owning host lifetime. The pool owns
created values while callers borrow leased values. A limit controls resource count, not queue-job authority or
distributed placement.

Use Pool when reuse justifies acquisition, validation, and shutdown obligations. A SQL session and a browser context
both cost time to create and need exclusive leases. Use Concurrency when all you need is a limit on ordinary callbacks.

Release the lease rather than closing a borrowed resource directly. Shutdown must account for creation, validation,
release, and close work, not just idle values.

## Bound acquisition waiting

`maximumWaiting` is required in addition to `maximum`. It counts queued acquisitions, not leases or provider creation.
Use zero to reject blocked requests immediately. A full queue rejects with `PoolWaitLimitError`; cancellation, timeout
and drain release waiting slots. Existing callers must choose a finite bound based on their admitted request budget.
Activity thread/process providers explicitly allow one waiting caller per configured host.

Reset and rotation are opt-in resource policies:

```ts
await using sessions = await pool.create({
	ctx,
	maximum: 8,
	maximumWaiting: 32,
	maximumUses: 100,
	maximumAge: 'PT1H',
	create: () => ({ selected: '' }),
	reset(value) {
		value.selected = '';
	},
	close() {},
});
await pool.withLease(sessions, ctx, (session) => {
	session.selected = 'asset-1';
});
```

`reset` runs on eligible returns before the health check and before idle publication. A failed reset closes the value
before lease disposal rejects. If close also fails, `SuppressedError` retains both errors; repeated lease disposal joins
that same result. Graceful drain joins an in-flight reset and then closes the value instead of reusing it.

`maximumUses` counts granted leases, including a callback that throws. `maximumAge` measures time from completed
creation using the owning Context clock. Rotation never interrupts a borrower. Return, reuse and explicit maintenance
enforce retirement; there is no background timer. Absolute age can retire idle values below `minimum`; the next
acquisition creates a replacement. Idle-age maintenance still preserves `minimum`. A callback exception alone does not
invalidate the value: explicitly call `lease.invalidate(reason)` when provider state is unsafe.

`withLease(pool, ctx, (value, lease) => ...)` joins release even when the callback throws. Standard async disposal
retains simultaneous callback and release failures. A non-waiting acquisition API remains deferred: health checks and
asynchronous creation must not be disguised as immediate acquisition.

## Choose an entry point

Use the table to find a focused import for the job you need. Contract links open the exact public source, including its
options and types.

| Import               | Use it to                                                                | Exact contract         |
| -------------------- | ------------------------------------------------------------------------ | ---------------------- |
| `@okikio/pool`       | Use the package entry shown in the complete examples above.              | [Contract](./mod.ts)   |
| `@okikio/pool/types` | Import public types for this capability; this entry does not start work. | [Contract](./types.ts) |

## Measure reuse and bounded pressure

The focused benchmarks measure warm leases, 8 active/32 waiting/32 rejected borrowers, reset and retirement. The
benchmark compares against direct reusable value reads; caller reset with the same owned rotation. Direct reads omit
admission and cleanup guarantees. Saturation checks assert all leases return. The burst fixture releases held leases
and joins accepted waiters even when its admission assertions fail. Warm reuse excludes pool construction; rotation
includes construction and shutdown. These boundaries remain separate in the benchmark groups.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
deno task --cwd=packages/pool test
deno task --cwd=packages/pool bench:check
deno task --cwd=packages/pool bench
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.

## Read further

The [Pool guide](https://github.com/okikio/utils/blob/main/docs/pool.md) explains the model, manual alternatives, and
composition.

## Select or retire one value

`select(ctx, value)` borrows the exact retained value by `Object.is` identity.
It rejects busy or missing values immediately and never creates a replacement.
`values()` snapshots already owned values without transferring cleanup authority.
The selected value must identify one pool slot; equal values in multiple slots are
ambiguous and reject. `retire(value)` stops reuse, joins existing borrowers and
closes the value before returning its capacity. Never await retirement from
inside that value's lease. Native activity providers build portable host
references on these operations; see [Physical hosts](../../docs/workflows/19-hosts.md).
