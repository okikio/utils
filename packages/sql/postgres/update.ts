/**
 * `update`, with `update … from`. Its scope is its table and the sources of its `from`.
 *
 * @module
 */
import { same } from '../dialect.ts';
import { type Expr, type OwnersOf, reads } from '../expr.ts';
import { type Fragment, join, keyword, qualified } from '../fragment.ts';
import {
	type CteType,
	dialectOfSource,
	free,
	type KeyOf,
	type OwnersOfShape,
	prefix,
	type ReadsOf,
	type Shape,
	type Source,
	sourceReads,
} from '../statement.ts';
import type { Columns, Table } from '../table.ts';
import { dialect } from './dialect.ts';
import {
	assignments,
	type OwnersOfRow,
	returning,
	sources,
	type UpdateRow,
	values,
	where,
	Write,
	type WriteState,
} from './write.ts';

interface UpdateState<C extends Columns> extends WriteState<C> {
	readonly values: UpdateRow<C>;
	readonly from: readonly Source[];
}

/** An `update` being built. Its scope is its table and the sources of its `from`. */
export class Update<
	C extends Columns,
	K extends string = string,
	S extends Shape = Record<never, never>,
	Scope extends string = never,
	Used extends string = never,
> extends Write<S> {
	declare readonly [reads]?: Exclude<Used, K | Scope>;
	readonly #state: UpdateState<C>;
	constructor(state: UpdateState<C>) {
		super();
		this.#state = state;
	}
	/** Define named subqueries first, to read them in `from` or `where`. */
	with(...ctes: readonly CteType<unknown>[]): Update<C, K, S, Scope, Used> {
		for (const item of ctes) same(dialect, item.dialect);
		return new Update({ ...this.#state, with: [...this.#state.with, ...ctes] });
	}
	/** Read other sources too; join them to the table in `where`. */
	from<const R extends readonly Source[]>(
		...items: R
	): Update<C, K, S, Scope | KeyOf<R[number]>, Used | ReadsOf<R[number]>> {
		for (const item of items) same(dialect, dialectOfSource(item));
		return new Update({ ...this.#state, from: [...this.#state.from, ...items] });
	}
	/** Change only rows where every given condition holds. Repeated calls add conditions. */
	where<const W extends readonly Expr<boolean, string>[]>(
		...conditions: W
	): Update<C, K, S, Scope, Used | OwnersOf<W[number]>> {
		return new Update({ ...this.#state, where: [...this.#state.where, ...conditions] });
	}
	/** Return values from the changed rows. */
	returning<const R extends Shape>(shape: R): Update<C, K, R, Scope, Used | OwnersOfShape<R>> {
		return new Update<C, K, R, Scope, Used | OwnersOfShape<R>>({ ...this.#state, returning: shape });
	}
	protected returned(): Shape | undefined {
		return this.#state.returning;
	}
	get free(): ReadonlySet<string> {
		const state = this.#state;
		const set = values(state.table, state.values).map(([, value]) => value);
		return free(
			[...set, ...state.from.map(sourceReads), ...state.where, ...Object.values(state.returning ?? {})],
			[state.table.key, ...state.from.map((item) => item.key)],
		);
	}
	get fragment(): Fragment {
		const state = this.#state;
		return join([
			prefix(state.with),
			keyword('update '),
			qualified(state.table.schema, state.table.name),
			keyword(' set '),
			assignments(values(state.table, state.values), state.table),
			sources('from', state.from),
			where(state.where),
			returning(state.returning),
		]);
	}
}

/** Start an update that sets columns. Add `where` to limit the rows. */
export function update<C extends Columns, K extends string, const V extends UpdateRow<C>>(
	table: Table<C, K>,
	values: V,
): Update<C, K, Record<never, never>, never, OwnersOfRow<V>> {
	same(dialect, table.dialect);
	return new Update({ table, values, from: [], with: [], where: [] });
}
