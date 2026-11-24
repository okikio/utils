# `@okikio/sql`

Build SQL statements from typed tables and expressions instead of SQL strings, then run them with any client:
Postgres.js, pg, Drizzle, Kysely, Prisma or Bun SQL. The package has no database client of its own.

A table is defined once. That definition gives typed column expressions for queries, the `create table` statement for
migrations, and the shape that checks compare with the live database.

## Entry points

SQL dialects share an algebra but differ in clauses, types and built-in functions. Each dialect has its own entry point
on a shared core:

| Entry point                          | What it holds                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `@okikio/sql`                     | The dialect-neutral core: expressions, conditions, tables, scope, executors.  |
| `@okikio/sql/postgres`            | The core, plus PostgreSQL statements, types, functions, DDL and triggers.     |
| `@okikio/sql/postgres/adopt`      | Read a schema made elsewhere, generate its definitions, check them for drift. |
| `@okikio/sql/postgres/drizzle`    | Read Drizzle tables as definitions, and run statements through Drizzle.       |
| `@okikio/sql/postgres/kysely`     | Run PostgreSQL statements through Kysely, in its transactions too.            |
| `@okikio/sql/postgres/postgresjs` | Run PostgreSQL statements through Postgres.js.                                |
| `@okikio/sql/postgres/pg`         | Run PostgreSQL statements through node-postgres (`pg`), with cancellation.    |

Application code imports one dialect's entry point. A library that only accepts an executor or a statement can depend
on the core. Only PostgreSQL exists today. Other tabular dialects, such as ClickHouse, MySQL and T-SQL, would be sibling
entry points on the same core. Document dialects, such as Cosmos DB SQL and Couchbase SQL++, have no fixed columns, so
they would need their own model rather than tables.

