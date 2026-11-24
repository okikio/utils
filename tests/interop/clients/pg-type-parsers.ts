/** The `pg-type-parsers` client. @module */
import { pgByHand } from './shared/pg-hand.ts';
import { type ClientType } from './types.ts';

export const client: ClientType = pgByHand(
	'pg-type-parsers',
	'node-postgres 8 by hand with type parsers for int8 and timestamptz, as many apps set.',
	(pg) => ({
		max: 4,
		types: {
			getTypeParser: (oid: number, format: 'text' | 'binary') => {
				if (oid === 20) return (value: string) => BigInt(value);
				if (oid === 1184) return (value: string) => new Date(value);
				return pg.types.getTypeParser(oid, format);
			},
		},
	}),
);
