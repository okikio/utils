/** Supabase's PostgreSQL image, connected directly. @module */
import { images } from './images.ts';
import { plain } from './server.ts';
import type { TargetType } from './types.ts';

export const target: TargetType = plain(
	'supabase-postgres',
	images.supabase,
	"Supabase's PostgreSQL 17 image with its extensions and roles, connected directly.",
	'distribution',
	{
		command: [
			'postgres',
			'-c',
			'config_file=/etc/postgresql/postgresql.conf',
		],
	},
);
