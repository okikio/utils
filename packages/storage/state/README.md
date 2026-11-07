# Select a backing store for one Context value

An editor can save one current draft, close its view, then reopen that value later. This module supplies the backing
store used by `state.open`: memory, browser storage, or PostgreSQL. A **slot** is one saved value addressed by a fixed
key. Its **snapshot** includes the value, its contract name, and a version used to detect competing writes.

Context owns the store interface because its stored cells read and write those snapshots. Storage supplies the concrete
adapter. Choose it according to how long the value must last and which owners may write it.

| Import                           | Construction                              | Coordination                                      |
| -------------------------------- | ----------------------------------------- | ------------------------------------------------- |
| `@okikio/storage/state`          | `memory()`                                | Atomic within that shared store object            |
| `@okikio/storage/state/web`      | `open({ storage, key, mode, ... })`       | Explicit single writer, or supplied Web Locks     |
| `@okikio/storage/state/postgres` | `open({ database, namespace, key, ... })` | PostgreSQL primary key and conditional row update |

Constructors perform no I/O. Memory acquires no resources; Web Storage borrows its native or structural host; PostgreSQL
borrows the selected Postgres.js pool. Disposing a Context cell leaves the slot, host client, and saved value intact.
The application owns key deletion and closes shared clients at their real lifetime's end.

A version is a comparison token, not a timestamp or permission. Two writers can read the same version; coordination
must make comparing that version and replacing its value one operation.

| Backing and coordination | Who may compete? | How a stale writer learns about a change |
| --- | --- | --- |
| One shared memory store | Owners using that exact store object | Conditional save rejects the old version; reload reads the winner. |
| Web Storage, `single-writer` | Only the one writer promised by the application | Other writers are unsupported; the promise must hold outside this adapter too. |
| Web Storage, `locked` | Cooperating documents using the same Web Locks scope and name | Comparison and replacement share an exclusive lock; reload reads the winner. |
| PostgreSQL | Clients using the same namespace/key on the authoritative database | Conditional row update rejects the old version; reload reads the winner. |

Reload is an explicit decision. A storage event or a different process's write does not update an already opened cell.

## Reuse a memory slot across owners

Keep the store object when a new owner needs the previous value within the same process. Each save and load uses a
detached JSON envelope: saved data is copied rather than retaining a mutable reference to the editor's object.
A new `memory()` call starts empty, and process restart loses this backing store.

`await state.open()` loads or creates the value. `await using draft` registers the opened view for cleanup when its
block ends. Closing that view does not erase the store, which is why the second view can read the saved title.

