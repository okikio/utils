/** The `pg-promise` client. @module */
import type { CompiledType, Executor } from '@okikio/sql/postgres';
import { type ClientType, port, urlOf } from './types.ts';

export const client: ClientType = {
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
};
