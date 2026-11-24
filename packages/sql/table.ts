/**
 * Tables, columns and constraints, defined once in TypeScript.
 *
 * A tabular database has a fixed structure: a table has named, typed columns, and a statement can read only the
 * columns of the tables it names. A table definition holds that structure and is the single source for three things:
 * the typed column expressions that queries use, the `create table` statement that migrations run, and the shape that
 * a schema check compares with the live database.
 *
 * Each column expression carries its table as its owner, `schema.table` or an alias. Constraints may read only their
 * own table's columns, and statements check their own scope the same way.
 *
 * @example
 * ```ts ignore
 * const outbox = sql.schema('utils_outbox');
 * const messages = outbox.table('messages', {
 * 	namespace: sql.column(types.text()),
 * 	id: sql.column(types.text()),
 * 	attempt: sql.column(types.integer).default(0),
 * 	token: sql.column(types.text()).nullable(),
 * }, (c) => ({ primaryKey: [c.namespace, c.id] }));
 *
 * messages.c.attempt.gt(3); // Expr<boolean, 'utils_outbox.messages'>
 * ```
 *
 * @module
 */
import { type Dialect, same } from './dialect.ts';
import { Column, type Expr, type Input, key, lift, type OrderType } from './expr.ts';
import { identifier, qualified } from './fragment.ts';
import { nullable, type SqlType } from './type.ts';

const brand: unique symbol = Symbol('okikio.sql.column');

/** A column definition: its type, whether it may be NULL, and how it gets a value when an insert omits it. */
export interface ColumnDef<T, Optional extends boolean = boolean> {
	readonly [brand]: true;
	readonly type: SqlType<T>;
	/** Whether the column may hold SQL NULL. */
	readonly allowsNull: boolean;
	/** A default value or expression; inserts may omit the column. */
	readonly fallback?: Input<T>;
	/** The database writes the column, as an identity or a generated column; inserts and updates must omit it. */
	readonly generated: boolean;
	/** `generated always as identity`. */
	readonly isIdentity?: boolean;
	/** The column's name in the database, when it differs from its key in the definition. */
	readonly column?: string;
	/** The value the application writes when an insert omits the column. */
	readonly insertValue?: () => Input<T>;
	/** The value the application writes on every update that does not set the column. */
	readonly updateValue?: () => Input<T>;
	/** The database fills the column when an insert omits it; see `ColumnBuilder.filled`. */
	readonly databaseFills?: boolean;
	/** `bigserial`: a sequence fills the column when an insert omits it. */
	readonly sequenced?: boolean;
	/** Phantom flag: an insert may omit this column. */
	readonly optional?: Optional;
}

