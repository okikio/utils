# `@okikio/sql`

Build PostgreSQL statements from typed tables and expressions instead of SQL strings, then run them with any client:
Postgres.js, pg, Drizzle, Kysely, Prisma or Bun SQL. The package has no database client of its own.

A table is defined once. That definition gives typed column expressions for queries, the `create table` statement for
migrations, and the shape that checks compare with the live database.

```ts ignore
import * as sql from '@okikio/sql';
import { types } from '@okikio/sql';

const app = sql.schema('app');
const notes = app.table('notes', {
	id: sql.column(types.uuid).default(sql.fn.randomUuid()),
	title: sql.column(types.text()),
	state: sql.column(types.text(['open', 'done'])).default('open'),
	seen: sql.column(types.timestamptz).nullable(),
}, (c) => ({ primaryKey: [c.id], indexes: [{ name: 'notes_open', on: [c.title], where: c.state.eq('open') }] }));

const n = notes.c;
const open = sql.select({ id: n.id, title: n.title }).from(notes).where(n.state.eq('open')).orderBy(n.title);
const found = await sql.rows(executor, open); // { id: string; title: string }[]
```

Building a statement needs no database. Compile it to see exactly what a client sends:

```ts runnable=sql-statement.ts
import * as sql from '@okikio/sql';
import { types } from '@okikio/sql';

const notes = sql.schema('app').table('notes', {
	id: sql.column(types.uuid),
	title: sql.column(types.text()),
	state: sql.column(types.text(['open', 'done'])),
});
const open = sql.select({ title: notes.c.title }).from(notes).where(notes.c.state.eq('open')).limit(10);
const query = sql.toQuery(open);
console.log(query.text);
console.log(JSON.stringify(query.values));
```

```text output
select ("app"."notes"."title")::text as "title" from "app"."notes" where "app"."notes"."state" = $1::text limit $2::bigint
["open",10]
```

## What TypeScript and the package check

- Column names and value types: `n.state.eq('closed')` does not compile when `state` allows only `open` and `done`.
- An insert must give every required column, and cannot write an identity column.
- A statement is not an expression. Embed a `select` only through `sql.exists`, `sql.scalar` or `.in(...)`.
- Schema, table, column and function names must be plain lowercase identifiers. Result names may be camelCase.

Every value becomes a parameter with an explicit cast, such as `$1::text`. Only schema statements write values as
literals, because PostgreSQL takes no parameters there, and they accept only constants that cannot change meaning.

## The same values from every client

Clients disagree about how they return `bigint`, `jsonb` and `timestamptz`. Each type in `types` fixes both directions:

| Type             | JavaScript value     | Sent as                                   | Read as                     |
| ---------------- | -------------------- | ----------------------------------------- | --------------------------- |
| `text(values?)`  | `string`             | `text`                                    | `text`                      |
| `integer`        | `number`             | `integer`                                 | `integer`                   |
| `bigint`         | `bigint`             | text, cast to `bigint`                    | text                        |
| `long`           | `number` (safe int)  | text, cast to `bigint`                    | text, then range-checked    |
| `double`         | `number`             | `double precision`                        | `double precision`          |
| `boolean`        | `boolean`            | `boolean`                                 | `boolean`                   |
| `uuid`           | `string`             | text, cast to `uuid`                      | text                        |
| `jsonb(parse?)`  | any JSON value       | JSON text, cast to `jsonb`                | JSON text, then parsed      |
| `timestamptz`    | `Temporal.Instant`   | epoch milliseconds through `to_timestamp` | epoch milliseconds          |

A row with a missing, extra or mistyped column is an error, not `undefined`.

## Compose larger statements

A query that would need several round trips in application code can stay one statement:

- `sql.cte(name, select)` names a subquery. Pass it to a statement's `.with(...)`, then read its columns as `due.c.id`.
- `update(...).from(...)` and `remove(...).using(...)` read other sources, as PostgreSQL's `update … from` and
  `delete … using` do.
- `insert(table, select)` inserts the rows a select returns. Name each selected value after the column it fills.
- `.for({ of: [table], skipLocked: true })` locks rows of one source only and skips rows other workers hold.
- `fn.count(condition)` counts only matching rows, and `fn.rowNumber(order)` numbers rows as a window function.

```ts ignore
const due = sql.cte(
	'due',
	sql.select({ id: n.id }).from(notes).where(n.state.eq('open')).limit(10).for({ skipLocked: true }),
);
const take = sql.update(notes, { state: 'done' }).with(due).from(due).where(n.id.eq(due.c.id)).returning({ id: n.id });
```

## Triggers without PL/pgSQL text

A trigger holds an invariant for every writer, including older workers and an operator's own SQL. `trigger.routine`
builds its function from a fixed set of typed steps (`perform`, `assign`, `branch`, `run`, `ensure` and `result`),
and `trigger.changed(table, 'new' | 'old')` gives the changed row with the table's column types. `trigger.create`
drops and creates the trigger, so a later revision can change its events or condition.

```ts ignore
const n = sql.trigger.changed(notes, 'new').c;
const stamp = sql.trigger.routine('app', 'stamp', [
	sql.trigger.assign(n.seen, sql.fn.clockTimestamp()),
	sql.trigger.result('new'),
]);
const statements = [
	stamp.ddl,
	...sql.trigger.create({ name: 'notes_stamp', table: notes, timing: 'before', events: ['insert'], routine: stamp }),
];
```

A trigger condition can read only `new` and `old`, so an insert and an update with different conditions are two
triggers. A string literal in a function body may not hold `$`, because the body is dollar-quoted.

## Run with any client

An executor has one method, `run(query)`, which sends a compiled statement on the caller's connection or transaction.
A compiled statement has `$1` text with `values`, and the same statement as template `strings`, which a client's own
`sql` tag accepts.

`@okikio/sql/postgres` binds Postgres.js without depending on it:

```ts ignore
// Postgres.js
import { database, executor } from '@okikio/sql/postgres';
const db = database(pool); // also opens transactions: db.begin(async (tx) => …)

// Drizzle
import { sql as tag } from 'drizzle-orm';
const drizzle = (tx) => ({
	async run(query) {
		const result = await tx.execute(tag(query.strings, ...query.values));
		return Array.isArray(result) ? result : result.rows;
	},
});

// Any driver that takes text and values
const plain = { run: async (query) => (await client.query(query.text, query.values)).rows };
```

`run` also takes `{ signal }`. The Postgres.js binding cancels the running query when the signal aborts and rejects
with the abort reason. A client that cannot cancel may ignore the signal. `database.begin(work, { isolation })` opens
the transaction at a chosen isolation level, such as `'read committed'`.

## Verify statements before they reach production

- `sql.render(catalog)` writes every statement of a catalog as stable SQL text. Commit it beside the adapter and
  compare it in a test, so a review shows the SQL that changed.
- `sql.describe(catalog, describe)` asks PostgreSQL to parse and plan each statement without running it, and compares
  the parameter count and result columns with the declaration. A wrong table, column or type fails there.
- `sql.tableStatements(table)` creates a table and its indexes; `sql.addColumn` upgrades an older revision.
