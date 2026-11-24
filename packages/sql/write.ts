/**
 * The builders that change rows: `insert`, `update` and `remove` (`delete`).
 *
 * Every value is sent with its column's type, so a wrong value fails to type-check instead of failing in the database.
 * Each builder can define named subqueries with `with`, and `update` and `remove` can read other sources through
 * `from` and `using`, as PostgreSQL's `update … from` and `delete … using` do.
 *
 * @module
 */
import { and, type Column, type Expr, type Input, lift } from './expr.ts';
import { type Fragment, group, identifier, join, keyword, qualified } from './fragment.ts';
import {
	brand,
	type CteType,
	isStatement,
	prefix,
	returning,
	type RowOfShape,
	type Shape,
	type Source,
	source,
	type Statement,
	type TypesOf,
	typesOf,
} from './statement.ts';
import type { ColumnDef, Columns, Table } from './table.ts';
import type { SqlType } from './type.ts';

/** Values an insert takes: required columns must be present, optional ones may be omitted. */
export type InsertRow<C extends Columns> =
	& {
		[K in keyof C as C[K] extends ColumnDef<unknown, true> ? never : K]: C[K] extends ColumnDef<infer T> ? Input<T>
			: never;
	}
	& {
		[K in keyof C as C[K] extends ColumnDef<unknown, true> ? K : never]?: C[K] extends ColumnDef<infer T> ? Input<T>
			: never;
	};

/** Values an update may set. */
export type UpdateRow<C extends Columns> = { [K in keyof C]?: C[K] extends ColumnDef<infer T> ? Input<T> : never };

/** A select whose columns are named after the table's columns and have the same types, for `insert … select`. */
export interface InsertSelect<C extends Columns> {
	readonly [brand]: true;
	/** The select's SQL, with raw values. */
	readonly fragment: Fragment;
	readonly shape: { readonly [K in keyof C]?: C[K] extends ColumnDef<infer T> ? SqlType<T> : never };
}

/** What an insert does when a row with the same key exists. */
export type ConflictType<C extends Columns> =
	| { readonly target?: readonly Column<unknown>[]; readonly action: 'nothing' }
	| {
		readonly target: readonly Column<unknown>[];
		readonly action: 'update';
		readonly set: UpdateRow<C>;
		readonly where?: Expr<boolean>;
	};

/** The definition of a writable column, or an error naming the problem. */
function writable(table: Table<Columns>, name: string): ColumnDef<unknown> {
	const def = table.columns[name];
	if (!def) throw new TypeError(`Unknown column ${name} of ${table.schema}.${table.name}.`);
	if (def.generated) throw new TypeError(`Column ${name} is generated and cannot be written.`);
	return def;
}

/** `name = value` for each listed column, with the value sent as the column's type. */
function assignments<C extends Columns>(table: Table<C>, values: UpdateRow<C>): Fragment {
	const set = Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) =>
		join([identifier(key), keyword(' = '), lift(value as Input<unknown>, writable(table, key).type).fragment])
	);
	if (set.length === 0) throw new TypeError(`An update of ${table.schema}.${table.name} needs at least one column.`);
	return join(set, ', ');
}

/** A where clause, or nothing. */
function where(conditions: readonly Expr<boolean>[]): Fragment {
	return conditions.length ? join([keyword(' where '), and(...conditions).fragment]) : [];
}

/** A `from` or `using` list, or nothing. */
function sources(word: string, items: readonly Source[]): Fragment {
	return items.length ? join([keyword(` ${word} `), join(items.map(source), ', ')]) : [];
}

interface WriteState<C extends Columns, S extends Shape | undefined> {
	readonly table: Table<C>;
	readonly with: readonly CteType<unknown>[];
	readonly where: readonly Expr<boolean>[];
	readonly returning?: S;
}

interface InsertState<C extends Columns, S extends Shape | undefined> extends WriteState<C, S> {
	readonly rows: readonly InsertRow<C>[] | InsertSelect<C>;
	readonly conflict?: ConflictType<C>;
}

