/** The `pg-by-hand` client. @module */
import { pgByHand } from './shared/pg-hand.ts';
import { type ClientType } from './types.ts';

export const client: ClientType = pgByHand(
	'pg-by-hand',
	'node-postgres 8 through a hand-written adapter: `pool.query(text, values)`.',
	() => ({ max: 4 }),
);
