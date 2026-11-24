/** Read the catalog back: the server's catalog must describe the tables as the package defined them. @module */
import { drift, generate, inspect } from '@okikio/sql/postgres/adopt';
import { same } from './check.ts';
import type { CaseType } from './types.ts';

export const adopt: readonly CaseType[] = [
	{
		name: 'inspect, generate and drift agree with the definitions',
		after: [
			'create tables with identity, serial and checks',
			'create table with an enum column',
			'create table with dates, intervals, bytes, arrays and a composite',
		],
		run: async ({ db, name, t }) => {
			const found = await inspect(db, [name]);
			const tables = found.tables.filter((table) => table.kind !== 'composite')
				.map((table) => table.name).sort();
			for (const table of ['Extras', 'history', 'kinds', 'nodes', 'typed']) {
				if (!tables.includes(table)) {
					throw new Error(
						`inspect missed ${table}; found ${tables.join(', ')}`,
					);
				}
			}
			if (!generate(found).includes(`table("typed"`)) {
				throw new Error('generate wrote no "typed" table');
			}
			const problems = (await drift(db, [t.kinds, t.nodes, t.history, t.extras, t.typed]))
				.filter((item) => item.severity === 'error')
				.map((item) => `${item.table}${item.column ? `.${item.column}` : ''}: ${item.problem}`);
			same(problems, [], 'drift errors');
		},
	},
];
