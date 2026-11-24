---
npm/@okikio/storage: minor
---

The Postgres outbox is built on `@okikio/sql`, with no SQL strings. Its tables and statements are typed, and its tests compare every statement with committed SQL and ask PostgreSQL to describe it. Every call that joins the caller's transaction accepts a Postgres.js transaction or any `@okikio/sql` executor, and `open()` and `migrate()` accept a Postgres.js pool or an executor that can begin transactions, so an application using Drizzle, Kysely or another client joins its own transaction. `completed({ where })` takes a typed condition built from the exported `messages` table. Payloads travel as JSON text, so no client encodes a string twice.
