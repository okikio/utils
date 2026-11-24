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
 * fail or pass. `sometimes` marks listed cases that depend on timing or a server outside the package, so they may
 * pass too. The pseudo-case `client run` stands for a client that stopped before reporting its cases.
 */
export interface LimitType {
	readonly targets?: readonly string[];
	readonly clients?: readonly string[];
	readonly cases: readonly string[] | 'any';
	readonly sometimes?: boolean;
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
		targets: [
			'pgbouncer-session',
			'pgbouncer-transaction',
			'supavisor-session',
			'supavisor-transaction',
		],
		clients: ['kysely', 'kysely-compiled-query', 'mikroorm'],
		cases: ['an abort signal cancels a running statement'],
		reason: 'Kysely and MikroORM cancel with `pg_cancel_backend(pid)`, and a pooler hands out its own pid, not the ' +
			"server's, so the cancel misses, or stops another client's statement whose server has that pid. The " +
			"package's `pg` binding sends a cancel request, which the pooler routes; use it on the same pool.",
	},
	{
		targets: ['supavisor-transaction'],
		clients: ['bun-sql', 'bun-sql-template'],
		cases: 'any',
		reason: "Bun's SQL client names its prepared statements, and Supavisor in transaction mode hands the next " +
			'statement to a server connection that already has that name. Set `prepare: false`, as `bun-sql-unprepared` ' +
			"does, or enable Supavisor's named prepared statements.",
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
	{
		targets: ['neon-proxy'],
		clients: ['neon-http'],
		cases: ['an abort signal cancels a running statement'],
		sometimes: true,
		reason:
			'Over HTTP, an abort closes the request, and the local Neon proxy stops the statement only when it notices ' +
			'the closed request before the statement ends. It keeps no cancel keys, as the next limit says.',
	},
	{
		targets: ['neon-proxy'],
		cases: ['an abort signal cancels a running statement'],
		reason: "The local Neon proxy runs without the Redis store Neon's deployment keeps cancel keys in, so it drops " +
			'every cancel request ("cancellation handler is not available" in its log). The `pg` binding does send one over ' +
			'the WebSocket; cancellation on Neon itself is not covered here.',
	},
	{
		targets: ['alloydb-omni'],
		clients: ['postgresjs', 'postgresjs-unprepared', 'drizzle-postgresjs'],
		cases: ['an abort signal cancels a running statement'],
		sometimes: true,
		reason: "Postgres.js's cancel request stops the statement on AlloyDB Omni only some of the time: here 2 to 6 of " +
			'15 tries ran to the end, with one connection or four and with the abort after 50 ms or 1 s. On PostgreSQL ' +
			"it worked every time, and node-postgres's cancel request worked every time on AlloyDB Omni. Use the `pg` " +
			'binding there to cancel.',
	},
	{
		targets: ['cockroachdb'],
		cases: ['create trigger from typed steps', 'trigger wrote history with tg_op'],
		reason:
			"CockroachDB triggers cannot name update columns (`after update of label`), and the suite's trigger does. " +
			'A trigger on every update works there.',
	},
	{
		targets: ['cockroachdb'],
		cases: ['session DateStyle changes nothing'],
		reason:
			'CockroachDB has only the ISO `DateStyle` and refuses to set another, so there is nothing to guard against.',
	},
	{
		targets: ['yugabytedb'],
		cases: ['numeric NaN is stored and read back'],
		reason:
			'A YugabyteDB `numeric` column cannot store `NaN` ("DECIMAL does not support NaN yet"); a `NaN` value in a ' +
			'statement and every other stored value work.',
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
