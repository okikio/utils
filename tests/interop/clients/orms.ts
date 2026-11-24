/** ORMs and query builders, each through its documented raw-SQL path or the package's binding for it. @module */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CompiledType, Executor, IsolationType, RunOptions } from '@okikio/sql/postgres';
import { aborting, type ClientType, port, positional, template, upper, urlOf } from './types.ts';

type Rows = readonly Record<string, unknown>[];

/** Generate the Prisma client once; it only exists to run raw SQL. */
function prismaClient(): Promise<
	{ PrismaClient: new (options: unknown) => unknown }
> {
	const root = new URL('../', import.meta.url);
	if (!existsSync(new URL('.prisma/client.ts', root))) {
		execFileSync(process.execPath, [
			'node_modules/prisma/build/index.js',
			'generate',
		], {
			cwd: fileURLToPath(root),
			stdio: 'ignore',
		});
	}
	return import(new URL('.prisma/client.ts', root).href);
}

const prismaLevels: Readonly<Record<IsolationType, string>> = {
	'read committed': 'ReadCommitted',
	'repeatable read': 'RepeatableRead',
	serializable: 'Serializable',
};

/** Raw SQL through a Prisma client with any driver adapter. */
export async function prisma(adapter: unknown) {
	const { PrismaClient } = await prismaClient();
	type Raw = {
		$queryRawUnsafe(text: string, ...values: unknown[]): Promise<Rows>;
	};
	type Client = Raw & {
		$transaction<T>(
			work: (tx: Raw) => Promise<T>,
			options?: { isolationLevel?: string },
		): Promise<T>;
		$disconnect(): Promise<void>;
	};
	const client = new PrismaClient({ adapter }) as Client;
	const run = (target: Raw) => (query: CompiledType) => target.$queryRawUnsafe(query.text, ...query.values);
	const db = port(
		run(client),
		(work, options) =>
			client.$transaction(
				(tx) => work({ run: run(tx) } as Executor),
				options?.isolation ? { isolationLevel: prismaLevels[options.isolation] } : undefined,
			),
	);
	return { db, close: () => client.$disconnect() };
}

