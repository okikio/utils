/** The `typeorm` client. @module */
import type { CompiledType, Executor } from '@okikio/sql/postgres';
import { type ClientType, port, upper, urlOf } from './types.ts';

type Rows = readonly Record<string, unknown>[];

export const client: ClientType = {
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
};
