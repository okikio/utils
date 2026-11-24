/** TimescaleDB, PostgreSQL with its time-series extension. @module */
import { images } from './images.ts';
import { plain } from './server.ts';
import type { TargetType } from './types.ts';

export const target: TargetType = plain(
	'timescaledb',
	images.timescale,
	'TimescaleDB 2 on PostgreSQL 18, with its extension loaded.',
	'distribution',
);