/** A column definition being built. */
export interface ColumnBuilder<T, Optional extends boolean> extends ColumnDef<T, Optional> {
	/** Allow SQL NULL; an insert may then omit the column. */
	nullable(): ColumnBuilder<T | null, true>;
	/** Give the column a default; an insert may then omit it. A default may read no table. */
	default(value: T | Expr<T, never>): ColumnBuilder<T, true>;
	/** Make a 64-bit integer column `generated always as identity`. */
	identity(): ColumnBuilder<T, true>;
	/**
	 * The database computes this column, such as a `generated always as (…) stored` column of a schema made elsewhere.
	 * Inserts and updates refuse it, and `createTable` cannot create it.
	 */
	computed(): ColumnBuilder<T, true>;
	/**
	 * The column's name in the database, when the key in the definition differs, such as `seenAt` for `"seen_at"`.
	 * Statements use the key for values and results and the name in SQL.
	 */
	named(column: string): ColumnBuilder<T, Optional>;
	/**
	 * Let inserts omit the column because the application writes `value()` then, as Sequelize's `createdAt` or Prisma's
	 * `@default(now())` do outside the database. `value` may return an expression that reads no table, such as
	 * `sql.fn.now()`; it runs once for each statement built.
	 */
	onInsert(value: () => T | Expr<T, never>): ColumnBuilder<T, true>;
	/**
	 * Write `value()` on every update that does not set the column itself, as Prisma's `@updatedAt` does. Upserts
	 * count as updates.
	 */
	onUpdate(value: () => T | Expr<T, never>): ColumnBuilder<T, Optional>;
	/**
	 * Make a 64-bit integer column fill from a sequence when an insert omits it. Prefer
	 * {@link ColumnBuilder.identity} for a new table; this keeps an existing sequence column as it is.
	 */
	serial(): ColumnBuilder<T, true>;
	/**
	 * Let inserts omit the column because the database fills it: a `before insert` trigger, or a default or sequence of
	 * a schema made elsewhere. The column keeps `not null`, which the database checks after filling it.
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
		nullable: () => build<T | null, true>({ ...definition, type: nullable(definition.type), allowsNull: true }),
		default: (value: Input<T>) => {
			if (typeof value === 'object' && value !== null && 'owners' in value && (value as Expr<T>).owners.size) {
				throw new TypeError('A column default may not read a table.');
			}
			return build<T, true>({ ...definition, fallback: value });
		},
		identity: () => build<T, true>({ ...definition, generated: true, isIdentity: true }),
		computed: () => build<T, true>({ ...definition, generated: true }),
		named: (column: string) => {
			identifier(column);
			return build<T, Optional>({ ...definition, column });
		},
		onInsert: (value: () => Input<T>) => build<T, true>({ ...definition, insertValue: value }),
		onUpdate: (value: () => Input<T>) => build<T, Optional>({ ...definition, updateValue: value }),
		filled: () => build<T, true>({ ...definition, databaseFills: true }),
		serial: () => build<T, true>({ ...definition, sequenced: true }),
	}) as unknown as ColumnBuilder<T, Optional>;
}

/** Column definitions of a table, by name. */
export type Columns = Readonly<Record<string, ColumnDef<unknown>>>;

/** The column expressions of a table or alias, each owned by `K`. */
export type Refs<C extends Columns, K extends string = string> = {
	readonly [N in keyof C]: C[N] extends ColumnDef<infer T> ? Column<T, K> : never;
};

/** The value type of each column. */
export type RowOf<C extends Columns> = { [K in keyof C]: C[K] extends ColumnDef<infer T> ? T : never };

/** An index. Plain columns are written by name; other entries are expressions of the same table. */
export interface IndexType<K extends string = string> {
	readonly name: string;
	/** The dialect's index method, such as PostgreSQL's `gin` for JSON containment. Omitted means the default. */
	readonly method?: 'btree' | 'gin';
	readonly on: readonly (Column<unknown, K> | OrderType<K> | Expr<unknown, K>)[];
	readonly unique?: boolean;
	/** A partial index covers only rows where this holds. */
	readonly where?: Expr<boolean, K>;
}

/** A foreign key from columns of this table to columns of another. */
export interface ForeignKeyType<K extends string = string> {
	readonly columns: readonly Column<unknown, K>[];
	readonly references: Table<Columns>;
	readonly to: readonly Column<unknown>[];
	readonly onDelete?: 'cascade' | 'restrict' | 'set null';
}

/** Table-level constraints and indexes. Each may read only its own table's columns. */
export interface Constraints<K extends string = string> {
	readonly primaryKey?: readonly Column<unknown, K>[];
	readonly unique?: readonly (readonly Column<unknown, K>[])[];
	readonly checks?: readonly Expr<boolean, K>[];
	readonly foreignKeys?: readonly ForeignKeyType<K>[];
	readonly indexes?: readonly IndexType<K>[];
}

/** A table: its dialect, name, columns and constraints. `K` is its owner key, `schema.table`. */
export interface Table<C extends Columns, K extends string = string> {
	readonly dialect: Dialect;
	readonly schema: string;
	readonly name: string;
	/** The owner key of its columns. */
	readonly key: K;
	readonly columns: C;
	/** Column expressions, qualified by the table. */
	readonly c: Refs<C, K>;
	readonly constraints: Constraints<K>;
	/**
	 * Whether this package creates and changes the table. A table of a schema made elsewhere, by an ORM, a migration
	 * tool or plain SQL, is not owned: queries work the same, and schema statements refuse to change it.
	 */
	readonly owned: boolean;
	/** The same table under an alias, for a second reference in one statement. */
	as<const A extends string>(alias: A): Aliased<C, A>;
}

/** A table referenced under an alias, whose columns are owned by the alias. */
export interface Aliased<C extends Columns, A extends string = string> {
	readonly table: Table<C>;
	readonly alias: A;
	readonly key: A;
	readonly c: Refs<C, A>;
}

function refs<C extends Columns, K extends string>(owner: readonly string[], columns: C): Refs<C, K> {
	return Object.freeze(
		Object.fromEntries(
			Object.entries(columns).map(([name, def]) => [name, new Column(owner, def.column ?? name, def.type)]),
		),
	) as Refs<C, K>;
}

/** The database name of a column, by its key in the definition. */
export function columnName(table: Table<Columns>, key: string): string {
	return table.columns[key]?.column ?? key;
}

/**
 * A value the application writes for a column: `insertValue` or `updateValue`. It may not read a table, because the
 * statement it lands in may not have that table in scope.
 */
export function applied<T>(make: () => Input<T>, name: string): Input<T> {
	const value = make();
	if (typeof value === 'object' && value !== null && 'owners' in value && (value as Expr<T>).owners.size) {
		throw new TypeError(`The value the application writes for ${name} may not read a table.`);
	}
	return value;
}

/** Fail when a constraint reads a column of another table. */
function owned(table: string, what: string, items: readonly { readonly owners: ReadonlySet<string> }[]): void {
	for (const item of items) {
		for (const owner of item.owners) {
			if (owner !== table) throw new TypeError(`A ${what} of ${table} reads ${owner}, which is another table.`);
		}
	}
}

/** A schema of one dialect: a namespace for tables. */
export interface SchemaType<S extends string = string> {
	readonly dialect: Dialect;
	readonly name: S;
	/** Whether this package creates and changes the schema's tables; see {@link Table.owned}. */
	readonly owned: boolean;
	/** Define a table in this schema. */
	table<const N extends string, const C extends Columns>(
		name: N,
		columns: C,
		constraints?: (c: Refs<C, `${S}.${N}`>) => Constraints<`${S}.${N}`>,
	): Table<C, `${S}.${N}`>;
}

/** Options for a schema. */
export interface SchemaOptions {
	/**
	 * `false` for a schema made elsewhere, such as by Prisma, Drizzle or plain SQL. Its tables can be queried, and
	 * schema statements refuse to change them. Defaults to `true`.
	 */
	readonly owned?: boolean;
}

/** Start a schema definition in a dialect. A dialect's entry point wraps this, such as `postgres.schema`. */
export function schema<const S extends string>(dialect: Dialect, name: S, options: SchemaOptions = {}): SchemaType<S> {
	identifier(name);
	const isOwned = options.owned ?? true;
	return Object.freeze({
		dialect,
		name,
		owned: isOwned,
		table<const N extends string, const C extends Columns>(
			table: N,
			columns: C,
			constraints?: (c: Refs<C, `${S}.${N}`>) => Constraints<`${S}.${N}`>,
		): Table<C, `${S}.${N}`> {
			qualified(name, table);
			for (const [column, def] of Object.entries(columns)) {
				identifier(column);
				same(dialect, def.type.dialect);
			}
			const tableKey = key([name, table]) as `${S}.${N}`;
			const c = refs<C, `${S}.${N}`>([name, table], columns);
			const defined = Object.freeze(constraints?.(c) ?? {});
			owned(tableKey, 'check', defined.checks ?? []);
			owned(tableKey, 'key', [...(defined.primaryKey ?? []), ...(defined.unique ?? []).flat()]);
			for (const index of defined.indexes ?? []) {
				owned(tableKey, 'index', [...index.on, ...(index.where ? [index.where] : [])]);
			}
			for (const foreign of defined.foreignKeys ?? []) {
				owned(tableKey, 'foreign key', foreign.columns);
				owned(foreign.references.key, 'foreign key target', foreign.to);
			}
			const result: Table<C, `${S}.${N}`> = Object.freeze({
				dialect,
				schema: name,
				name: table,
				key: tableKey,
				columns,
				c,
				constraints: defined,
				owned: isOwned,
				as: <const A extends string>(alias: A) => {
					identifier(alias);
					return Object.freeze({ table: result, alias, key: alias, c: refs<C, A>([alias], columns) });
				},
			});
			return result;
		},
	});
}

/** The row an insert proposed, inside `onConflict({ action: 'update' })`: `excluded(notes).c.title`. */
export function excluded<C extends Columns>(table: Table<C>): { readonly c: Refs<C, 'excluded'> } {
	return record(table, 'excluded');
}

/**
 * A row of a table under a fixed name that the database provides: `excluded` in an upsert, or `new` and `old` in a
 * trigger. Its columns are typed like the table's and owned by that name.
 */
export function record<C extends Columns, const N extends 'excluded' | 'new' | 'old'>(
	table: Table<C>,
	name: N,
): { readonly c: Refs<C, N> } {
	return Object.freeze({ c: refs<C, N>([name], table.columns) });
}

/** The default of a column as an expression, if it has one. */
export function fallback<T>(definition: ColumnDef<T>): Expr<T> | undefined {
	return definition.fallback === undefined
		? undefined
		: lift(definition.fallback as T | Expr<T, never>, definition.type);
}
