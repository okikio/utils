/** Bun's built-in SQL client, run in Bun by `runtime.ts`. @module */
import type { CompiledType, Database, Executor } from '@okikio/sql/postgres';
import type { ClientType } from './types.ts';

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

/** Bun's SQL client, as `unsafe(text, values)` or as a tag with the template pieces. Runs only in Bun. */
export async function open(
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

export const clients: readonly ClientType[] = [
	{
		name: 'bun-sql',
		about: "Bun's built-in SQL client with `unsafe(text, values)`, run in Bun.",
		reach: 'url',
		runtime: 'bun',
	},
	{
		name: 'bun-sql-unprepared',
		about: "Bun's built-in SQL client with `prepare: false`, run in Bun.",
		reach: 'url',
		runtime: 'bun',
	},
	{
		name: 'bun-sql-template',
		about: "Bun's built-in SQL client called as a tag with the template pieces, run in Bun.",
		reach: 'url',
		runtime: 'bun',
	},
];
