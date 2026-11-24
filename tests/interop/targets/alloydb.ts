/** AlloyDB Omni, Google's PostgreSQL-compatible engine. @module */
import { images } from './images.ts';
import { plain } from './server.ts';
import type { TargetType } from './types.ts';

export const target: TargetType = plain(
	'alloydb-omni',
	images.alloydb,
	"AlloyDB Omni 17, Google's PostgreSQL-compatible engine.",
	'distribution',
);
