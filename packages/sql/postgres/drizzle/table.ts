/**
 * Turn a Drizzle table into a table definition of this package, so both describe one table from one source.
 *
 * {@link table} reads what Drizzle knows at run time: each column's database name, type, `not null`, default, identity
 * and generated flags, enum values and the primary key. It maps them to this package's types under a schema marked
 * `{ owned: false }`, since Drizzle Kit owns the migrations. The static type comes from the same Drizzle metadata, so
 * a column added in Drizzle shows up here with no second edit.
 *
 * Values follow this package's types, not Drizzle's modes: a `timestamp` is a `Temporal.Instant` even when Drizzle
 * reads it as a `Date`, and a `numeric` is exact text even in Drizzle's `number` mode. The two never share a value, so
 * each side keeps its own.
 *
 * A Drizzle `$defaultFn` or `$onUpdateFn` runs here too, through `onInsert` and `onUpdate`, with its value converted to
 * this package's type. A function that returns Drizzle `sql` cannot be converted and fails when the statement is
 * built. A column of a type with no mapping here, such as `customType`, `inet` or `vector`, fails when the table is
 * read; adopt that table through `inspect` and `generate` instead.
 *
 * @module
 */
import type { Temporal } from '@okikio/duration/temporal';
import { temporal } from '@okikio/duration/temporal';
import type { ColumnBuilder, ColumnDef, Table } from '../../table.ts';
import type { SqlType } from '../../type.ts';
import { column, schema } from '../mod.ts';
import * as types from '../types/mod.ts';
import type { IntervalType } from '../types/mod.ts';

/** The phantom type Drizzle keeps on each column. */
interface ColumnTypeInfo {
	readonly columnType: string;
	readonly notNull: boolean;
	readonly hasDefault: boolean;
	readonly data: unknown;
	readonly enumValues: unknown;
	readonly baseColumn?: unknown;
	readonly identity?: 'always' | 'byDefault' | undefined;
	readonly generated?: unknown;
}

/** A Drizzle column, as far as this module reads it. */
export interface DrizzleColumn {
	readonly _: ColumnTypeInfo;
}

/** A Drizzle PostgreSQL table, as far as this module reads it. */
export interface DrizzleTable {
	readonly _: {
		readonly name: string;
		readonly schema: string | undefined;
		readonly columns: Readonly<Record<string, DrizzleColumn>>;
	};
}

/** What `getTableConfig` from `drizzle-orm/pg-core` returns, as far as this module reads it. */
export interface DrizzleConfig {
	readonly name: string;
	readonly schema?: string | undefined;
	readonly columns: readonly RuntimeColumn[];
	readonly primaryKeys: readonly { readonly columns: readonly RuntimeColumn[] }[];
}

/** A Drizzle column at run time. */
interface RuntimeColumn {
	readonly name: string;
	readonly columnType: string;
	readonly notNull: boolean;
	readonly primary: boolean;
	readonly default?: unknown;
	readonly defaultFn?: (() => unknown) | undefined;
	readonly onUpdateFn?: (() => unknown) | undefined;
	readonly enumValues?: readonly string[] | undefined;
	readonly enum?: { readonly enumName: string; readonly schema?: string | undefined };
	readonly withTimezone?: boolean;
	readonly baseColumn?: RuntimeColumn;
	readonly generated?: unknown;
	readonly generatedIdentity?: { readonly type: 'always' | 'byDefault' } | undefined;
}

/** The value each Drizzle column type has in this package. */
interface Values {
	PgInteger: number;
	PgSmallInt: number;
	PgSerial: number;
	PgSmallSerial: number;
	PgReal: number;
	PgDoublePrecision: number;
	PgBigInt53: number;
	PgBigSerial53: number;
	PgBigInt64: bigint;
	PgBigSerial64: bigint;
	PgNumeric: string;
	PgNumericNumber: string;
	PgNumericBigInt: string;
	PgBoolean: boolean;
	PgUUID: string;
	PgTimestamp: Temporal.Instant;
	PgTimestampString: Temporal.Instant;
	PgDate: Temporal.PlainDate;
	PgDateString: Temporal.PlainDate;
	PgTime: Temporal.PlainTime;
	PgInterval: IntervalType;
}