```ts ignore
import * as sql from '@okikio/sql/postgres';
import { types } from '@okikio/sql/postgres';

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
import * as sql from '@okikio/sql/postgres';
import { types } from '@okikio/sql/postgres';

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
- Names are always quoted, so `"User"."createdAt"`, `"full name"` and reserved words such as `order` keep their
  spelling. A name may not be empty, pass 63 bytes (PostgreSQL would silently cut it), or hold NUL. Prefer lowercase
  `snake_case` for new schemas, because hand-written SQL then needs no quotes.
- A statement may send at most 65,535 parameters, the wire protocol's limit. Split a larger insert.
- **Scope.** A statement reads only the sources it defines, as the next section explains.
- **One dialect.** Every type, table and expression knows its dialect. Mixing two in one statement throws.

## Scope: a statement reads only its own sources

Tabular SQL has a fixed structure: a column belongs to a table, and a statement can read a table only after `from`, a
join, `update … from` or `delete … using` names it. The package holds statements to that rule.

Every expression carries its **owners**: the tables, aliases and named rows whose columns it reads. The type says so,
as in `Expr<boolean, 'app.notes'>`. A statement collects the owners it reads and the sources it defines. A runnable
`Statement` must read nothing else:

```ts ignore
// Type error, and `toQuery` throws: the select reads `app.people` but never names it.
const stray: sql.Statement<{ id: string }> = sql.select({ id: n.id }).from(notes).where(p.name.eq('a'));
// Fine: the join brings `app.people` into scope.
sql.select({ title: n.title, name: p.name }).from(notes).join(people, p.id.eq(n.owner));
```

A subquery may read an outer statement's columns. Those owners pass up through `sql.exists`, `sql.scalar`,
`sql.aggregate` and `.in(...)`, so the outer statement must define them. A named subquery (`sql.cte`) and a union must
read only their own sources. A check, key or index may read only its own table. A trigger step reads only `new`, `old`
and `trigger.operation`, and a trigger condition only `new` and `old`.

Type a helper that returns a condition with its owners: `sql.Expr<boolean, typeof notes.key>`. A function that takes
a row of plain values, such as an insert's input, can say so with `sql.InsertRow<typeof notes.columns, never>`.

Every value becomes a parameter with an explicit cast, such as `$1::text`. Only schema statements write values as
literals, because PostgreSQL takes no parameters there, and they accept only constants that cannot change meaning.

## The same values from every client

Clients disagree about how they return `bigint`, `jsonb` and timestamps, and some write values into the SQL text
instead of sending parameters. Each type in `types` fixes both directions, and every number travels as text, so no
client can change a value:

| Type                    | JavaScript value    | Sent as                                 | Read as                          |
| ----------------------- | ------------------- | --------------------------------------- | -------------------------------- |
| `text(values?)`         | `string`            | `text`                                  | `text`                           |
| `integer`               | `number`            | text, cast to `integer`                 | `integer`                        |
| `bigint`                | `bigint`            | text, cast to `bigint`                  | text                             |
| `long`                  | `number` (safe int) | text, cast to `bigint`                  | text, then range-checked         |
| `double`                | `number`            | text, with `NaN`, `±Infinity` and `-0`  | text, exact                      |
| `numeric`               | `string`            | decimal text, cast to `numeric`         | decimal text, exact              |
| `boolean`               | `boolean`           | `boolean`                               | `boolean`                        |
| `uuid`                  | `string`            | text, cast to `uuid`                    | text                             |
| `jsonb(parse?)`         | any JSON value      | JSON text, cast to `jsonb`              | JSON text, then parsed           |
| `timestamptz`           | `Temporal.Instant`  | ISO 8601 text in UTC, any year          | exact epoch seconds              |
| `timestamp`             | `Temporal.Instant`  | UTC wall-clock text                     | exact epoch seconds              |
| `enumerated(name, all)` | one of `all`        | text, cast to the enum type             | text                             |
| `smallint`, `real`      | `number`            | text, range-checked                     | `integer`, exact text            |
| `date`                  | `Temporal.PlainDate`| ISO 8601 text, any year                 | days since 1970-01-01            |
| `time`                  | `Temporal.PlainTime`| ISO 8601 text                           | exact seconds since midnight     |
| `interval`              | `IntervalType`      | `months days seconds` text              | months, days, microseconds       |
| `bytea`                 | `Uint8Array`        | `\x` hex text                           | hex text                         |
| `array(element)`        | `readonly T[]`      | JSON list of element text forms         | JSON list of element read forms  |
| `composite(name, f)`    | object of fields    | JSON object of field text forms         | JSON object of field read forms  |

- A row with a missing, extra or mistyped column is an error, not `undefined`.
- `interval` is a plain `{ months, days, microseconds }`: PostgreSQL keeps the three parts apart, each with its own
  sign, and a `Temporal.Duration` cannot hold `1 month -1 day`.
- An array element or composite field uses its type's text form, so arrays of timestamps are as exact as one
  timestamp. In an array of `jsonb`, `null` is the JSON value; use `array(nullable(t))` for SQL NULL elements. Arrays
  are one-dimensional.
- Text and JSON strings may not hold NUL or a lone UTF-16 surrogate. PostgreSQL rejects NUL, and every client would
  silently replace a lone surrogate with U+FFFD, so sending either is a `TypeError`.
- Use `timestamp`, not `timestamptz`, for a `timestamp without time zone` column, such as the ones Prisma and TypeORM
  create. PostgreSQL converts between the two with the session's `TimeZone`, so the wrong one shifts the value.
- A stored `infinity` timestamp has no `Temporal.Instant`, so reading one fails. Timestamps need PostgreSQL 14 or
  later, where `extract` returns exact `numeric` seconds.

## Adopt a schema made elsewhere

The package does not need to own a schema. Tables made by Prisma, Drizzle, TypeORM, Sequelize, a migration tool or
plain SQL can be described and queried the same way:

```ts ignore
import { drift, generate, inspect } from '@okikio/sql/postgres/adopt';

// 1. Write definitions from the catalog once, and commit them.
await Deno.writeTextFile('tables.ts', generate(await inspect(db, ['prisma_app'])));

