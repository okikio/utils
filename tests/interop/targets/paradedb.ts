/** ParadeDB, PostgreSQL with full-text search. @module */
import { images } from './images.ts';
import { plain } from './server.ts';
import type { TargetType } from './types.ts';

export const target: TargetType = plain(
	'paradedb',
	images.paradedb,
	'ParadeDB on PostgreSQL 18, with pg_search loaded.',
	'distribution',
);
