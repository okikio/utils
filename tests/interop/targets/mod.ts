/** Every target, in the order the suite starts them. @module */
import { target as alloydb } from './alloydb.ts';
import { target as citus } from './citus.ts';
import { target as cockroach } from './cockroach.ts';
import { target as neon } from './neon.ts';
import { target as paradedb } from './paradedb.ts';
import { targets as pgbouncer } from './pgbouncer.ts';
import { target as pglite } from './pglite.ts';
import { targets as postgres } from './postgres.ts';
import { target as supabase } from './supabase.ts';
import { targets as supavisor } from './supavisor.ts';
import { target as timescaledb } from './timescaledb.ts';
import type { TargetType } from './types.ts';
import { target as yugabyte } from './yugabyte.ts';

export type { StartedType, TargetType } from './types.ts';

export const targets: readonly TargetType[] = [
	...postgres,
	...pgbouncer,
	...supavisor,
	neon,
	cockroach,
	yugabyte,
	timescaledb,
	citus,
	paradedb,
	alloydb,
	supabase,
	pglite,
];
