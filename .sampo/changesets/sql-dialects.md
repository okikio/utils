---
npm/@okikio/sql: minor
npm/@okikio/utils: minor
npm/@okikio/storage: patch
---

`@okikio/sql` splits into a dialect-neutral core and one entry point per SQL dialect. `@okikio/sql` keeps expressions, conditions, tables, scope checks and the executor port; `@okikio/sql/postgres` adds PostgreSQL statements, types, the `fn` catalog, `json`, DDL and triggers; and the Postgres.js binding moves to `@okikio/sql/postgres/postgresjs`. Every type, table and expression knows its dialect, and mixing two dialects throws. Statements now enforce tabular scope: an expression's type names the tables, aliases and named rows it reads, and a statement that reads a source it does not define fails to type-check and throws when built. Correlated subqueries pass their outer columns up; named subqueries, unions, constraints and triggers must stay within their own sources. `collate` and `later` are functions of the PostgreSQL entry point, and a NULL value is written `cast(null as type)`.