/** An `insert` being built. */
export class Insert<C extends Columns, S extends Shape = Record<never, never>> implements Statement<RowOfShape<S>> {
	declare readonly [brand]: true;
	readonly #state: InsertState<C, S>;
	constructor(state: InsertState<C, S>) {
		this.#state = state;
		Object.defineProperty(this, brand, { value: true });
	}
	/** Define named subqueries first, to read them in an `insert … select`. */
	with(...ctes: readonly CteType<unknown>[]): Insert<C, S> {
		return new Insert({ ...this.#state, with: [...this.#state.with, ...ctes] });
	}
	/** What to do when a row with the same key exists. */
	onConflict(conflict: ConflictType<C>): Insert<C, S> {
		return new Insert({ ...this.#state, conflict });
	}
	/** Return values from the inserted rows. */
	returning<const R extends Shape>(shape: R): Insert<C, R> {
		return new Insert<C, R>({ ...this.#state, returning: shape });
	}
	get shape(): TypesOf<RowOfShape<S>> {
		return typesOf<RowOfShape<S>>(this.#state.returning ?? {});
	}
	get query(): Fragment {
		const { table, rows } = this.#state;
		return join([
			prefix(this.#state.with),
			keyword('insert into '),
			qualified(table.schema, table.name),
			keyword(' '),
			Array.isArray(rows) ? this.#values(rows) : this.#select(rows as InsertSelect<C>),
			this.#conflict(),
			returning(this.#state.returning),
		]);
	}

	#select(rows: InsertSelect<C>): Fragment {
		const names = Object.keys(rows.shape);
		for (const name of names) writable(this.#state.table, name);
		return join([group(join(names.map(identifier), ', ')), keyword(' '), rows.fragment]);
	}

	#values(rows: readonly InsertRow<C>[]): Fragment {
		const table = this.#state.table;
		if (rows.length === 0) throw new TypeError(`An insert into ${table.schema}.${table.name} needs at least one row.`);
		const records = rows as readonly Record<string, unknown>[];
		const names = [...new Set(records.flatMap((row) => Object.keys(row).filter((key) => row[key] !== undefined)))];
		const defs = names.map((name) => writable(table, name));
		const values = records.map((row) =>
			group(join(
				names.map((name, index) =>
					row[name] === undefined ? keyword('default') : lift(row[name] as Input<unknown>, defs[index]!.type).fragment
				),
				', ',
			))
		);
		return join([group(join(names.map(identifier), ', ')), keyword(' values '), join(values, ', ')]);
	}

	#conflict(): Fragment {
		const conflict = this.#state.conflict;
		if (!conflict) return [];
		const target = conflict.target?.length
			? join([keyword(' '), group(join(conflict.target.map((item) => identifier(item.name)), ', '))])
			: [];
		if (conflict.action === 'nothing') return join([keyword(' on conflict'), target, keyword(' do nothing')]);
		return join([
			keyword(' on conflict'),
			target,
			keyword(' do update set '),
			assignments(this.#state.table, conflict.set),
			where(conflict.where ? [conflict.where] : []),
		]);
	}
}

/**
 * Start an insert of one or more rows, or of the rows a select returns.
 *
 * For `insert … select`, name each selected value after the column it fills.
 */
export function insert<C extends Columns>(
	table: Table<C>,
	rows: InsertRow<C> | readonly InsertRow<C>[] | InsertSelect<C>,
): Insert<C> {
	const list = isStatement(rows) ? rows as InsertSelect<C> : Array.isArray(rows) ? rows : [rows as InsertRow<C>];
	return new Insert({ table, rows: list, with: [], where: [] });
}

interface UpdateState<C extends Columns, S extends Shape | undefined> extends WriteState<C, S> {
	readonly values: UpdateRow<C>;
	readonly from: readonly Source[];
}

/** An `update` being built. */
export class Update<C extends Columns, S extends Shape = Record<never, never>> implements Statement<RowOfShape<S>> {
	declare readonly [brand]: true;
	readonly #state: UpdateState<C, S>;
	constructor(state: UpdateState<C, S>) {
		this.#state = state;
		Object.defineProperty(this, brand, { value: true });
	}
	/** Define named subqueries first, to read them in `from` or `where`. */
	with(...ctes: readonly CteType<unknown>[]): Update<C, S> {
		return new Update({ ...this.#state, with: [...this.#state.with, ...ctes] });
	}
	/** Read other sources too; join them to the table in `where`. */
	from(...items: readonly Source[]): Update<C, S> {
		return new Update({ ...this.#state, from: [...this.#state.from, ...items] });
	}
	/** Change only rows where every given condition holds. Repeated calls add conditions. */
	where(...conditions: readonly Expr<boolean>[]): Update<C, S> {
		return new Update({ ...this.#state, where: [...this.#state.where, ...conditions] });
	}
	/** Return values from the changed rows. */
	returning<const R extends Shape>(shape: R): Update<C, R> {
		return new Update<C, R>({ ...this.#state, returning: shape });
	}
	get shape(): TypesOf<RowOfShape<S>> {
		return typesOf<RowOfShape<S>>(this.#state.returning ?? {});
	}
	get query(): Fragment {
		const state = this.#state;
		return join([
			prefix(state.with),
			keyword('update '),
			qualified(state.table.schema, state.table.name),
			keyword(' set '),
			assignments(state.table, state.values),
			sources('from', state.from),
			where(state.where),
			returning(state.returning),
		]);
	}
}

/** Start an update that sets columns. Add `where` to limit the rows. */
export function update<C extends Columns>(table: Table<C>, values: UpdateRow<C>): Update<C> {
	return new Update({ table, values, from: [], with: [], where: [] });
}

interface DeleteState<C extends Columns, S extends Shape | undefined> extends WriteState<C, S> {
	readonly using: readonly Source[];
}

/** A `delete` being built. */
export class Delete<C extends Columns, S extends Shape = Record<never, never>> implements Statement<RowOfShape<S>> {
	declare readonly [brand]: true;
	readonly #state: DeleteState<C, S>;
	constructor(state: DeleteState<C, S>) {
		this.#state = state;
		Object.defineProperty(this, brand, { value: true });
	}
	/** Define named subqueries first, to read them in `using` or `where`. */
	with(...ctes: readonly CteType<unknown>[]): Delete<C, S> {
		return new Delete({ ...this.#state, with: [...this.#state.with, ...ctes] });
	}
	/** Read other sources too; join them to the table in `where`. */
	using(...items: readonly Source[]): Delete<C, S> {
		return new Delete({ ...this.#state, using: [...this.#state.using, ...items] });
	}
	/** Delete only rows where every given condition holds. Repeated calls add conditions. */
	where(...conditions: readonly Expr<boolean>[]): Delete<C, S> {
		return new Delete({ ...this.#state, where: [...this.#state.where, ...conditions] });
	}
	/** Return values from the deleted rows. */
	returning<const R extends Shape>(shape: R): Delete<C, R> {
		return new Delete<C, R>({ ...this.#state, returning: shape });
	}
	get shape(): TypesOf<RowOfShape<S>> {
		return typesOf<RowOfShape<S>>(this.#state.returning ?? {});
	}
	get query(): Fragment {
		const state = this.#state;
		return join([
			prefix(state.with),
			keyword('delete from '),
			qualified(state.table.schema, state.table.name),
			sources('using', state.using),
			where(state.where),
			returning(state.returning),
		]);
	}
}

/** Start a delete. Add `where` to limit the rows; a delete without `where` removes every row. */
export function remove<C extends Columns>(table: Table<C>): Delete<C> {
	return new Delete({ table, using: [], with: [], where: [] });
}
