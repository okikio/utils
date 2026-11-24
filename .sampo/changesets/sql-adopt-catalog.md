---
npm/@okikio/sql: minor
npm/@okikio/utils: minor
---

Adopt PostgreSQL schemas made elsewhere. `sql.schema(name, { owned: false })` marks a schema whose tables can be queried but not changed by the schema statements. Columns gain `.named()` for a different database name, `.computed()` for a column the database writes, and `.onInsert()` and `.onUpdate()` for values the application owns, such as Sequelize's `createdAt` or Prisma's `@updatedAt`. The new `@okikio/sql/postgres/adopt` entry point reads tables, views, composite types, enums and primary keys from the catalog (`inspect`), writes table definitions from them (`generate`), and compares definitions with the live database (`drift`), reporting wrong types, NULL rules, missing defaults and columns, and database-written columns. `types.custom` reads and writes any other type as text.
