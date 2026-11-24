/** The `sequelize` client. @module */
import type { CompiledType, Executor } from '@okikio/sql/postgres';
import { type ClientType, port, urlOf } from './types.ts';

type Rows = readonly Record<string, unknown>[];

export const client: ClientType = {
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
};
