---
npm/@okikio/sql: minor
---

Names are quoted exactly, so tables made by Prisma, TypeORM, Sequelize or plain SQL (`"User"."createdAt"`, `"full name"`, reserved words) can be described. A name may not be empty, hold NUL, or pass 63 bytes, where PostgreSQL would silently cut it. New types: `timestamp` for `timestamp without time zone` columns, which the wrong type would shift by the session's time zone; exact `numeric` as decimal text; and `enumerated` for existing enum types, which text cannot be written into.
