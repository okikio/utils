/**
 * The PostgreSQL `select` builder.
 *
 * A select runs on its own, or embeds as a subquery through `exists`, `scalar`, `in` or `cte`. When it runs on its own,
 * each selected value is converted to its portable form for reading; as a subquery it keeps raw values, so a
 * comparison such as `id in (select …)` compares the real column types.
 *
 * The builder tracks its scope. `Scope` is the owners its `from` and joins define; `Used` is every owner its values,
 * conditions and orders read. A select whose `Used` has an owner outside `Scope` can only be a correlated subquery:
 * as a statement it does not type-check, and its `query` throws.
 *
 * @module
 */
import { type Dialect, same } from '../dialect.ts';
import { type AnyExpr, Expr, type Input, lift, type OrderType, type OwnersOf, reads } from '../expr.ts';
import { type Fragment, group, join, keyword, param } from '../fragment.ts';
import { and } from '../logic.ts';
import {
	brand,
	closed,
	type CteType,
	dialectOfSource,
	free,
	type KeyOf,
	list,
	owner,
	type OwnersOfShape,
	prefix,
	type ReadsOf,
	type RowOfShape,
	type Shape,
	type Source,
	source,
	sourceReads,
	type TypesOf,
	typesOf,
} from '../statement.ts';
import type { SqlType } from '../type.ts';
import { dialect } from './dialect.ts';

/** Row locks a select can take. */
export interface LockType {
	/** `for update` locks rows to change them; `for share` only keeps them from changing. */
	readonly mode?: 'update' | 'share' | 'no key update' | 'key share';
	/** Lock rows of these sources only, when the select joins several. Each must be in the select's scope. */
	readonly of?: readonly Source[];
	/** Skip rows another transaction holds, as a work queue does. */
	readonly skipLocked?: boolean;
	/** Fail at once instead of waiting for a lock. */
	readonly noWait?: boolean;
}

/** One part of a select that reads owners. */
interface UsedType {
	readonly owners: ReadonlySet<string>;
}

interface SelectState {
	readonly shape: Shape;
	readonly distinct?: boolean;
	readonly with: readonly CteType<unknown>[];
	readonly from?: Source;
	readonly joins: readonly {
		readonly fragment: Fragment;
		readonly key: string;
		readonly on: UsedType;
		readonly reads: UsedType;
	}[];
	readonly where: readonly Expr<boolean, string>[];
	readonly groupBy: readonly AnyExpr[];
	readonly orderBy: readonly OrderType[];
	readonly limit?: Expr<number, string>;
	readonly offset?: Expr<number, string>;
	readonly lock?: LockType;
}

