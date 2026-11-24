/** The `pglite` client. @module */
import type { CompiledType, Executor } from '@okikio/sql/postgres';
import { type ClientType, port } from './types.ts';

type Rows = readonly Record<string, unknown>[];

export const client: ClientType = {
	name: 'pglite',
	about: 'PGlite 0.6 in this process through `query(text, values)`.',
	reach: 'embedded',
	runtime: 'node',
	async open() {
		const { PGlite } = await import('@electric-sql/pglite');
		const db = await PGlite.create();
		type Target = {
			query(text: string, values: unknown[]): Promise<{ rows: unknown[] }>;
		};
		const run = (target: Target) => async (query: CompiledType) =>
			(await target.query(query.text, [...query.values])).rows as Rows;
		return {
			db: port(run(db), (work, options) =>
				db.transaction(async (tx) => {
					if (options?.isolation) {
						await tx.exec(
							`set transaction isolation level ${options.isolation}`,
						);
					}
					return await work({ run: run(tx) } as Executor);
				})),
			close: () => db.close(),
		};
	},
};