After the [checkout setup](../../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`memory-state.ts` at that root, then run `mise exec -- deno run memory-state.ts`.

```ts runnable=memory-state.ts
import * as state from '@okikio/context/state';
import * as stores from '@okikio/storage/state';
import * as schema from '@okikio/schema';

// This store outlives each state view, but its data still belongs to this process.
const store = stores.memory();
{
	await using draft = await state.open({
		store,
		contract: 'draft.v1',
		value: schema.string(),
		initial: () => '',
	});
	await draft.set('Saved title');
}
// Reopen the same contract after the first view closes; the store supplies the saved snapshot.
await using restored = await state.open({ store, contract: 'draft.v1', value: schema.string() });
console.log(restored.reader.get());
```

```text output
Saved title
```

## See why only one competing save succeeds

This small store-level example makes the comparison visible. Both candidates expect `v1`; the first replacement
changes it, so the second cannot overwrite that result. A Context cell uses this same store contract on your behalf.
Run this complete program as `competing-saves.ts` after the checkout setup above.

```ts runnable=competing-saves.ts
import { memory, SnapshotSchema } from '@okikio/storage/state';

const store = memory();
const initial = SnapshotSchema.parse({ format: 1, contract: 'draft.v1', version: 'v1', value: 'Original' });
await store.save(initial, { expectedVersion: undefined });

// Both writers started from v1. Each proposes its own fresh replacement token.
const left = SnapshotSchema.parse({ ...initial, version: 'left', value: 'Left edit' });
const right = SnapshotSchema.parse({ ...initial, version: 'right', value: 'Right edit' });
const accepted = await Promise.all([
	store.save(left, { expectedVersion: 'v1' }),
	store.save(right, { expectedVersion: 'v1' }),
]);
console.log(accepted.filter(Boolean).length);

// Reload before deciding whether to merge or submit a new edit against the winner.
console.log((await store.load())?.value);
```

```text output
1
Left edit
```

The memory adapter performs each comparison and replacement in one synchronous turn, so this ordered example accepts
the left candidate. Across database clients, do not predict which writer wins. Use the accepted result and reload after
a conflict rather than treating timing as an ownership rule.

## Browser storage

```ts
import * as state from '@okikio/context/state';
import * as schema from '@okikio/schema';
import * as web from '@okikio/storage/state/web';

const store = web.open({
	storage: localStorage,
	key: 'editor:article-42',
	mode: 'locked',
	locks: navigator.locks,
});
await using draft = await state.open({
	store,
	contract: 'article.draft.v1',
	value: schema.object({ title: schema.string() }),
	initial: () => ({ title: '' }),
});
await draft.set({ title: 'Working title' });
```

Web Storage does not provide atomic read/compare/write across independent documents. Selecting `mode: 'single-writer'`
is an application promise to exclude concurrent writers. In `locked` mode, reads and the synchronous comparison/write
run under the supplied exclusive lock. All cooperating writers must use the same LockManager scope and resource name.
Direct `setItem` calls and another lock name bypass this coordination. The default name is `@okikio/context/state/`
followed by the storage key; an application can provide `lockName` when coordinating a wider operation.

Native `Storage` and `navigator.locks` satisfy the public structural types. Small mocks must preserve synchronous
`getItem`/`setItem` and hold a lock until its callback settles. A Promise from `setItem` is rejected as an unsupported
protocol instead of being mistaken for acknowledgement. Pending native lock acquisition is cancellable; a granted
synchronous callback runs to completion.

`localStorage` can survive a page restart; `sessionStorage` follows its browser session scope. Host access, quota,
deletion, eviction, and device durability rules remain the browser's. This adapter validates text before publication and
propagates host failures. Serialized envelope text is bounded to 16 MiB plus 4 KiB of metadata in UTF-16 code units, on
both save and load. Stored-cell value limits are separately measured in UTF-8 bytes.

No ambient globals are read on import or construction, and no storage listener is installed. Native storage events
notify other documents and can trigger an application decision to reload; they do not themselves advance a cell.

## PostgreSQL cursor or checkpoint

```ts
import postgresjs from 'postgres';
import * as state from '@okikio/context/state';
import * as schema from '@okikio/schema';
import * as snapshots from '@okikio/storage/state/postgres';

const database = postgresjs('postgres://application@127.0.0.1/catalog');
try {
	await snapshots.migrate({ database });
	await using cursor = await state.open({
		store: snapshots.open({ database, namespace: 'catalog-crawl', key: 'pages' }),
		contract: 'catalog.cursor.v1',
		value: schema.object({ next: schema.string(), visited: schema.number({ integer: true, minimum: 0 }) }),
		initial: () => ({ next: '/catalog', visited: 0 }),
	});
	// Fetching and processing a page belongs to the caller. Save its accepted checkpoint explicitly.
	await cursor.update((current) => ({ next: '/catalog?page=2', visited: current.visited + 1 }));
} finally {
	await database.end();
}
```

Run `migrate` explicitly during application setup. It installs revision-one tables under `utils_state`, serializes
concurrent migration calls, and rejects an unknown revision or missing snapshot table. Recognizing a revision is not a
structural audit of manually changed columns and constraints. Migration never rewrites saved snapshots.

Each operation reserves one physical session, begins a `READ COMMITTED` transaction, and releases that session after
COMMIT or awaited rollback. Initial creation uses the composite primary key. Replacement includes the expected opaque
version in its update predicate, which PostgreSQL rechecks after competing row updates. Only one contender can replace a
given current version. A namespace partitions identity and does not confer authorization or tenant isolation.

Cancellation observed before COMMIT rolls back when the connection remains usable. Once COMMIT is sent, the driver's
result determines acknowledgement; a lost connection may leave its outcome uncertain. The adapter does not call
Postgres.js `query.cancel`, whose cancellation can race with subsequent work. It joins the owned session instead.
`statementTimeoutMilliseconds` is a whole number from 1 through 60,000, default 5,000, applied locally to each
transaction. Connection setup and pool waiting use the application's pool policy. The adapter changes no borrowed pool
defaults and never calls `database.end`.

The table keeps one row per namespace and key. It does not save older versions. Your application deletes keys it no
longer needs. If two cells use the same key, a cell learns about another writer when a write conflicts or when you
call `reload`. The store does not keep a polling or notification connection.

A checkpoint can tell a crawler where to resume. Use Queue or Workflow alongside it if workers also need to claim
jobs, retry them, reject results from old attempts, or reuse saved step results.

## Shared validation and failure rules

`SnapshotSchema`, `SnapshotType`, `Store`, and operation option types are also exported from `@okikio/storage/state`.
The same definitions come from `@okikio/context/state`. Contract names, versions, JSON values, and future envelope
formats are checked using that shared Schema. Browser keys and PostgreSQL keys permit 1 through 512 Unicode code points;
PostgreSQL namespaces permit 1 through 128. Identity strings must not be blank.

See the [stored-state guide](../../../docs/context/03-stored-state.md) for lazy creation, two-way codecs, finite pending
work, exact commit error outcomes, conflict reconciliation, and disposal while a save is active.

Host semantics follow the [HTML Web Storage standard](https://html.spec.whatwg.org/multipage/webstorage.html),
[Web Locks standard](https://www.w3.org/TR/web-locks/),
[PostgreSQL transaction isolation documentation](https://www.postgresql.org/docs/current/transaction-iso.html), and the
selected [Postgres.js client documentation](https://github.com/porsager/postgres/tree/v4.0.0).

## Choose adjacent capabilities

Context owns the mutation and observation contract. This package selects the backing slot; the application owns keys,
retention, and the real host client.

The [package choice map](../README.md#choose-an-entry-point) lists the other public entries and when to use them.
