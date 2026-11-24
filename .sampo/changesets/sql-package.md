---
npm/@okikio/sql: minor
npm/@okikio/utils: minor
---

New `@okikio/sql` package: typed PostgreSQL tables, expressions and statements without SQL strings. Tables are defined once and give typed column expressions, `create table` statements and indexes. `select`, `insert`, `update` and `delete` compile to `$1` text with values and to template pieces, so Postgres.js, pg, Drizzle, Kysely and Prisma can all run them through a one-method executor. Each type fixes how its value is sent and read, so every client returns the same values. `render` and `describe` let tests compare statements with committed SQL and with an installed schema.
