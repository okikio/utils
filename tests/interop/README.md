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
`results.json`. `INTEROP_CONCURRENCY=4` runs four clients against one server at
once, each in its own schema.

## How CI runs only what changed

Each target × client pair is a cell, and each cell has a key built from exactly
what it runs (`tools/testing/interop/keys.ts`):

- the files its imports reach, from `matrix.test.ts`, its own client module and
  its own target module, through `@okikio/sql` and the cases;
- the pnpm lock closure of every npm package those imports load;
- the pinned Node, Bun or Deno version from `mise.toml`;
- the digests of the images its target starts;
- only the known limits that apply to that cell.

So a change to `clients/postgresjs.ts` reruns only the Postgres.js cells, a
change to `packages/sql/postgres/pg.ts` only the clients that load the `pg`
binding, a new CockroachDB limit only CockroachDB's cells, and a Renovate bump
of knex only knex's cells.

CI keeps every passed key in a ledger, a workflow artifact that lasts 90 days
from its last upload and is uploaded again at least monthly while CI runs. The
plan job starts one job per target that has a cell the ledger lacks, holding
only those clients; a target whose cells all passed starts no job. Images are
pulled by digest through `mirror.gcr.io`: in measured CI runs that beat
restoring `docker save` archives from the Actions cache for every image
measured. Dispatching CI with `fresh` runs every cell again.

```sh
node tools/testing/interop/cli.ts explain --target postgres-18 --client pg   # what one cell's key holds
node tools/testing/interop/cli.ts plan --out .tmp/interop/plan.json          # cells and shards, with no ledger
```

## What runs

- **Clients** (`clients/`, one module each): Postgres.js, pg (through the package's binding, by
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

- A client is one module in `clients/`, named after it, exporting `client`; add
  it to `clients/mod.ts`. Use the package's bindings where they exist; the
  hand-written forms are what the package README shows. Code that several
  clients share goes in `clients/shared/`.
- A target is a module in `targets/`, exporting `target` or `targets`, with the
  images it starts in `images`; add it to `targets/mod.ts`. Pin each image by
  digest in `targets/images.ts`, where Renovate updates it. A server whose types
  differ, as CockroachDB's floats do, sets `flavor`.
- A module that reads files or loads npm packages in a way no import shows
  exports `inputs` (paths) or `packages` (names), so the cell key holds them, as
  `clients/shared/prisma.ts` does for its schema.
- Run the new entry against every target or client, then add a limit for each
  failure the package cannot fix.
