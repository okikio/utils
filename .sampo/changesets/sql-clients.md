---
npm/@okikio/sql: minor
npm/@okikio/storage: patch
---

`@okikio/sql` statements now run unchanged through Postgres.js, pg, Drizzle, Kysely, Prisma 7, TypeORM, Sequelize, knex, MikroORM, Slonik, pg-promise, Bun's SQL, Deno's `@db/postgres` and PGlite, on PostgreSQL 14 to 19. Every number travels as text, so a client that writes values into the SQL cannot turn `-2147483648` into an out-of-range expression, and `double` keeps `NaN`, `±Infinity` and `-0`. Timestamps cover every year PostgreSQL holds and are read as exact epoch seconds. Text and JSON strings with NUL or a lone UTF-16 surrogate are refused instead of failing in the database or being changed silently, and a statement over 65,535 parameters fails with a clear error. The compiled template pieces are a real template object, which Bun's SQL and Slonik require, and a 5,000-row insert no longer overflows the stack.