// 2. Check them in a test, so a change made elsewhere fails there instead of in production.
expect((await drift(db, [User, Post])).filter((item) => item.severity === 'error')).toEqual([]);
```

- `sql.schema(name, { owned: false })` marks a schema made elsewhere. Its tables can be queried, and `createTable`,
  `createIndex`, `addColumn`, `setNotNull` and `replaceCheck` refuse to change them.
- `.named('seen_at')` maps a key to a different column name. `.filled()` lets inserts omit a column the database fills
  (a default, sequence or trigger). `.computed()` marks a column the database writes, such as a generated column.
- `.onInsert(() => value)` and `.onUpdate(() => value)` write values the application owns, such as Sequelize's
  `createdAt` or Prisma's `@updatedAt`, which have no database default.
- `drift` reports a missing table or column, a type that reads or writes wrongly (`integer` for `bigint`,
  `timestamptz` for `timestamp`), a NULL rule or default that would fail, and a column the definition writes but the
  database computes. Near types, such as `text` for `varchar(40)`, are warnings.
- `types.custom(['pg_catalog', 'inet'])` reads and writes any other type as text.
- Inserts and updates may not name a column marked `.computed()` or `.identity()`; the row type leaves it out, so the
  mistake fails to type-check.

A Drizzle schema needs no generated copy. `@okikio/sql/postgres/drizzle` reads the Drizzle table itself, so one
schema file describes the table for both:

```ts ignore
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as drizzle from '@okikio/sql/postgres/drizzle';
import { accounts as drizzleAccounts } from './schema.ts';

const accounts = drizzle.table(drizzleAccounts, getTableConfig);
sql.select({ name: accounts.c.displayName }).from(accounts); // key `displayName`, column "display_name"
```

The keys, database names, `not null`, defaults, identity and generated columns, enums, arrays and the primary key all
come from Drizzle, at run time and in the types. Drizzle's `$defaultFn` and `$onUpdateFn` run here too. Values follow
this package's types rather than Drizzle's modes: a `timestamp` is a `Temporal.Instant`, a `numeric` is exact text. A
column type with no mapping here, such as `customType`, `inet` or `vector`, fails when the table is read; adopt that
table through `inspect` and `generate`. Kysely tables are TypeScript interfaces with nothing to read at run time, so
adopt them through `inspect` and `generate`.

## Compose larger statements

A query that would need several round trips in application code can stay one statement:

- `sql.cte(name, select)` names a subquery. Pass it to a statement's `.with(...)`, then read its columns as `due.c.id`.
- `update(...).from(...)` and `remove(...).using(...)` read other sources, as PostgreSQL's `update … from` and
  `delete … using` do.
- `insert(table, select)` inserts the rows a select returns. Name each selected value after the column it fills.
- `.for({ of: [table], skipLocked: true })` locks rows of one source only and skips rows other workers hold.
- `sql.fn.count(condition)` counts only matching rows, and `sql.fn.rowNumber(order)` numbers rows as a window
  function.
- `sql.unionAll(...)` keeps each select's own order and limit, and `sql.recursive(name, shape, step)` walks a tree.
  `cte(name, query, { materialized: true })` computes shared rows once.
- `json.elements(array, alias)` reads the elements of a `jsonb` array in `from`, and `json.contains`, `json.within`,
  `json.array` and `json.object` write containment and build values in SQL.

```ts ignore
const due = sql.cte(
	'due',
	sql.select({ id: n.id }).from(notes).where(n.state.eq('open')).limit(10).for({ skipLocked: true }),
);
const take = sql.update(notes, { state: 'done' }).with(due).from(due).where(n.id.eq(due.c.id)).returning({ id: n.id });
```

## Built-in functions

Each dialect has hundreds of built-in functions, and they differ. The core keeps only what every dialect shares:
`coalesce`, `add`, `subtract`, `multiply`, `min`, `max` and `sum`. A dialect's entry point adds a typed catalog of the
built-ins this repository uses, grouped by what they work on. For PostgreSQL, `sql.fn` has:

| Group   | Functions                                                                  |
| ------- | -------------------------------------------------------------------------- |
| Rows    | `count`, `rowNumber`, `min`, `max`, `sum`, `size`                          |
| Time    | `clockTimestamp`, `now`, `transactionTimestamp`, `epochMilliseconds`       |
| Numbers | `ceil`, `greatest`, `least`, `coalesce`                                    |
| Text    | `startsWith`, `charLength`                                                 |
| System  | `setLocal`, `tableExists`, `randomUuid`                                    |

`sql.later(instant, milliseconds)` moves a time, `sql.collate(text, 'C')` fixes a collation, and `json` holds the
`jsonb` operators. The catalog grows only when a package needs a function. Type any other function, including your
own, with `sql.declare(name, parameterTypes, resultType)`, which checks argument types the same way.

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
triggers. A step, and a statement in `trigger.run`, may read only `new`, `old` and `trigger.operation`. A string
literal in a function body may not hold `$`, because the body is dollar-quoted.

## Run with any client

An executor has one method, `run(query)`, which sends a compiled statement on the caller's connection or transaction.
A compiled statement has `$1` text with `values`, and the same statement as template `strings`, which a client's own
`sql` tag accepts.

`@okikio/sql/postgres/postgresjs` binds Postgres.js without depending on it:

```ts ignore
// Postgres.js
import { database, executor } from '@okikio/sql/postgres/postgresjs';
const db = database(pool); // also opens transactions: db.begin(async (tx) => …)

