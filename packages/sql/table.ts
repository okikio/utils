/**
 * Tables, columns and constraints, defined once in TypeScript.
 *
 * A table definition is the single source for three things: the typed column expressions that queries use, the
 * `create table` statement that migrations run, and the shape that a schema check compares with the live database.
 *
 * @example
 * ```ts
 * const outbox = schema('utils_outbox');
 * const messages = outbox.table('messages', {
 * 	namespace: column(types.text()),
 * 	id: column(types.text()),
 * 	attempt: column(types.integer).default(0),
 * 	token: column(types.text()).nullable(),
 * }, (c) => ({ primaryKey: [c.namespace, c.id] }));
 *
 * messages.c.attempt.gt(3); // Expr<boolean>
 * ```
 *
 * @module
 */
import { Column, type Expr, type Input, lift, type OrderType } from './expr.ts';
import { identifier, qualified } from './fragment.ts';
import * as types from './type.ts';
import type { SqlType } from './type.ts';

const brand: unique symbol = Symbol('okikio.sql.column');

/** A column definition: its type, whether it may be NULL, and how it gets a value when an insert omits it. */
export interface ColumnDef<T, Optional extends boolean = boolean> {
	readonly [brand]: true;
	readonly type: SqlType<T>;
	/** Whether the column may hold SQL NULL. */
	readonly allowsNull: boolean;
	/** A default value or expression; inserts may omit the column. */
	readonly fallback?: Input<T>;
	/** `generated always as identity`; inserts must omit the column. */
	readonly generated: boolean;
	/** `bigserial`: a sequence fills the column when an insert omits it. */
	readonly sequenced?: boolean;
	/** Phantom flag: an insert may omit this column. */
	readonly optional?: Optional;
}

/** A column definition being built. */
export interface ColumnBuilder<T, Optional extends boolean> extends ColumnDef<T, Optional> {
	/** Allow SQL NULL; an insert may then omit the column. */
	nullable(): ColumnBuilder<T | null, true>;
	/** Give the column a default; an insert may then omit it. */
	default(value: Input<T>): ColumnBuilder<T, true>;
	/** Make a `bigint` column `generated always as identity`. */
	identity(): ColumnBuilder<T, true>;
	/**
	 * Make a `bigint` column a `bigserial`, filled from a sequence when an insert omits it. Prefer
	 * {@link ColumnBuilder.identity} for a new table; this keeps an existing `bigserial` column as it is.
	 */
	serial(): ColumnBuilder<T, true>;
	/**
	 * Let inserts omit the column because a `before insert` trigger fills it. The column keeps `not null`, which
	 * PostgreSQL checks after the trigger runs.
	 */
	filled(): ColumnBuilder<T, true>;
}

/** Start a column definition of a type. */
export function column<T>(type: SqlType<T>): ColumnBuilder<T, false> {
	return build({ [brand]: true, type, allowsNull: false, generated: false });
}

function build<T, Optional extends boolean>(definition: ColumnDef<T, boolean>): ColumnBuilder<T, Optional> {
	return Object.freeze({
		...definition,
		nullable: () => build<T | null, true>({ ...definition, type: types.nullable(definition.type), allowsNull: true }),
		default: (value: Input<T>) => build<T, true>({ ...definition, fallback: value }),
		identity: () => {
			if (definition.type.name !== 'bigint') throw new TypeError('Only a bigint column can be an identity.');
			return build<T, true>({ ...definition, generated: true });
		},
		filled: () => build<T, true>(definition),
		serial: () => {
			if (definition.type.name !== 'bigint') throw new TypeError('Only a bigint column can be a bigserial.');
			return build<T, true>({ ...definition, sequenced: true });
		},
	}) as unknown as ColumnBuilder<T, Optional>;
}

/** Column definitions of a table, by name. */
export type Columns = Readonly<Record<string, ColumnDef<unknown>>>;

/** The column expressions of a table. */
export type Refs<C extends Columns> = { readonly [K in keyof C]: C[K] extends ColumnDef<infer T> ? Column<T> : never };

