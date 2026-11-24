---
npm/@okikio/sql: minor
npm/@okikio/utils: minor
---

Work beside Drizzle. The new `@okikio/sql/postgres/drizzle` entry point turns a Drizzle table into a table definition with `table(drizzleTable, getTableConfig)`, keeping keys, database names, NULL rules, defaults, identity and generated columns, enums, arrays, the primary key and Drizzle's `$defaultFn` and `$onUpdateFn`, in the types as well as at run time. Its `database` and `executor` run statements through Drizzle's `sql` tag and inside Drizzle transactions, and cancel by signal through the `pg` pool or Postgres.js client Drizzle sits on.