// Drizzle and Kysely: pass the library's own `sql` tag. `executor(tx, tag)` joins their transactions.
import { sql as drizzleTag } from 'drizzle-orm';
import * as drizzle from '@okikio/sql/postgres/drizzle';
const viaDrizzle = drizzle.database(orm, drizzleTag);
await orm.transaction(async (tx) => sql.execute(drizzle.executor(tx, drizzleTag), statement));
import { sql as kyselyTag } from 'kysely';
import * as kysely from '@okikio/sql/postgres/kysely';
const viaKysely = kysely.database(k, kyselyTag);
await k.transaction().execute(async (trx) => sql.execute(kysely.executor(trx, kyselyTag), statement));

// Any driver that takes text and values: pg, Kysely's CompiledQuery.raw, Prisma's $queryRawUnsafe, TypeORM,
// pg-promise, Bun's sql.unsafe and Deno's @db/postgres.
const plain = { run: async (query) => (await client.query(query.text, query.values)).rows };

// Clients with `?` placeholders, such as knex and MikroORM: escape each literal `?` (jsonb's `?&`), then join.
const positional = (query) => query.strings.map((piece) => piece.replaceAll('?', '\\?')).join('?');
const viaKnex = { run: async (query) => (await knex.raw(positional(query), query.values)).rows };

// Sequelize: pass `bind` only when there are values, or it reads `$body$` in a function body as a parameter.
const viaSequelize = {
	run: async (query) =>
		(await sequelize.query(query.text, { ...(query.values.length ? { bind: query.values } : {}), type: 'RAW' }))[0],
};
```

The template `strings` are a real template object, so tags that check for one, such as Bun's `sql` and Slonik's
`sql.unsafe`, accept them.

These forms were checked with Postgres.js, pg, Drizzle, Kysely, Prisma 7, TypeORM, Sequelize, knex, MikroORM, Slonik,
pg-promise, Bun's SQL, Deno's `@db/postgres` and PGlite, against PostgreSQL 14 to 19.

`@okikio/sql/postgres/pg` binds a node-postgres pool the same way: `database(pool)` runs, cancels and opens
transactions. Drizzle's `node-postgres` driver, Kysely's `PostgresDialect`, TypeORM, Sequelize, knex and MikroORM all
sit on a `pg` pool, so pass that pool to share its connections and get cancellation too.

`run` also takes `{ signal }`. The bindings cancel the running query when the signal aborts and reject with the abort
reason; the `pg` binding sends `pg_cancel_backend` through a second connection of the pool. The Kysely binding asks
Kysely 0.29 or later to cancel in the database. Drizzle takes no signal, so the Drizzle binding sends a cancellable
statement through the `pg` pool or Postgres.js client under it (`db.$client`); inside a Drizzle transaction the signal
is only checked before sending. The hand-written forms above ignore the signal and let the statement finish.
`database.begin(work, { isolation })` opens the transaction at a chosen isolation level, such as `'read committed'`.

## Verify statements before they reach production

- `sql.render(catalog)` writes every statement of a catalog as stable SQL text. Commit it beside the adapter and
  compare it in a test, so a review shows the SQL that changed.
- `sql.describe(catalog, describe)` asks PostgreSQL to parse and plan each statement without running it, and compares
  the parameter count and result columns with the declaration. A wrong table, column or type fails there.
- `sql.tableStatements(table)` creates a table and its indexes; `sql.addColumn` upgrades an older revision.
