/** Citus, PostgreSQL with distributed tables, as a single node. @module */
import { images } from './images.ts';
import { plain } from './server.ts';
import type { TargetType } from './types.ts';

export const target: TargetType = plain(
	'citus',
	images.citus,
	'Citus 14 single node: distributed tables are opt-in, so plain tables behave as usual.',
	'distribution',
);
