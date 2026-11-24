---
npm/@okikio/storage: minor
npm/@okikio/utils: minor
---

The PostgreSQL workflow store also runs on any `@okikio/sql` database, such as a node-postgres pool bound with `@okikio/sql/postgres/pg`. `open`, `begin`, `inspector`, `migrationStatus`, `planMigrations` and `migrate` accept it alongside a Postgres.js pool. Domain SQL then receives an `Executor`, and workers poll, since the port has no `LISTEN`; `notifications: true` throws for such a database. A Postgres.js pool behaves as before.
