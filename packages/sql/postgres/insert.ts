/**
 * `insert`, with `on conflict` and `insert … select`. Its scope is its table and, inside an upsert, `excluded`.
 *
 * @module
 */
import { same } from '../dialect.ts';
import { type FreeOf, type Input, lift, reads } from '../expr.ts';
import { type Fragment, group, identifier, join, keyword, qualified } from '../fragment.ts';
import { brand, type CteType, free, type OwnersOfShape, prefix, type Shape } from '../statement.ts';
import type { Columns, Table } from '../table.ts';
import { dialect } from './dialect.ts';
import {
	assignments,
	type ConflictType,
	type InsertRow,
	type InsertSelect,
	type OwnersOfConflict,
	type OwnersOfRow,
	returning,
	type UpdateRow,
	values,
	where,
	writable,
	Write,
	type WriteState,
} from './write.ts';

interface InsertState<C extends Columns> extends WriteState<C> {
	readonly rows: readonly InsertRow<C>[] | InsertSelect<C>;
	readonly conflict?: ConflictType<C>;
}

/** An `insert` being built. `Used` is what its values read; its scope is its table and `excluded`. */
export class Insert<
	C extends Columns,
	K extends string = string,
	S extends Shape = Record<never, never>,
	Used extends string = never,
> extends Write<S> {
	declare readonly [reads]?: Exclude<Used, K | 'excluded'>;
	readonly #state: InsertState<C>;
	constructor(state: InsertState<C>) {
		super();
		this.#state = state;
	}
	/** Define named subqueries first, to read them in an `insert … select`. */
	with(...ctes: readonly CteType<unknown>[]): Insert<C, K, S, Used> {
		for (const item of ctes) same(dialect, item.dialect);
		return new Insert({ ...this.#state, with: [...this.#state.with, ...ctes] });
	}
	/** What to do when a row with the same key exists. */
	onConflict<const X extends ConflictType<C>>(conflict: X): Insert<C, K, S, Used | OwnersOfConflict<X>> {
		return new Insert({ ...this.#state, conflict });
	}
	/** Return values from the inserted rows. */
	returning<const R extends Shape>(shape: R): Insert<C, K, R, Used | OwnersOfShape<R>> {
		return new Insert<C, K, R, Used | OwnersOfShape<R>>({ ...this.#state, returning: shape });
	}
	protected returned(): Shape | undefined {
		return this.#state.returning;
	}
	get free(): ReadonlySet<string> {
		const { rows, table, conflict } = this.#state;
		const used: { readonly owners: ReadonlySet<string> }[] = [];
		if (Array.isArray(rows)) {
			for (const row of rows as readonly UpdateRow<C>[]) used.push(...values(table, row).map(([, value]) => value));
		} else used.push({ owners: (rows as InsertSelect<C>).free });
		if (conflict?.action === 'update') {
			used.push(...values(table, conflict.set).map(([, value]) => value), ...(conflict.where ? [conflict.where] : []));
		}
		used.push(...Object.values(this.#state.returning ?? {}));
		return free(used, [table.key, 'excluded']);
	}
	get fragment(): Fragment {
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
		same(dialect, rows.dialect);
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
		const lists = records.map((row) =>
			group(join(
				names.map((name, index) =>
					row[name] === undefined ? keyword('default') : lift(row[name] as Input<unknown>, defs[index]!.type).fragment
				),
				', ',
			))
		);
		return join([group(join(names.map(identifier), ', ')), keyword(' values '), join(lists, ', ')]);
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
			assignments(values(this.#state.table, conflict.set), this.#state.table),
			where(conflict.where ? [conflict.where] : []),
		]);
	}
}

/**
 * Start an insert of one or more rows, or of the rows a select returns.
 *
 * For `insert … select`, name each selected value after the column it fills.
 */
export function insert<C extends Columns, K extends string, const V extends InsertRow<C> | readonly InsertRow<C>[]>(
	table: Table<C, K>,
	rows: V,
): Insert<C, K, Record<never, never>, OwnersOfRow<V>>;
export function insert<C extends Columns, K extends string, Q extends InsertSelect<C>>(
	table: Table<C, K>,
	rows: Q,
): Insert<C, K, Record<never, never>, FreeOf<Q>>;
export function insert<C extends Columns>(
	table: Table<C>,
	rows: InsertRow<C> | readonly InsertRow<C>[] | InsertSelect<C>,
): Insert<C> {
	same(dialect, table.dialect);
	const list = Array.isArray(rows)
		? rows
		: brand in (rows as object)
		? rows as InsertSelect<C>
		: [rows as InsertRow<C>];
	return new Insert({ table, rows: list, with: [], where: [] });
}
