---
npm/@okikio/sql: minor
npm/@okikio/utils: minor
npm/@okikio/storage: patch
---

`@okikio/sql` now reads the same values through PgBouncer, Supavisor, Neon, Supabase, TimescaleDB, Citus, ParadeDB, AlloyDB Omni, CockroachDB and YugabyteDB as through PostgreSQL. Floats are read as their exact bytes, timestamps, times and intervals as whole numbers of days and microseconds, so `extra_float_digits`, `DateStyle`, `IntervalStyle` and `TimeZone` no longer change a value; Supabase's `extra_float_digits = 0` used to round floats to 15 digits. A value that a read uses more than once is computed once. `integer` and `smallint` cast to `int4` and `int2`, `count` returns `int4`, and arithmetic keeps its left operand's type, so CockroachDB's 64-bit `int` cannot widen a result. The `pg` binding cancels with the protocol's cancel request, which poolers route to the right server, and falls back to `pg_cancel_backend`. The new `@okikio/sql/postgres/cockroach` entry point holds the types for CockroachDB, which lacks `float8send`. A row function names its columns, `sum` accepts nullable inputs, and decimals in scientific notation are read.
