/**
 * The `select` builder.
 *
 * A select runs on its own, or embeds as a subquery through `exists`, `scalar`, `in` or `cte`. When it runs on its own,
 * each selected value is converted to its portable form for reading; as a subquery it keeps raw values, so a
 * comparison such as `id in (select …)` compares the real column types.
 *
 * @module
 */
import { and, type AnyExpr, Expr, type Input, lift, type OrderType, type Subquery } from './expr.ts';
import { type Fragment, group, join, keyword, param } from './fragment.ts';
import {
	brand,
	type CteType,
	list,
	owner,
	prefix,
	type RowOfShape,
	type Shape,
	type Source,
	source,
	type Statement,
	type TypesOf,
	typesOf,
} from './statement.ts';
import type { SqlType } from './type.ts';

/** Row locks a select can take. */
export interface LockType {
	/** `for update` locks rows to change them; `for share` only keeps them from changing. */
	readonly mode?: 'update' | 'share' | 'no key update' | 'key share';
	/** Lock rows of these sources only, when the select joins several. */
	readonly of?: readonly Source[];
	/** Skip rows another transaction holds, as a work queue does. */
	readonly skipLocked?: boolean;
	/** Fail at once instead of waiting for a lock. */
	readonly noWait?: boolean;
}

interface SelectState {
	readonly shape: Shape;
	readonly with: readonly CteType<unknown>[];
	readonly from?: Source;
	readonly joins: readonly Fragment[];
	readonly where: readonly Expr<boolean>[];
	readonly groupBy: readonly AnyExpr[];
	readonly orderBy: readonly OrderType[];
	readonly limit?: Expr<number>;
	readonly offset?: Expr<number>;
	readonly lock?: LockType;
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

/** A `select` statement being built. */
export class Select<S extends Shape> implements Statement<RowOfShape<S>>, Subquery<RowOfShape<S>> {
	declare readonly [brand]: true;
	readonly #state: SelectState;
	constructor(state: SelectState) {
		this.#state = state;
		Object.defineProperty(this, brand, { value: true });
	}
	/** Define named subqueries first, to read them in `from` or a join. */
	with(...ctes: readonly CteType<unknown>[]): Select<S> {
		return new Select({ ...this.#state, with: [...this.#state.with, ...ctes] });
	}
	/** Read from a table or named subquery. */
	from(table: Source): Select<S> {
		return new Select({ ...this.#state, from: table });
	}
	/** Inner join another source on a condition. */
	join(table: Source, on: Expr<boolean>): Select<S> {
		const item = join([keyword(' join '), source(table), keyword(' on '), on.fragment]);
		return new Select({ ...this.#state, joins: [...this.#state.joins, item] });
	}
	/** Left join another source on a condition; its columns may be NULL in the result. */
	leftJoin(table: Source, on: Expr<boolean>): Select<S> {
		const item = join([keyword(' left join '), source(table), keyword(' on '), on.fragment]);
		return new Select({ ...this.#state, joins: [...this.#state.joins, item] });
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
	get shape(): TypesOf<RowOfShape<S>> {
		return typesOf<RowOfShape<S>>(this.#state.shape);
	}

	#render(read: boolean): Fragment {
		const state = this.#state;
		const parts: Fragment[] = [prefix(state.with), keyword('select '), list(state.shape, read)];
		if (state.from) parts.push(keyword(' from '), source(state.from), ...state.joins);
		if (state.where.length) parts.push(keyword(' where '), and(...state.where).fragment);
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
	return new Select({ shape, with: [], joins: [], where: [], groupBy: [], orderBy: [] });
}
