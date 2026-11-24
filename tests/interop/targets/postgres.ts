/** PostgreSQL itself, every supported major version. @module */
import { images } from './images.ts';
import { plain } from './server.ts';
import type { TargetType } from './types.ts';

export const targets: readonly TargetType[] = [
	plain(
		'postgres-14',
		images.postgres14,
		'PostgreSQL 14, the oldest version the package reads exactly.',
		'postgres',
	),
	plain('postgres-15', images.postgres15, 'PostgreSQL 15.', 'postgres'),
	plain('postgres-16', images.postgres16, 'PostgreSQL 16.', 'postgres'),
	plain('postgres-17', images.postgres17, 'PostgreSQL 17.', 'postgres'),
	plain('postgres-18', images.postgres18, 'PostgreSQL 18.', 'postgres'),
	plain('postgres-19', images.postgres19, 'PostgreSQL 19.', 'postgres'),
];