/** Counts for limit and offset; a `bigint` parameter accepts any safe integer. */
const countType: SqlType<number> = Object.freeze({
	dialect,
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

/** An order item or expression; a plain expression orders ascending. */
type OrderItem = OrderType | AnyExpr;
/** The owners of a list of order items. */
type OwnersOfOrder<L extends readonly OrderItem[]> = OwnersOf<L[number]>;

/** A `select` statement being built. `Scope` is what it defines; `Used` is what it reads. */
export class Select<S extends Shape, Scope extends string = never, Used extends string = OwnersOfShape<S>> {
	declare readonly [brand]: true;
	declare readonly [reads]?: Exclude<Used, Scope>;
	readonly #state: SelectState;
	constructor(state: SelectState) {
		this.#state = state;
		Object.defineProperty(this, brand, { value: true });
	}
	/** The dialect: PostgreSQL. */
	get dialect(): Dialect {
		return dialect;
	}
	/** Return each distinct row once. */
	distinct(): Select<S, Scope, Used> {
		return new Select({ ...this.#state, distinct: true });
	}
	/** Define named subqueries first, to read them in `from` or a join. */
	with(...ctes: readonly CteType<unknown>[]): Select<S, Scope, Used> {
		for (const item of ctes) same(dialect, item.dialect);
		return new Select({ ...this.#state, with: [...this.#state.with, ...ctes] });
	}
	/** Read from a table, alias, named subquery or row function. Its owner joins the scope. */
	from<const R extends Source>(table: R): Select<S, Scope | KeyOf<R>, Used | ReadsOf<R>> {
		same(dialect, dialectOfSource(table));
		return new Select({ ...this.#state, from: table });
	}
	/** Inner join another source on a condition. */
	join<const R extends Source, X extends Expr<boolean, string>>(
		table: R,
		on: X,
	): Select<S, Scope | KeyOf<R>, Used | OwnersOf<X> | ReadsOf<R>> {
		return this.#join(' join ', table, on) as never;
	}
	/** Left join another source on a condition; its columns may be NULL in the result. */
	leftJoin<const R extends Source, X extends Expr<boolean, string>>(
		table: R,
		on: X,
	): Select<S, Scope | KeyOf<R>, Used | OwnersOf<X> | ReadsOf<R>> {
		return this.#join(' left join ', table, on) as never;
	}
	/** Keep rows where every given condition holds. Repeated calls add conditions. */
	where<const C extends readonly Expr<boolean, string>[]>(
		...conditions: C
	): Select<S, Scope, Used | OwnersOf<C[number]>> {
		for (const item of conditions) same(dialect, item.dialect);
		return new Select({ ...this.#state, where: [...this.#state.where, ...conditions] });
	}
	/** Group rows for aggregates. */
	groupBy<const L extends readonly AnyExpr[]>(...items: L): Select<S, Scope, Used | OwnersOf<L[number]>> {
		return new Select({ ...this.#state, groupBy: [...this.#state.groupBy, ...items] });
	}
	/** Order rows. Pass `column.desc()` for descending order; a plain expression orders ascending. */
	orderBy<const L extends readonly OrderItem[]>(...items: L): Select<S, Scope, Used | OwnersOfOrder<L>> {
		const orders = items.map((item) => item instanceof Expr ? item.asc() : item);
		for (const item of orders) same(dialect, item.dialect);
		return new Select({ ...this.#state, orderBy: [...this.#state.orderBy, ...orders] });
	}
	/** Return at most this many rows. */
	limit<X extends Input<number>>(count: X): Select<S, Scope, Used | OwnersOf<X>> {
		return new Select({ ...this.#state, limit: lift(count as Input<number>, countType) });
	}
	/** Skip this many rows first. */
	offset<X extends Input<number>>(count: X): Select<S, Scope, Used | OwnersOf<X>> {
		return new Select({ ...this.#state, offset: lift(count as Input<number>, countType) });
	}
	/** Lock the selected rows until the transaction ends. */
	for(lock: LockType = {}): Select<S, Scope, Used> {
		return new Select({ ...this.#state, lock });
	}
	/** The owners this select reads but does not define. */
	get free(): ReadonlySet<string> {
		const state = this.#state;
		const used: { readonly owners: ReadonlySet<string> }[] = [
			...Object.values(state.shape),
			...(state.from ? [sourceReads(state.from)] : []),
			...state.joins.flatMap((item) => [item.on, item.reads]),
			...state.where,
			...state.groupBy,
			...state.orderBy,
			...(state.limit ? [state.limit] : []),
			...(state.offset ? [state.offset] : []),
		];
		const defined = [...(state.from ? [state.from.key] : []), ...state.joins.map((item) => item.key)];
		for (const target of state.lock?.of ?? []) {
			if (!defined.includes(target.key)) {
				throw new TypeError(`A lock names ${target.key}, which the select does not read.`);
			}
		}
		return free(used, defined);
	}
	/** The SQL with raw values, for embedding as a subquery. Its free owners pass to the embedding expression. */
	get fragment(): Fragment {
		this.free;
		return this.#render(false);
	}
	/** The SQL sent when this select runs on its own, with values converted for reading. */
	get query(): Fragment {
		closed(this.free, 'select');
		return this.#render(true);
	}
	/** The value type of each selected column. */
	get shape(): TypesOf<RowOfShape<S>> {
		return typesOf<RowOfShape<S>>(this.#state.shape);
	}

	#join<R extends Source>(word: string, table: R, on: Expr<boolean, string>): Select<S, never, never> {
		same(dialect, dialectOfSource(table));
		same(dialect, on.dialect);
		const item = {
			fragment: join([keyword(word), source(table), keyword(' on '), on.fragment]),
			key: table.key,
			on,
			reads: sourceReads(table),
		};
		return new Select({ ...this.#state, joins: [...this.#state.joins, item] });
	}

	#render(read: boolean): Fragment {
		const state = this.#state;
		const parts: Fragment[] = [
			prefix(state.with),
			keyword(state.distinct ? 'select distinct ' : 'select '),
			list(state.shape, read),
		];
		if (state.from) parts.push(keyword(' from '), source(state.from), ...state.joins.map((item) => item.fragment));
		if (state.where.length) parts.push(keyword(' where '), and(...state.where as [Expr<boolean, string>]).fragment);
		if (state.groupBy.length) parts.push(keyword(' group by '), join(state.groupBy.map((item) => item.operand), ', '));
		if (state.orderBy.length) {
			parts.push(keyword(' order by '), join(state.orderBy.map((item) => item.fragment), ', '));
		}
		if (state.limit) parts.push(keyword(' limit '), state.limit.operand);
		if (state.offset) parts.push(keyword(' offset '), state.offset.operand);
		if (state.lock) {
			parts.push(keyword(` for ${state.lock.mode ?? 'update'}`));
			if (state.lock.of?.length) parts.push(keyword(' of '), join(state.lock.of.map(owner), ', '));
			if (state.lock.skipLocked) parts.push(keyword(' skip locked'));
			if (state.lock.noWait) parts.push(keyword(' nowait'));
		}
		return join(parts);
	}
}

/** Start a `select` of named values. A select without `from` evaluates its values once. */
export function select<const S extends Shape>(shape: S): Select<S> {
	for (const expr of Object.values(shape)) same(dialect, expr.dialect);
	return new Select({ shape, with: [], joins: [], where: [], groupBy: [], orderBy: [] });
}