export const orms: readonly ClientType[] = [
	{
		name: 'drizzle',
		about: "Drizzle 0.45 on node-postgres through the package binding and Drizzle's `sql` tag.",
		reach: 'url',
		runtime: 'node',
		async open(started) {
			const { default: pg } = await import('pg');
			const { drizzle } = await import('drizzle-orm/node-postgres');
			const { sql: tag } = await import('drizzle-orm');
			const bridge = await import('@okikio/sql/postgres/drizzle');
			const pool = new pg.Pool({ connectionString: urlOf(started), max: 4 });
			return {
				db: bridge.database(drizzle({ client: pool }), tag),
				close: () => pool.end(),
			};
		},
	},
	{
		name: 'drizzle-postgresjs',
		about: 'Drizzle 0.45 on Postgres.js through the package binding.',
		reach: 'url',
		runtime: 'node',
		async open(started) {
			const { default: postgres } = await import('postgres');
			const { drizzle } = await import('drizzle-orm/postgres-js');
			const { sql: tag } = await import('drizzle-orm');
			const bridge = await import('@okikio/sql/postgres/drizzle');
			const client = postgres(urlOf(started), { max: 4, onnotice: () => {} });
			return {
				db: bridge.database(drizzle({ client }), tag),
				close: () => client.end(),
			};
		},
	},
	{
		name: 'kysely',
		about: "Kysely 0.29 on node-postgres through the package binding and Kysely's `sql` tag.",
		reach: 'url',
		runtime: 'node',
		async open(started) {
			const { default: pg } = await import('pg');
			const { Kysely, PostgresDialect, sql: tag } = await import('kysely');
			const bridge = await import('@okikio/sql/postgres/kysely');
			const db = new Kysely<Record<string, never>>({
				dialect: new PostgresDialect({
					pool: new pg.Pool({ connectionString: urlOf(started), max: 4 }),
				}),
			});
			return { db: bridge.database(db, tag), close: () => db.destroy() };
		},
	},
	{
		name: 'kysely-compiled-query',
		about: 'Kysely 0.29 by hand with `CompiledQuery.raw(text, values)`, passing the signal to `executeQuery`.',
		reach: 'url',
		runtime: 'node',
		async open(started) {
			const { default: pg } = await import('pg');
			const { Kysely, PostgresDialect, CompiledQuery } = await import('kysely');
			const db = new Kysely<Record<string, never>>({
				dialect: new PostgresDialect({
					pool: new pg.Pool({ connectionString: urlOf(started), max: 4 }),
				}),
			});
			type Target = Pick<typeof db, 'executeQuery'>;
			const run = (target: Target) => (query: CompiledType, options?: RunOptions) =>
				aborting(options, async (signal) =>
					(await target.executeQuery(
						CompiledQuery.raw(query.text, [...query.values]),
						signal ? { signal, inflightQueryAbortStrategy: 'cancel query' } : undefined,
					)).rows as Rows);
			return {
				db: port(run(db), (work, options) => {
					const builder = options?.isolation ? db.transaction().setIsolationLevel(options.isolation) : db.transaction();
					return builder.execute((trx) => work({ run: run(trx) } as Executor));
				}),
				close: () => db.destroy(),
			};
		},
	},
	{
		name: 'prisma',
		about: 'Prisma 7 with `@prisma/adapter-pg`, through `$queryRawUnsafe`.',
		reach: 'url',
		runtime: 'node',
		async open(started) {
			const { PrismaPg } = await import('@prisma/adapter-pg');
			return await prisma(new PrismaPg({ connectionString: urlOf(started) }));
		},
	},
	{
		name: 'typeorm',
		about: 'TypeORM 1.1 through `DataSource.query(text, values)`.',
		reach: 'url',
		runtime: 'node',
		async open(started) {
			await import('reflect-metadata');
			const { DataSource } = await import('typeorm');
			const source = await new DataSource({
				type: 'postgres',
				url: urlOf(started),
				logging: false,
			}).initialize();
			type Target = {
				query(text: string, values: unknown[]): Promise<unknown>;
			};
			const run = (target: Target) => async (query: CompiledType) => {
				const out = await target.query(query.text, [...query.values]);
				// TypeORM returns [rows, count] for an update or delete on some paths.
				return (Array.isArray(out) && Array.isArray(out[0]) ? out[0] : out) as Rows;
			};
			return {
				db: port(
					run(source),
					(work, options) =>
						options?.isolation
							? source.transaction(
								upper[options.isolation],
								(manager) => work({ run: run(manager) } as Executor),
							)
							: source.transaction((manager) => work({ run: run(manager) } as Executor)),
				),
				close: () => source.destroy(),
			};
		},
	},
	{
		name: 'sequelize',
		about: 'Sequelize 6 through `query(text, { bind })`.',
		reach: 'url',
		runtime: 'node',
		async open(started) {
			const { Sequelize, QueryTypes, Transaction } = await import('sequelize');
			const db = new Sequelize(urlOf(started), {
				logging: false,
				dialect: 'postgres',
			});
			// `bind` only when there are values: Sequelize reads `$body$` in a function body as a parameter otherwise.
			const run = (transaction?: InstanceType<typeof Transaction>) => async (query: CompiledType) =>
				(await db.query(query.text, {
					...(query.values.length ? { bind: [...query.values] } : {}),
					type: QueryTypes.RAW,
					transaction,
				}))[0] as Rows;
			const levels = {
				'read committed': Transaction.ISOLATION_LEVELS.READ_COMMITTED,
				'repeatable read': Transaction.ISOLATION_LEVELS.REPEATABLE_READ,
				serializable: Transaction.ISOLATION_LEVELS.SERIALIZABLE,
			};
			return {
				db: port(run(), (work, options) =>
					db.transaction(
						options?.isolation ? { isolationLevel: levels[options.isolation] } : {},
						(transaction) => work({ run: run(transaction) } as Executor),
					)),
				close: () => db.close(),
			};
		},
	},
	{
		name: 'knex',
		about: 'knex 3 through `raw(text, values)` with `?` placeholders.',
		reach: 'url',
		runtime: 'node',
		async open(started) {
			const { default: knex } = await import('knex');
			const db = knex({
				// knex's `pg` dialect reads the server version from `select version()` and fails on CockroachDB's.
				client: started.flavor === 'cockroach' ? 'cockroachdb' : 'pg',
				connection: urlOf(started),
				pool: { min: 0, max: 4 },
			});
			type Target = {
				raw(text: string, values: unknown[]): Promise<{ rows: Rows }>;
			};
			const run = (target: Target) => async (query: CompiledType) =>
				(await target.raw(positional(query), [...query.values])).rows;
			return {
				db: port(
					run(db as unknown as Target),
					(work, options) =>
						db.transaction(
							(trx) => work({ run: run(trx as unknown as Target) } as Executor),
							options?.isolation ? { isolationLevel: options.isolation } : undefined,
						),
				),
				close: () => db.destroy(),
			};
		},
	},
	{
		name: 'mikroorm',
		about: 'MikroORM 7 through `em.execute(text, values, { signal })` with `?` placeholders.',
		reach: 'url',
		runtime: 'node',
		async open(started) {
			const { MikroORM } = await import('@mikro-orm/postgresql');
			const orm = await MikroORM.init({
				clientUrl: urlOf(started),
				entities: [],
				discovery: { warnWhenNoEntities: false },
				debug: false,
				allowGlobalContext: true,
			});
			type Target = {
				execute(
					text: string,
					values: unknown[],
					options: Record<string, unknown>,
				): Promise<unknown>;
			};
			const run = (em: Target) => (query: CompiledType, options?: RunOptions) =>
				aborting(options, async (signal) =>
					await em.execute(
						positional(query),
						[...query.values],
						signal ? { signal, inflightQueryAbortStrategy: 'cancel query' } : {},
					) as Rows);
			return {
				db: port(
					run(orm.em as unknown as Target),
					(work, options) =>
						orm.em.transactional(
							(em) => work({ run: run(em as unknown as Target) } as Executor),
							options?.isolation ? { isolationLevel: options.isolation as never } : undefined,
						),
				),
				close: () => orm.close(true),
			};
		},
	},
	{
		name: 'slonik',
		about: 'Slonik 47 through `sql.unsafe` with the frozen template pieces.',
		reach: 'url',
		runtime: 'node',
		async open(started) {
			const { createPool, sql: tag } = await import('slonik');
			const pool = await createPool(urlOf(started), { maximumPoolSize: 4 });
			type Target = { query(query: unknown): Promise<{ rows: Rows }> };
			const run = (target: Target) => async (query: CompiledType) => [
				...(await target.query(
					tag.unsafe(query.strings, ...(query.values as never[])),
				)).rows,
			];
			return {
				db: port(
					run(pool as unknown as Target),
					(work, options) =>
						pool.transaction(async (connection) => {
							if (options?.isolation) {
								await connection.query(
									tag.unsafe(
										template(
											`set transaction isolation level ${upper[options.isolation]}`,
										),
									),
								);
							}
							return await work(
								{ run: run(connection as unknown as Target) } as Executor,
							);
						}),
				),
				close: () => pool.end(),
			};
		},
	},
	{
		name: 'pg-promise',
		about: 'pg-promise 12 through `any(text, values)`.',
		reach: 'url',
		runtime: 'node',
		async open(started) {
			const { default: pgp } = await import('pg-promise');
			const library = pgp();
			const db = library(urlOf(started));
			const { TransactionMode, isolationLevel } = library.txMode;
			const levels = {
				'read committed': isolationLevel.readCommitted,
				'repeatable read': isolationLevel.repeatableRead,
				serializable: isolationLevel.serializable,
			};
			return {
				db: port(
					(query) => db.any(query.text, [...query.values]),
					(work, options) =>
						db.tx(
							options?.isolation
								? {
									mode: new TransactionMode({
										tiLevel: levels[options.isolation],
									}),
								}
								: {},
							(t) =>
								work({
									run: (query: CompiledType) => t.any(query.text, [...query.values]),
								} as Executor),
						),
				),
				close: () => Promise.resolve(library.end()),
			};
		},
	},
];
