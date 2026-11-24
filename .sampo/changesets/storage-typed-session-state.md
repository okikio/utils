---
npm/@okikio/storage: minor
---

The Postgres session and state adapters are built on `@okikio/sql`, with no SQL strings. Their tables are typed in `schema.ts`, their statements in `statements.ts`, and `statements.sql` holds the compiled SQL that the statement tests compare and ask PostgreSQL to describe. Both accept a Postgres.js pool or any `@okikio/sql` database, so another client or ORM can back them. The state adapter keeps its reserved-connection transaction for a Postgres.js pool and uses the database's own transactions otherwise.
