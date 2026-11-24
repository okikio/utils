/**
 * Complete statements: `select`, `insert`, `update` and `delete`.
 *
 * Each builder is immutable: a method returns a new builder. A statement knows the type of every column it returns,
 * so running it gives typed rows. A statement is not an expression; embed a `select` with `exists`, `scalar` or `in`.
 *
 * @module
 */
import { and, type AnyExpr, Column, Expr, type Input, lift, type OrderType, type Subquery } from './expr.ts';
import {
	alias,
	compile,
	type CompiledType,
	type Fragment,
	group,
	identifier,
	join,
	keyword,
	param,
	qualified,
} from './fragment.ts';
import type { Aliased, ColumnDef, Columns, Table } from './table.ts';
import type { SqlType } from './type.ts';

const brand: unique symbol = Symbol('okikio.sql.statement');

/** Result columns: name to expression. */
export type Shape = Readonly<Record<string, AnyExpr>>;

/** The row a shape returns. */
export type RowOfShape<S extends Shape> = { [K in keyof S]: S[K] extends Expr<infer T> ? T : never };

/** A complete statement that returns rows of type `Row` (an empty object when it returns none). */
export interface Statement<Row> {
	readonly [brand]: true;
	/** The SQL sent to the database. Selected values are converted to their portable form. */
	readonly query: Fragment;
	/** The value type of each returned column, which decodes it. */
	readonly shape: { readonly [K in keyof Row]: SqlType<Row[K]> };
}

/** Whether a value is a statement. */
export function isStatement(value: unknown): value is Statement<unknown> {
	return typeof value === 'object' && value !== null && brand in value;
}

/** Compile a statement for any client. */
export function toQuery(statement: Statement<unknown>): CompiledType {
	return compile(statement.query);
}

/** The value type of each column of a shape. */
function typesOf<Row>(shape: Shape): { readonly [K in keyof Row]: SqlType<Row[K]> } {
	return Object.freeze(Object.fromEntries(Object.entries(shape).map(([key, expr]) => [key, expr.type]))) as never;
}

/** The select list, with each value converted for reading, or raw for a subquery. */
function list(shape: Shape, read: boolean): Fragment {
	const items = Object.entries(shape).map(([key, expr]) =>
		join([read ? expr.type.read(expr.fragment) : expr.operand, keyword(' as '), alias(key)])
	);
	return items.length ? join(items, ', ') : keyword('1 as "_"');
}

/** A table or aliased table in FROM. */
type Source = Table<Columns> | Aliased<Columns>;

function source(from: Source): Fragment {
	return 'alias' in from
		? join([qualified(from.table.schema, from.table.name), keyword(' as '), identifier(from.alias)])
		: qualified(from.schema, from.name);
}

/** Row locks a select can take. */
export interface LockType {
	/** `for update` locks rows to change them; `for share` only keeps them from changing. */
	readonly mode?: 'update' | 'share' | 'no key update' | 'key share';
	/** Skip rows another transaction holds, as a work queue does. */
	readonly skipLocked?: boolean;
	/** Fail at once instead of waiting for a lock. */
	readonly noWait?: boolean;
}

interface SelectState {
	readonly shape: Shape;
	readonly from?: Source;
	readonly joins: readonly Fragment[];
	readonly where: readonly Expr<boolean>[];
	readonly groupBy: readonly AnyExpr[];
	readonly orderBy: readonly OrderType[];
	readonly limit?: Expr<number>;
	readonly offset?: Expr<number>;
	readonly lock?: LockType;
}

