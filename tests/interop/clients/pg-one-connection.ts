/** The `pg-one-connection` client. @module */
import { pgByHand } from './shared/pg-hand.ts';
import { type ClientType } from './types.ts';

export const client: ClientType = pgByHand(
	'pg-one-connection',
	'node-postgres 8 by hand with a pool of one connection.',
	() => ({ max: 1 }),
);