/** A column's value in this package, before `null`. */
export type ValueOf<I> = I extends { readonly columnType: infer K } ? K extends keyof Values ? Values[K]
	: K extends 'PgText' | 'PgVarchar' | 'PgChar' | 'PgEnumColumn' | 'PgEnumObjectColumn'
		? I extends { readonly enumValues: readonly [string, ...string[]] } ? I['enumValues'][number] : string
	: K extends 'PgJson' | 'PgJsonb' ? I extends { readonly data: infer D } ? D : unknown
	: K extends 'PgArray' ? I extends { readonly baseColumn: { readonly _: infer B } } ? readonly (ValueOf<B> | null)[]
		: never
	: never
	: never;

/** Whether the database writes the column: an identity `always`, or a generated column. */
type LockedOf<I extends ColumnTypeInfo> = I['identity'] extends 'always' ? true
	: undefined extends I['generated'] ? false
	: true;

/** The column definition for a Drizzle column. */
export type DefOf<I extends ColumnTypeInfo> = ColumnDef<
	I['notNull'] extends true ? ValueOf<I> : ValueOf<I> | null,
	I['notNull'] extends true ? I['hasDefault'] extends true ? true : LockedOf<I> : true,
	LockedOf<I>
>;

/** The table definition for a Drizzle table. */
export type TableOf<D extends DrizzleTable> = Table<
	{ readonly [K in keyof D['_']['columns'] & string]: DefOf<D['_']['columns'][K]['_']> },
	`${D['_']['schema'] extends string ? D['_']['schema'] : 'public'}.${D['_']['name']}`
>;

/** The scalar type for a Drizzle column type, or `undefined` when there is none. */
function scalar(info: RuntimeColumn): SqlType<unknown> | undefined {
	switch (info.columnType) {
		case 'PgInteger':
		case 'PgSerial':
			return types.integer;
		case 'PgSmallInt':
		case 'PgSmallSerial':
			return types.smallint;
		case 'PgReal':
			return types.real;
		case 'PgDoublePrecision':
			return types.double;
		case 'PgBigInt53':
		case 'PgBigSerial53':
			return types.long;
		case 'PgBigInt64':
		case 'PgBigSerial64':
			return types.bigint;
		case 'PgNumeric':
		case 'PgNumericNumber':
		case 'PgNumericBigInt':
			return types.numeric;
		case 'PgBoolean':
			return types.boolean;
		case 'PgUUID':
			return types.uuid;
		case 'PgText':
		case 'PgVarchar':
		case 'PgChar':
			return types.text(info.enumValues?.length ? info.enumValues : undefined);
		case 'PgEnumColumn':
		case 'PgEnumObjectColumn':
			if (!info.enum || !info.enumValues) return undefined;
			return types.enumerated([info.enum.schema ?? 'public', info.enum.enumName], info.enumValues);
		case 'PgJson':
		case 'PgJsonb':
			return types.jsonb();
		case 'PgTimestamp':
		case 'PgTimestampString':
			return info.withTimezone ? types.timestamptz : types.timestamp;
		case 'PgDate':
		case 'PgDateString':
			return types.date;
		case 'PgTime':
			return types.time;
		case 'PgInterval':
			return types.interval;
		case 'PgArray':
			if (!info.baseColumn) return undefined;
			return mapped(info.baseColumn, (element) => types.array(types.nullable(element)));
		default:
			return undefined;
	}
}

const mapped = (info: RuntimeColumn, wrap: (type: SqlType<unknown>) => SqlType<unknown>) => {
	const element = scalar(info);
	return element && wrap(element);
};

/** Whether a value is Drizzle `sql`, which this package cannot run. */
const isSql = (value: unknown): boolean => typeof value === 'object' && value !== null && 'queryChunks' in value;

