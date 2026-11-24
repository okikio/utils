/** Deno's `@db/postgres`, run in Deno by `runtime.ts`. @module */
import type { Database } from '@okikio/sql/postgres';
import type { ClientType } from './types.ts';

type Rows = readonly Record<string, unknown>[];

/** Deno's `@db/postgres`, with a pool of four connections. Runs only in Deno. */
export async function open(
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

export const clients: readonly ClientType[] = [
	{
		name: 'deno-postgres',
		about: "Deno's `@db/postgres` 0.19, run in Deno.",
		reach: 'url',
		runtime: 'deno',
	},
];
