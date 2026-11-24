/**
 * Write table definitions for an existing schema, from what {@link inspect} reads.
 *
 * {@link generate} turns the catalog into TypeScript source that defines each table with this package, under a schema
 * marked `{ owned: false }`. Commit the output, and run `drift` in a test so a later change to the schema made
 * elsewhere fails there instead of in production.
 *
 * @example
 * ```ts ignore
 * import { generate, inspect } from '@okikio/sql/postgres/adopt';
 * await Deno.writeTextFile('tables.ts', generate(await inspect(db, ['prisma_app'])));
 * ```
 *
 * @module
 */
import type { ColumnInfoType, InspectionType, TableInfoType } from './catalog.ts';

/** Options for {@link generate}. */
export interface GenerateOptions {
	/** The module that exports `sql` and `types`. Defaults to `@okikio/sql/postgres`. */
	readonly from?: string;
}

const builtins: Readonly<Record<string, string>> = {
	int2: 'types.smallint',
	int4: 'types.integer',
	int8: 'types.bigint',
	float4: 'types.real',
	float8: 'types.double',
	numeric: 'types.numeric',
	text: 'types.text()',
	varchar: 'types.text()',
	bpchar: 'types.text()',
	name: 'types.text()',
	char: 'types.text()',
	citext: 'types.text()',
	bool: 'types.boolean',
	uuid: 'types.uuid',
	json: 'types.jsonb()',
	jsonb: 'types.jsonb()',
	timestamptz: 'types.timestamptz',
	timestamp: 'types.timestamp',
	date: 'types.date',
	time: 'types.time',
	interval: 'types.interval',
	bytea: 'types.bytea',
};

const literal = (value: string): string => JSON.stringify(value);
const key = (name: string): string => /^[A-Za-z_$][\w$]*$/u.test(name) ? name : literal(name);
const variable = (name: string): string => {
	const words = name.replace(/[^A-Za-z0-9_$]+/gu, '_');
	return /^[0-9]/u.test(words) ? `_${words}` : words;
};

/** The type expression for a type name and kind. */
function typeOf(
	schema: string,
	name: string,
	kind: string,
	info: InspectionType,
	composites: ReadonlyMap<string, TableInfoType>,
	base?: string,
): string {
	if (kind === 'e') {
		const labels = info.enums[`${schema}.${name}`] ?? [];
		return `types.enumerated([${literal(schema)}, ${literal(name)}], [${labels.map(literal).join(', ')}])`;
	}
	if (kind === 'c') {
		const fields = composites.get(`${schema}.${name}`);
		if (fields) {
			const members = fields.columns.map((field) =>
				`${key(field.name)}: types.nullable(${columnType(field, info, composites)})`
			);
			return `types.composite([${literal(schema)}, ${literal(name)}], { ${members.join(', ')} })`;
		}
	}
	if (kind === 'd' && base && builtins[base]) return builtins[base]!;
	return builtins[name] ?? `types.custom([${literal(schema)}, ${literal(name)}])`;
}

function columnType(
	column: ColumnInfoType,
	info: InspectionType,
	composites: ReadonlyMap<string, TableInfoType>,
): string {
	if (column.element) {
		const element = typeOf(column.element.schema, column.element.name, column.element.kind, info, composites);
		return `types.array(types.nullable(${element}))`;
	}
	return typeOf(column.typeSchema, column.typeName, column.typeKind, info, composites, column.base);
}

/** One column's builder chain. */
function columnSource(column: ColumnInfoType, info: InspectionType, composites: ReadonlyMap<string, TableInfoType>) {
	let out = `sql.column(${columnType(column, info, composites)})`;
	if (column.nullable) out += '.nullable()';
	if (column.generated || column.identity === 'always') out += '.computed()';
	else if (column.fallback !== undefined || column.identity === 'by default') out += '.filled()';
	const notes = [
		column.declared,
		column.identity ? `identity ${column.identity}` : '',
		column.fallback ? `${column.generated ? 'generated as' : 'default'} ${column.fallback}` : '',
		column.fallback?.includes('infinity') ? 'an infinite value cannot be read' : '',
	].filter(Boolean).join(', ');
	return `\t${key(column.name)}: ${out}, // ${notes}`;
}

/** TypeScript source that defines every table and view of an inspection under schemas marked `{ owned: false }`. */
export function generate(info: InspectionType, options: GenerateOptions = {}): string {
	const from = options.from ?? '@okikio/sql/postgres';
	const composites = new Map(
		info.tables.filter((table) => table.kind === 'composite').map((table) => [`${table.schema}.${table.name}`, table]),
	);
	const schemas = [...new Set(info.tables.filter((table) => table.kind !== 'composite').map((table) => table.schema))];
	const lines = [
		'// Generated from the PostgreSQL catalog. The tables belong to another tool; run `drift` to keep this in step.',
		`import * as sql from ${literal(from)};`,
		`import { types } from ${literal(from)};`,
		'',
	];
	for (const schemaName of schemas) {
		const space = `${variable(schemaName)}Schema`;
		lines.push(`export const ${space} = sql.schema(${literal(schemaName)}, { owned: false });`, '');
		for (const table of info.tables.filter((item) => item.schema === schemaName && item.kind !== 'composite')) {
			lines.push(
				`/** ${
					table.kind === 'table' ? 'Table' : table.kind[0]!.toUpperCase() + table.kind.slice(1)
				} "${schemaName}"."${table.name}". */`,
			);
			lines.push(`export const ${variable(table.name)} = ${space}.table(${literal(table.name)}, {`);
			for (const column of table.columns) lines.push(columnSource(column, info, composites));
			lines.push(
				table.primaryKey.length
					? `}, (c) => ({ primaryKey: [${table.primaryKey.map((name) => `c[${literal(name)}]`).join(', ')}] }));`
					: '});',
				'',
			);
		}
	}
	return lines.join('\n');
}
