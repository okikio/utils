/** Every client the suite runs, in report order. Each has its own module, so a change to one reruns only its cells. @module */
import { clients as bun } from './bun.ts';
import { clients as deno } from './deno.ts';
import { client as drizzle } from './drizzle.ts';
import { client as drizzleNeonHttp } from './drizzle-neon-http.ts';
import { client as drizzleNeonWebsocket } from './drizzle-neon-websocket.ts';
import { client as drizzlePostgresjs } from './drizzle-postgresjs.ts';
import { client as knex } from './knex.ts';
import { client as kysely } from './kysely.ts';
import { client as kyselyCompiledQuery } from './kysely-compiled-query.ts';
import { client as mikroorm } from './mikroorm.ts';
import { client as neonHttp } from './neon-http.ts';
import { client as neonWebsocket } from './neon-websocket.ts';
import { client as pg } from './pg.ts';
import { client as pgByHand } from './pg-by-hand.ts';
import { client as pgOneConnection } from './pg-one-connection.ts';
import { client as pgPromise } from './pg-promise.ts';
import { client as pgTypeParsers } from './pg-type-parsers.ts';
import { client as pglite } from './pglite.ts';
import { client as postgresjs } from './postgresjs.ts';
import { client as postgresjsUnprepared } from './postgresjs-unprepared.ts';
import { client as prisma } from './prisma.ts';
import { client as prismaNeon } from './prisma-neon.ts';
import { client as sequelize } from './sequelize.ts';
import { client as slonik } from './slonik.ts';
import { client as typeorm } from './typeorm.ts';
import type { ClientType } from './types.ts';

export type { ClientType, OpenedType } from './types.ts';

export const clients: readonly ClientType[] = [
	postgresjs,
	postgresjsUnprepared,
	pg,
	pgByHand,
	pgOneConnection,
	pgTypeParsers,
	...bun,
	...deno,
	drizzle,
	drizzlePostgresjs,
	kysely,
	kyselyCompiledQuery,
	prisma,
	typeorm,
	sequelize,
	knex,
	mikroorm,
	slonik,
	pgPromise,
	neonHttp,
	neonWebsocket,
	drizzleNeonHttp,
	drizzleNeonWebsocket,
	prismaNeon,
	pglite,
];
