---
npm/@okikio/storage: patch
---

The Postgres workflow store and its inspector send no SQL strings. Every statement is a named, typed function in `workflow/postgres/statements/`, and `statements.sql` holds the compiled SQL that the statement tests compare and ask PostgreSQL to describe. The public API, the saved schema and the behavior stay the same; inspection times keep their published millisecond form and queue cursors keep microseconds.