/** The value type of each column. */
export type RowOf<C extends Columns> = { [K in keyof C]: C[K] extends ColumnDef<infer T> ? T : never };

/** An index. Plain columns are written by name; other entries are expressions. */
export interface IndexType {
	readonly name: string;
	/** The index method. Defaults to `btree`; use `gin` for JSON containment. */
	readonly method?: 'btree' | 'gin';
	readonly on: readonly (Column<unknown> | OrderType | Expr<unknown>)[];
	readonly unique?: boolean;
	/** A partial index covers only rows where this holds. */
	readonly where?: Expr<boolean>;
}

/** A foreign key from columns of this table to columns of another. */
export interface ForeignKeyType {
	readonly columns: readonly Column<unknown>[];
	readonly references: Table<Columns>;
	readonly to: readonly Column<unknown>[];
	readonly onDelete?: 'cascade' | 'restrict' | 'set null';
}

/** Table-level constraints and indexes. */
export interface Constraints {
	readonly primaryKey?: readonly Column<unknown>[];
	readonly unique?: readonly (readonly Column<unknown>[])[];
	readonly checks?: readonly Expr<boolean>[];
	readonly foreignKeys?: readonly ForeignKeyType[];
	readonly indexes?: readonly IndexType[];
}

/** A table: its name, columns and constraints. */
export interface Table<C extends Columns> {
	readonly schema: string;
	readonly name: string;
	readonly columns: C;
	/** Column expressions, qualified by the table. */
	readonly c: Refs<C>;
	readonly constraints: Constraints;
	/** The same table under an alias, for a second reference in one statement. */
	as(alias: string): Aliased<C>;
}

/** A table referenced under an alias. */
export interface Aliased<C extends Columns> {
	readonly table: Table<C>;
	readonly alias: string;
	readonly c: Refs<C>;
}

function refs<C extends Columns>(owner: readonly string[], columns: C): Refs<C> {
	return Object.freeze(
		Object.fromEntries(Object.entries(columns).map(([name, def]) => [name, new Column(owner, name, def.type)])),
	) as Refs<C>;
}

/** A schema: a namespace for tables. */
export interface SchemaType {
	readonly name: string;
	/** Define a table in this schema. */
	table<const C extends Columns>(name: string, columns: C, constraints?: (c: Refs<C>) => Constraints): Table<C>;
}

/** Start a schema definition. The name is checked as an identifier. */
export function schema(name: string): SchemaType {
	identifier(name);
	return Object.freeze({
		name,
		table<const C extends Columns>(table: string, columns: C, constraints?: (c: Refs<C>) => Constraints): Table<C> {
			qualified(name, table);
			for (const key of Object.keys(columns)) identifier(key);
			const c = refs([name, table], columns);
			const defined: Table<C> = Object.freeze({
				schema: name,
				name: table,
				columns,
				c,
				constraints: Object.freeze(constraints?.(c) ?? {}),
				as: (alias: string) => Object.freeze({ table: defined, alias, c: refs([alias], columns) }),
			});
			return defined;
		},
	});
}

/** The row an insert proposed, inside `onConflict({ action: 'update' })`: `excluded(notes).c.title`. */
export function excluded<C extends Columns>(table: Table<C>): { readonly c: Refs<C> } {
	return record(table, 'excluded');
}

/**
 * A row of a table under a fixed name that PostgreSQL provides: `excluded` in an upsert, or `new` and `old` in a
 * trigger. Its columns are typed like the table's.
 */
export function record<C extends Columns>(
	table: Table<C>,
	name: 'excluded' | 'new' | 'old',
): { readonly c: Refs<C> } {
	return Object.freeze({ c: refs([name], table.columns) });
}

/** The default of a column as an expression, if it has one. */
export function fallback<T>(definition: ColumnDef<T>): Expr<T> | undefined {
	return definition.fallback === undefined ? undefined : lift(definition.fallback, definition.type);
}
