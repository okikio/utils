/**
 * Run every case through a SQL client built into Bun or Deno, in that runtime. The Node suite starts this file as a
 * child process and reads one JSON line of outcomes from its output.
 *
 * Usage: `bun tests/interop/runtime.ts <client> <url> <schema>` or
 * `deno run -A --no-lock tests/interop/runtime.ts <client> <url> <schema>`.
 *
 * @module
 */
import '@okikio/duration/polyfill';
import type { CompiledType, Database, Executor } from '@okikio/sql/postgres';
import { type FlavorType, runCases } from './cases/mod.ts';

type Rows = readonly Record<string, unknown>[];
type Bun = {
	SQL: new (url: string, options: Record<string, unknown>) => BunSql;
};
type BunSql = {
	(strings: TemplateStringsArray, ...values: unknown[]): Promise<Rows>;
	unsafe(text: string, values?: unknown[]): Promise<Rows>;
	begin<T>(...args: unknown[]): Promise<T>;
	close(): Promise<void>;
};

/** Bun's SQL client, as `unsafe(text, values)` or as a tag with the template pieces. */
async function bun(
	url: string,
	variant: string,
): Promise<{ db: Database; close(): Promise<void> }> {
	const { SQL } = await import('bun' as string) as Bun;
	const client = new SQL(url, {
		max: 4,
		prepare: variant !== 'bun-sql-unprepared',
	});
	const run = (target: BunSql) => async (query: CompiledType) => [
		...await (variant === 'bun-sql-template'
			? target(query.strings, ...query.values)
			: target.unsafe(query.text, [...query.values])),
	];
	return {
		db: {
			run: run(client),
			begin: (work, options) =>
				options?.isolation
					? client.begin(
						`isolation level ${options.isolation}`,
						(tx: BunSql) => work({ run: run(tx) } as Executor),
					)
					: client.begin((tx: BunSql) => work({ run: run(tx) } as Executor)),
		},
		close: () => client.close(),
	};
}

/** Deno's `@db/postgres`, with a pool of four connections. */
async function deno(
	url: string,
): Promise<{ db: Database; close(): Promise<void> }> {
	type Connection = {
		queryObject(text: string, values: unknown[]): Promise<{ rows: Rows }>;
		createTransaction(name: string, options: Record<string, unknown>): {
			begin(): Promise<void>;
			commit(): Promise<void>;
			rollback(): Promise<void>;
			queryObject(text: string, values: unknown[]): Promise<{ rows: Rows }>;
		};
		release(): void;
	};
	const { Pool } = await import('jsr:@db/postgres@0.19.5' as string) as {
		Pool: new (
			url: string,
			size: number,
			lazy: boolean,
		) => { connect(): Promise<Connection>; end(): Promise<void> };
	};
	const pool = new Pool(url, 4, true);
	let count = 0;
	return {
		db: {
			async run(query) {
				const connection = await pool.connect();
				try {
					return (await connection.queryObject(query.text, [...query.values]))
						.rows;
				} finally {
					connection.release();
				}
			},
			async begin(work, options) {
				const connection = await pool.connect();
				const tx = connection.createTransaction(
					`interop_${++count}`,
					options?.isolation ? { isolation_level: options.isolation.replace(' ', '_') } : {},
				);
				try {
					await tx.begin();
					const result = await work({
						run: async (query) => (await tx.queryObject(query.text, [...query.values])).rows,
					});
					await tx.commit();
					return result;
				} catch (error) {
					await tx.rollback().catch(() => {});
					throw error;
				} finally {
					connection.release();
				}
			},
		},
		close: () => pool.end(),
	};
}

const [client, url, schema, flavor = 'postgres'] = (globalThis as { Deno?: { args: string[] } }).Deno?.args ??
	(globalThis as unknown as { process: { argv: string[] } }).process.argv
		.slice(2);
if (!client || !url || !schema) {
	throw new TypeError('Usage: runtime.ts <client> <url> <schema>');
}
const opened = client === 'deno-postgres' ? await deno(url) : await bun(url, client);
try {
	const outcomes = await runCases(opened.db, schema, {
		flavor: flavor as FlavorType,
	});
	console.log(`interop-outcomes ${JSON.stringify(outcomes)}`);
} finally {
	await opened.close();
}
