# PostgreSQL interoperability suite

`@okikio/sql` builds statements; other libraries send them. This suite sends
the same statements through every client the package supports, against every
PostgreSQL server, pooler and compatible database it claims to work with. Each
run starts the servers in Docker, so the results hold for real servers, not
mocks.

```sh
mise run test:interop                                  # every target
INTEROP_TARGETS=pgbouncer-transaction mise run test:interop
INTEROP_TARGETS=cockroachdb INTEROP_CLIENTS=pg,knex mise run test:interop
INTEROP_MIRROR=mirror.gcr.io mise run test:interop     # pull Docker Hub images from a mirror
```

The report is written to `.tmp/tests/interop/report.md`, with every outcome in
`results.json`. CI runs the suite in four parallel groups whenever the SQL
package or this folder changes, and uploads each group's report.

## What runs

- **Clients** (`clients/`): Postgres.js, pg (through the package's binding, by
  hand, on one connection and with type parsers), Bun's SQL, Deno's
  `@db/postgres`, Drizzle, Kysely, Prisma 7, TypeORM, Sequelize, knex, MikroORM,
  Slonik, pg-promise, Neon's serverless driver over HTTP and WebSocket, and
  PGlite. Bun and Deno clients run in their own runtime (`runtime.ts`).
- **Targets** (`targets/`): PostgreSQL 14 to 19; PgBouncer and Supavisor in
  session and transaction mode; Neon's proxy; Supabase's PostgreSQL;
  TimescaleDB, Citus, ParadeDB and AlloyDB Omni; CockroachDB and YugabyteDB;
  and PGlite in the same process. Every image is pinned by digest in
  `targets/images.ts`.
- **Cases** (`cases/`): schema statements, triggers, every statement form,
  exact round-trips of every type, and edges: 65,535 parameters, 10 MB values,
  NUL and lone surrogates, session settings, 50 concurrent statements,
  cancellation and adoption of a schema made elsewhere.

A case runs once per client and target, in a schema of its own.

## Known limits

`expectations.ts` lists each case that fails for a reason outside the package,
with the reason. A failure not on the list fails the suite, and so does a listed
failure that starts passing, so the list always says exactly where the package
does not work. Add a limit only for a cause the package cannot change; fix the
package for everything else.

## Adding a client or a target

- A client is an entry in `clients/`: how it opens a connection, and an executor
  around its own query call. Use the package's bindings where they exist; the
  hand-written forms are what the package README shows.
- A target is an entry in `targets/`: how to start it and the URL clients use.
  Pin the image by digest. A server whose types differ, as CockroachDB's floats
  do, sets `flavor` so the cases use the matching types module.
- Run the new entry against every target or client, then add a limit for each
  failure the package cannot fix.
