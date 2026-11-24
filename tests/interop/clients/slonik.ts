/** The `slonik` client. @module */
import type { CompiledType, Executor } from '@okikio/sql/postgres';
import { type ClientType, port, template, upper, urlOf } from './types.ts';

type Rows = readonly Record<string, unknown>[];

export const client: ClientType = {
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
};
