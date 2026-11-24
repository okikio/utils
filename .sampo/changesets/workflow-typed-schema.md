---
npm/@okikio/storage: patch
---

The Postgres workflow schema is defined with `@okikio/sql` instead of one SQL script. Its tables, trigger functions and triggers live in `workflow/postgres/schema/`, and `migrate()` runs the same idempotent steps in the same order, so revision 1 and 2 databases still reach revision 3. `check()` now compares every column the revision defines, with its type, with the installed schema.