/** A `select` statement being built. */
export class Select<S extends Shape> implements Statement<RowOfShape<S>>, Subquery<RowOfShape<S>> {
	declare readonly [brand]: true;
	readonly #state: SelectState;
	constructor(state: SelectState) {
		this.#state = state;
		Object.defineProperty(this, brand, { value: true });
	}
	/** Read from a table. */
	from(table: Source): Select<S> {
		return new Select({ ...this.#state, from: table });
	}
	/** Inner join another table on a condition. */
	join(table: Source, on: Expr<boolean>): Select<S> {
		return new Select({
			...this.#state,
			joins: [...this.#state.joins, join([keyword(' join '), source(table), keyword(' on '), on.fragment])],
		});
	}
	/** Left join another table on a condition; its columns may be NULL in the result. */
	leftJoin(table: Source, on: Expr<boolean>): Select<S> {
		return new Select({
			...this.#state,
			joins: [...this.#state.joins, join([keyword(' left join '), source(table), keyword(' on '), on.fragment])],
		});
	}
	/** Keep rows where every given condition holds. Repeated calls add conditions. */
	where(...conditions: readonly Expr<boolean>[]): Select<S> {
		return new Select({ ...this.#state, where: [...this.#state.where, ...conditions] });
	}
	/** Group rows for aggregates. */
	groupBy(...items: readonly AnyExpr[]): Select<S> {
		return new Select({ ...this.#state, groupBy: [...this.#state.groupBy, ...items] });
	}
	/** Order rows. Pass `column.desc()` for descending order; a plain expression orders ascending. */
	orderBy(...items: readonly (OrderType | AnyExpr)[]): Select<S> {
		const orders = items.map((item) => item instanceof Expr ? item.asc() : item);
		return new Select({ ...this.#state, orderBy: [...this.#state.orderBy, ...orders] });
	}
	/** Return at most this many rows. */
	limit(count: Input<number>): Select<S> {
		return new Select({ ...this.#state, limit: lift(count, countType) });
	}
	/** Skip this many rows first. */
	offset(count: Input<number>): Select<S> {
		return new Select({ ...this.#state, offset: lift(count, countType) });
	}
	/** Lock the selected rows until the transaction ends. */
	for(lock: LockType = {}): Select<S> {
		return new Select({ ...this.#state, lock });
	}
	/** The SQL with raw values, for embedding as a subquery. */
	get fragment(): Fragment {
		return this.#render(false);
	}
	/** The SQL sent when this select runs on its own, with values converted for reading. */
	get query(): Fragment {
		return this.#render(true);
	}
	/** The value type of each selected column. */
	get shape(): { readonly [K in keyof RowOfShape<S>]: SqlType<RowOfShape<S>[K]> } {
		return typesOf<RowOfShape<S>>(this.#state.shape);
	}

	#render(read: boolean): Fragment {
		const state = this.#state;
		const parts: Fragment[] = [keyword('select '), list(state.shape, read)];
		if (state.from) parts.push(keyword(' from '), source(state.from), ...state.joins);
		if (state.where.length) parts.push(keyword(' where '), and(...state.where).fragment);
		if (state.groupBy.length) parts.push(keyword(' group by '), join(state.groupBy.map((item) => item.operand), ', '));
		if (state.orderBy.length) parts.push(keyword(' order by '), join(state.orderBy.map((item) => item.fragment), ', '));
		if (state.limit) parts.push(keyword(' limit '), state.limit.operand);
		if (state.offset) parts.push(keyword(' offset '), state.offset.operand);
		if (state.lock) {
			parts.push(keyword(` for ${state.lock.mode ?? 'update'}`));
			if (state.lock.skipLocked) parts.push(keyword(' skip locked'));
			if (state.lock.noWait) parts.push(keyword(' nowait'));
		}
		return join(parts);
	}
}

/** Counts for limit and offset; a `bigint` parameter accepts any safe integer. */
const countType: SqlType<number> = Object.freeze({
	name: 'bigint',
	send: (value: number) => {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new RangeError('A limit or offset must be a non-negative safe integer.');
		}
		return param(value, 'bigint');
	},
	read: (expression: Fragment) => join([group(expression), keyword('::text')]),
	decode: (raw: unknown) => Number(raw),
});

/** Start a `select` of named values. A select without `from` evaluates its values once. */
export function select<const S extends Shape>(shape: S): Select<S> {
	return new Select({ shape, joins: [], where: [], groupBy: [], orderBy: [] });
}

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

/** What an insert does when a row with the same key exists. */
export type ConflictType<C extends Columns> =
	| { readonly target?: readonly Column<unknown>[]; readonly action: 'nothing' }
	| {
		readonly target: readonly Column<unknown>[];
		readonly action: 'update';
		readonly set: UpdateRow<C>;
		readonly where?: Expr<boolean>;
	};

/** The value of each listed column, sent with the column's type. */
function assignments<C extends Columns>(table: Table<C>, values: UpdateRow<C>): [Fragment, Fragment][] {
	return Object.entries(values).filter(([, value]) => value !== undefined).map(([key, value]) => {
		const def = table.columns[key];
		if (!def) throw new TypeError(`Unknown column ${key} of ${table.schema}.${table.name}.`);
		if (def.generated) throw new TypeError(`Column ${key} is generated and cannot be written.`);
		return [identifier(key), lift(value as Input<unknown>, def.type).fragment];
	});
}

function returning(shape: Shape | undefined): Fragment {
	return shape && Object.keys(shape).length ? join([keyword(' returning '), list(shape, true)]) : [];
}

/** An `insert` being built. */
export class Insert<C extends Columns, S extends Shape = Record<never, never>> implements Statement<RowOfShape<S>> {
	declare readonly [brand]: true;
	readonly #table: Table<C>;
	readonly #rows: readonly InsertRow<C>[];
	readonly #conflict?: ConflictType<C>;
	readonly #returning?: S;
	constructor(table: Table<C>, rows: readonly InsertRow<C>[], conflict?: ConflictType<C>, shape?: S) {
		this.#table = table;
		this.#rows = rows;
		this.#conflict = conflict;
		this.#returning = shape;
		Object.defineProperty(this, brand, { value: true });
	}
	/** What to do when a row with the same key exists. */
	onConflict(conflict: ConflictType<C>): Insert<C, S> {
		return new Insert(this.#table, this.#rows, conflict, this.#returning);
	}
	/** Return values from the inserted rows. */
	returning<const R extends Shape>(shape: R): Insert<C, R> {
		return new Insert(this.#table, this.#rows, this.#conflict, shape);
	}
	get shape(): { readonly [K in keyof RowOfShape<S>]: SqlType<RowOfShape<S>[K]> } {
		return typesOf<RowOfShape<S>>(this.#returning ?? {});
	}
	get query(): Fragment {
		const table = this.#table;
		if (this.#rows.length === 0) throw new TypeError('An insert needs at least one row.');
		const names = [
			...new Set(
				this.#rows.flatMap((row) =>
					Object.keys(row).filter((key) => (row as Record<string, unknown>)[key] !== undefined)
				),
			),
		];
		const rows = this.#rows.map((row) => {
			const values = names.map((name) => {
				const value = (row as Record<string, unknown>)[name];
				const def = table.columns[name];
				if (!def) throw new TypeError(`Unknown column ${name} of ${table.schema}.${table.name}.`);
				if (def.generated) throw new TypeError(`Column ${name} is generated and cannot be written.`);
				return value === undefined ? keyword('default') : lift(value as Input<unknown>, def.type).fragment;
			});
			return group(join(values, ', '));
		});
		const parts: Fragment[] = [
			keyword('insert into '),
			qualified(table.schema, table.name),
			keyword(' '),
			group(join(names.map(identifier), ', ')),
			keyword(' values '),
			join(rows, ', '),
		];
		const conflict = this.#conflict;
		if (conflict) {
			parts.push(keyword(' on conflict'));
			if (conflict.target?.length) {
				parts.push(
					keyword(' '),
					group(join(conflict.target.map((item) => identifier(item.name)), ', ')),
				);
			}
			if (conflict.action === 'nothing') parts.push(keyword(' do nothing'));
			else {
				const set = assignments(table, conflict.set).map(([name, value]) => join([name, keyword(' = '), value]));
				parts.push(keyword(' do update set '), join(set, ', '));
				if (conflict.where) parts.push(keyword(' where '), conflict.where.fragment);
			}
		}
		parts.push(returning(this.#returning));
		return join(parts);
	}
}

/** Start an insert of one or more rows. */
export function insert<C extends Columns>(table: Table<C>, rows: InsertRow<C> | readonly InsertRow<C>[]): Insert<C> {
	return new Insert(table, Array.isArray(rows) ? rows : [rows as InsertRow<C>]);
}

/** An `update` being built. */
export class Update<C extends Columns, S extends Shape = Record<never, never>> implements Statement<RowOfShape<S>> {
	declare readonly [brand]: true;
	readonly #table: Table<C>;
	readonly #values: UpdateRow<C>;
	readonly #conditions: readonly Expr<boolean>[];
	readonly #returning?: S;
	constructor(table: Table<C>, values: UpdateRow<C>, conditions: readonly Expr<boolean>[] = [], shape?: S) {
		this.#table = table;
		this.#values = values;
		this.#conditions = conditions;
		this.#returning = shape;
		Object.defineProperty(this, brand, { value: true });
	}
	/** Change only rows where every given condition holds. Repeated calls add conditions. */
	where(...conditions: readonly Expr<boolean>[]): Update<C, S> {
		return new Update(this.#table, this.#values, [...this.#conditions, ...conditions], this.#returning);
	}
	/** Return values from the changed rows. */
	returning<const R extends Shape>(shape: R): Update<C, R> {
		return new Update(this.#table, this.#values, this.#conditions, shape);
	}
	get shape(): { readonly [K in keyof RowOfShape<S>]: SqlType<RowOfShape<S>[K]> } {
		return typesOf<RowOfShape<S>>(this.#returning ?? {});
	}
	get query(): Fragment {
		const set = assignments(this.#table, this.#values);
		if (set.length === 0) throw new TypeError('An update needs at least one column.');
		const parts: Fragment[] = [
			keyword('update '),
			qualified(this.#table.schema, this.#table.name),
			keyword(' set '),
			join(set.map(([name, value]) => join([name, keyword(' = '), value])), ', '),
		];
		if (this.#conditions.length) parts.push(keyword(' where '), and(...this.#conditions).fragment);
		parts.push(returning(this.#returning));
		return join(parts);
	}
}

/** Start an update that sets columns. Add `where` to limit the rows. */
export function update<C extends Columns>(table: Table<C>, values: UpdateRow<C>): Update<C> {
	return new Update(table, values);
}

/** A `delete` being built. */
export class Delete<C extends Columns, S extends Shape = Record<never, never>> implements Statement<RowOfShape<S>> {
	declare readonly [brand]: true;
	readonly #table: Table<C>;
	readonly #conditions: readonly Expr<boolean>[];
	readonly #returning?: S;
	constructor(table: Table<C>, conditions: readonly Expr<boolean>[] = [], shape?: S) {
		this.#table = table;
		this.#conditions = conditions;
		this.#returning = shape;
		Object.defineProperty(this, brand, { value: true });
	}
	/** Delete only rows where every given condition holds. */
	where(...conditions: readonly Expr<boolean>[]): Delete<C, S> {
		return new Delete(this.#table, [...this.#conditions, ...conditions], this.#returning);
	}
	/** Return values from the deleted rows. */
	returning<const R extends Shape>(shape: R): Delete<C, R> {
		return new Delete(this.#table, this.#conditions, shape);
	}
	get shape(): { readonly [K in keyof RowOfShape<S>]: SqlType<RowOfShape<S>[K]> } {
		return typesOf<RowOfShape<S>>(this.#returning ?? {});
	}
	get query(): Fragment {
		const parts: Fragment[] = [keyword('delete from '), qualified(this.#table.schema, this.#table.name)];
		if (this.#conditions.length) parts.push(keyword(' where '), and(...this.#conditions).fragment);
		parts.push(returning(this.#returning));
		return join(parts);
	}
}

/** Start a delete. Add `where` to limit the rows; a delete without `where` removes every row. */
export function remove<C extends Columns>(table: Table<C>): Delete<C> {
	return new Delete(table);
}
