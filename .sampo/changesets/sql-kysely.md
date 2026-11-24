---
npm/@okikio/sql: minor
npm/@okikio/utils: minor
---

Work beside Kysely. The new `@okikio/sql/postgres/kysely` entry point runs statements through Kysely's `sql` tag and inside Kysely transactions, at a chosen isolation level, and cancels by signal through Kysely 0.29's abort support.
