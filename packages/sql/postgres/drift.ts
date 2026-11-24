/**
 * Compare table definitions with the live database, so a schema made elsewhere cannot drift from what the code expects.
 *
 * `describe` checks statements, but it cannot see a wrong column type, because reads cast to text. {@link drift}
 * reads the catalog and reports each difference that would fail or change a value:
 *
 * - **error**: a missing table or column; a type that reads or writes wrongly, such as `integer` for a `bigint`
 *   column or `timestamptz` for a `timestamp` column; a column that may hold NULL but is declared not nullable; a
 *   required column an insert would leave empty; a database-written column the definition writes.
 * - **warning**: a type that works for most values but not all, such as `text` for `varchar(255)`, `jsonb` for `json`
 *   or `double` for `numeric`.
 *
 * Run it in a test or at startup against the real database.
 *
 * @example
 * ```ts ignore
 * const problems = await drift(db, [users, posts]);
 * if (problems.some((item) => item.severity === 'error')) throw new Error(JSON.stringify(problems));
 * ```
 *
 * @module
 */
import type { Executor } from '../run.ts';
import type { Columns, Table } from '../table.ts';
import { type ColumnInfoType, inspect } from './catalog.ts';

/** One difference between a definition and the database. */
export interface DriftType {
	readonly table: string;
	readonly column?: string;
	readonly severity: 'error' | 'warning';
	readonly problem: string;
}

/** Catalog names for the package's type names, where they differ. */
const aliases: Readonly<Record<string, string>> = {
	timestamptz: 'timestamp with time zone',
	timestamp: 'timestamp without time zone',
	time: 'time without time zone',
};

/** Pairs that work for most values: declared type → database types. */
const near: Readonly<Record<string, readonly string[]>> = {
	text: ['character varying', 'character', 'citext', 'name', 'char'],
	jsonb: ['json'],
	'double precision': ['numeric', 'real'],
	numeric: ['integer', 'bigint', 'smallint', 'double precision', 'real'],
	bigint: ['integer', 'smallint'],
	integer: ['smallint'],
	real: ['double precision'],
};

/** A type name without quotes or modifiers, such as `character varying` or `app.mood`. */
function plain(name: string): string {
	const array = name.endsWith('[]');
	const base = (array ? name.slice(0, -2) : name).replace(/\(\d+(?:,\s*\d+)?\)/u, '').replaceAll('"', '');
	return (aliases[base] ?? base) + (array ? '[]' : '');
}

/** The database type of a column, in the same form: built-in types by name, others as `schema.type`. */
function actual(column: ColumnInfoType): string {
	const user = (kind: string) => kind === 'e' || kind === 'c' || kind === 'd';
	if (column.element) {
		return user(column.element.kind) ? `${column.element.schema}.${column.element.name}[]` : plain(column.declared);
	}
	return user(column.typeKind) && column.typeKind !== 'd'
		? `${column.typeSchema}.${column.typeName}`
		: plain(column.declared);
}

/** Compare every definition with the database and list the differences, errors first. */
export async function drift(executor: Executor, tables: readonly Table<Columns>[]): Promise<readonly DriftType[]> {
	const found = await inspect(executor, [...new Set(tables.map((table) => table.schema))]);
	const problems: DriftType[] = [];
	for (const table of tables) {
		const where = `${table.schema}.${table.name}`;
		const info = found.tables.find((item) => item.schema === table.schema && item.name === table.name);
		if (!info) {
			problems.push({ table: where, severity: 'error', problem: 'The table does not exist.' });
			continue;
		}
		const columns = new Map(info.columns.map((column) => [column.name, column]));
		const declared = new Set<string>();
		for (const [key, def] of Object.entries(table.columns)) {
			const name = def.column ?? key;
			declared.add(name);
			const column = columns.get(name);
			const report = (severity: DriftType['severity'], problem: string) =>
				problems.push({ table: where, column: name, severity, problem });
			if (!column) {
				report('error', 'The column does not exist.');
				continue;
			}
			const want = plain(def.type.name);
			const have = actual(column);
			const domainBase = column.typeKind === 'd' && column.base ? plain(column.base) : undefined;
			if (want !== have && want !== domainBase) {
				const close = near[want]?.includes(have) || (domainBase && near[want]?.includes(domainBase));
				report(
					close ? 'warning' : 'error',
					`Declared ${def.type.name}, but the column is ${column.declared}.` +
						(close ? ' Most values work; some may be cut, rounded or refused.' : ''),
				);
			}
			if (column.nullable && !def.allowsNull) {
				report('error', 'The column allows NULL, but the definition does not; reading a NULL fails.');
			}
			const written = Boolean(column.generated || column.identity === 'always');
			if (written && !def.generated) report('error', 'The database writes this column; mark it `.computed()`.');
			// `.default()`, `.filled()` and `.serial()` let inserts omit the column and leave it to the database.
			const reliesOnDatabase = def.fallback !== undefined || def.databaseFills === true || def.sequenced === true;
			const databaseFills = column.fallback !== undefined || column.identity !== undefined || column.generated ||
				column.nullable;
			if (reliesOnDatabase && !databaseFills && !def.insertValue) {
				report('error', 'Inserts may omit the column, but the database has no default for it.');
			}
		}
		if (info.kind === 'table' || info.kind === 'partitioned') {
			for (const column of info.columns) {
				if (declared.has(column.name)) continue;
				const required = !column.nullable && column.fallback === undefined && column.identity === undefined &&
					!column.generated;
				if (required) {
					problems.push({
						table: where,
						column: column.name,
						severity: 'error',
						problem: 'A required column is missing from the definition, so every insert fails.',
					});
				}
			}
		}
	}
	return problems.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}
