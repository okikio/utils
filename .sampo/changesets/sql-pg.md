---
npm/@okikio/sql: minor
npm/@okikio/utils: minor
---

New `@okikio/sql/postgres/pg` binds a node-postgres pool to the `Database` port. A statement run with a `signal` is cancelled through `pg_cancel_backend` on a second connection and rejects with the abort reason, and `begin(work, { isolation })` opens a transaction at a chosen level. Drizzle, Kysely, TypeORM, Sequelize, knex and MikroORM users can pass the `pg` pool they already have.
