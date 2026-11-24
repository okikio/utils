/**
 * Known limits: each case that fails for a reason outside the package, on a target, a client or a pair of them.
 *
 * The suite compares every outcome with this list. An unlisted failure fails the suite, and so does a listed failure
 * that now passes, so the list always states exactly where the package does not work and why. Add a limit only for a
 * cause the package cannot change, with the reason a reader needs; fix the package for everything else.
 *
 * @module
 */

/**
 * Where cases are known to fail, and why. Absent `targets` or `clients` means every one. `cases: 'any'` is for a client
 * set up in a way the target does not support, where which statements fail varies from run to run; those cases may
 * fail or pass. The pseudo-case `client run` stands for a client that stopped before reporting its cases.
 */
export interface LimitType {
	readonly targets?: readonly string[];
	readonly clients?: readonly string[];
	readonly cases: readonly string[] | 'any';
	readonly reason: string;
}

export const limits: readonly LimitType[] = [
	{
		clients: [
			'pg-by-hand',
			'pg-one-connection',
			'pg-type-parsers',
			'prisma',
			'typeorm',
			'sequelize',
			'knex',
			'slonik',
			'pg-promise',
			'bun-sql',
			'bun-sql-unprepared',
			'bun-sql-template',
			'deno-postgres',
			'pglite',
			'prisma-neon',
		],
		cases: ['an abort signal cancels a running statement'],
		reason:
			'The library has no way to cancel a statement in the database, so the hand-written adapter lets it finish. ' +
			"Use the package's `pg` or Postgres.js binding on the same pool to cancel.",
	},
	{
		clients: ['neon-http', 'drizzle-neon-http'],
		cases: [
			'numeric, timestamp, enum and quoted names',
			'transactions roll back and take an isolation level',
			'session TimeZone, extra_float_digits and IntervalStyle change nothing',
			'session DateStyle changes nothing',
		],
		reason:
			'Neon over HTTP sends each statement alone and has no interactive transactions, so `db.begin` throws. Use ' +
			'the WebSocket `Pool` for work that needs a transaction.',
	},
	{
		clients: ['neon-http', 'drizzle-neon-http'],
		cases: ['10 MB of text and jsonb', 'insert 5,000 rows in one statement'],
		reason: 'Neon\'s HTTP endpoint refuses a request over 10 MiB, and a 50,000-parameter statement ("value too large ' +
			'to transmit"). Split the write, or use the WebSocket `Pool`.',
	},
];

/** The limit that explains a case failing on a target and client, if one does. */
export function limitFor(
	target: string,
	client: string,
	kase: string,
): LimitType | undefined {
	return limits.find((limit) =>
		(limit.cases === 'any' || limit.cases.includes(kase)) &&
		(limit.targets?.includes(target) ?? true) &&
		(limit.clients?.includes(client) ?? true)
	);
}
