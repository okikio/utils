/** The `mikroorm` client. @module */
import type { CompiledType, Executor, RunOptions } from '@okikio/sql/postgres';
import { aborting, type ClientType, port, positional, urlOf } from './types.ts';

type Rows = readonly Record<string, unknown>[];

export const client: ClientType = {
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
};
