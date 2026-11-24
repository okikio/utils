---
npm/@okikio/storage: minor
---

The Postgres queue adapter is built on `@okikio/sql`, with no SQL strings. Its tables are typed in `queue/schema.ts`, its statements in `queue/statements.ts`, and `queue/statements.sql` holds the compiled SQL that the statement tests compare and ask PostgreSQL to describe. `open()` and `migrate()` accept a Postgres.js pool or any `@okikio/sql` database, so another client or ORM can back the queue. Aborting an operation still cancels its running query with the Postgres.js pool.