/** An instant from Drizzle's string mode, which leaves out the offset of a `timestamp` without time zone. */
function instantOf(text: string): Temporal.Instant {
	const iso = text.replace(' ', 'T');
	return temporal.Instant.from(/(?:Z|[+-]\d\d(?::?\d\d)?)$/iu.test(iso) ? iso : `${iso}Z`);
}

/** Convert what a Drizzle `$defaultFn` or `$onUpdateFn` returns to this package's value for the column. */
function converted(info: RuntimeColumn, key: string, value: unknown): unknown {
	if (isSql(value)) {
		throw new TypeError(
			`The Drizzle default of "${key}" returns sql, which this package cannot run. Give the column a database default.`,
		);
	}
	if (value === null || value === undefined) return null;
	switch (info.columnType) {
		case 'PgTimestamp':
			return value instanceof Date ? temporal.Instant.fromEpochMilliseconds(value.getTime()) : value;
		case 'PgTimestampString':
			return typeof value === 'string' ? instantOf(value) : value;
		case 'PgDate':
			return value instanceof Date ? temporal.PlainDate.from(value.toISOString().slice(0, 10)) : value;
		case 'PgDateString':
			return typeof value === 'string' ? temporal.PlainDate.from(value) : value;
		case 'PgTime':
			return typeof value === 'string' ? temporal.PlainTime.from(value) : value;
		case 'PgNumericNumber':
		case 'PgNumericBigInt':
			return String(value);
		case 'PgInterval':
			throw new TypeError(`The Drizzle default of "${key}" is interval text, which this package cannot convert.`);
		default:
			return value;
	}
}

/** One column's definition. */
function define(key: string, info: RuntimeColumn): ColumnDef<unknown> {
	const type = scalar(info);
	if (!type) {
		throw new TypeError(
			`Column "${key}" has Drizzle type ${info.columnType}, which has no type here. Adopt the table with inspect and generate.`,
		);
	}
	let def: ColumnBuilder<unknown, boolean, boolean> = column(type);
	if (!info.notNull) def = def.nullable();
	if (info.name !== key) def = def.named(info.name);
	if (info.generated !== undefined || info.generatedIdentity?.type === 'always') return def.computed();
	if (info.default !== undefined || info.generatedIdentity || /Serial/u.test(info.columnType)) def = def.filled();
	const { defaultFn, onUpdateFn } = info;
	if (defaultFn) def = def.onInsert(() => converted(info, key, defaultFn()) as never);
	if (onUpdateFn) def = def.onUpdate(() => converted(info, key, onUpdateFn()) as never);
	return def;
}

/**
 * The table definition for a Drizzle table. Pass `getTableConfig` from `drizzle-orm/pg-core`; this package does not
 * depend on Drizzle.
 *
 * @example
 * ```ts ignore
 * import { getTableConfig } from 'drizzle-orm/pg-core';
 * import * as drizzle from '@okikio/sql/postgres/drizzle';
 * import { accounts as drizzleAccounts } from './schema.ts';
 *
 * const accounts = drizzle.table(drizzleAccounts, getTableConfig);
 * sql.select({ name: accounts.c.displayName }).from(accounts);
 * ```
 */
export function table<D extends DrizzleTable>(source: D, config: (table: never) => DrizzleConfig): TableOf<D> {
	const info = config(source as never);
	const keys = new Map<unknown, string>(
		Object.entries(source).map(([key, value]) => [value, key] as const),
	);
	const columns: Record<string, ColumnDef<unknown>> = {};
	const byName = new Map<string, string>();
	for (const item of info.columns) {
		const key = keys.get(item) ?? item.name;
		columns[key] = define(key, item);
		byName.set(item.name, key);
	}
	const primary = info.primaryKeys[0]?.columns.map((item) => item.name) ??
		info.columns.filter((item) => item.primary).map((item) => item.name);
	const defined = schema(info.schema ?? 'public', { owned: false }).table(info.name, columns, (c) => ({
		...(primary.length ? { primaryKey: primary.map((name) => c[byName.get(name)!]!) } : {}),
	}));
	return defined as unknown as TableOf<D>;
}
