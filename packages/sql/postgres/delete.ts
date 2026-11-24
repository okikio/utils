/**
 * `delete`, built by `remove`, with `delete … using`. Its scope is its table and the sources of its `using`.
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
import { returning, sources, where, Write, type WriteState } from './write.ts';

interface DeleteState<C extends Columns> extends WriteState<C> {
	readonly using: readonly Source[];
}

/** A `delete` being built. Its scope is its table and the sources of its `using`. */
export class Delete<
	C extends Columns,
	K extends string = string,
	S extends Shape = Record<never, never>,
	Scope extends string = never,
	Used extends string = never,
> extends Write<S> {
	declare readonly [reads]?: Exclude<Used, K | Scope>;
	readonly #state: DeleteState<C>;
	constructor(state: DeleteState<C>) {
		super();
		this.#state = state;
	}
	/** Define named subqueries first, to read them in `using` or `where`. */
	with(...ctes: readonly CteType<unknown>[]): Delete<C, K, S, Scope, Used> {
		for (const item of ctes) same(dialect, item.dialect);
		return new Delete({ ...this.#state, with: [...this.#state.with, ...ctes] });
	}
	/** Read other sources too; join them to the table in `where`. */
	using<const R extends readonly Source[]>(
		...items: R
	): Delete<C, K, S, Scope | KeyOf<R[number]>, Used | ReadsOf<R[number]>> {
		for (const item of items) same(dialect, dialectOfSource(item));
		return new Delete({ ...this.#state, using: [...this.#state.using, ...items] });
	}
	/** Delete only rows where every given condition holds. Repeated calls add conditions. */
	where<const W extends readonly Expr<boolean, string>[]>(
		...conditions: W
	): Delete<C, K, S, Scope, Used | OwnersOf<W[number]>> {
		return new Delete({ ...this.#state, where: [...this.#state.where, ...conditions] });
	}
	/** Return values from the deleted rows. */
	returning<const R extends Shape>(shape: R): Delete<C, K, R, Scope, Used | OwnersOfShape<R>> {
		return new Delete<C, K, R, Scope, Used | OwnersOfShape<R>>({ ...this.#state, returning: shape });
	}
	protected returned(): Shape | undefined {
		return this.#state.returning;
	}
	get free(): ReadonlySet<string> {
		const state = this.#state;
		return free(
			[...state.using.map(sourceReads), ...state.where, ...Object.values(state.returning ?? {})],
			[state.table.key, ...state.using.map((item) => item.key)],
		);
	}
	get fragment(): Fragment {
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
export function remove<C extends Columns, K extends string>(table: Table<C, K>): Delete<C, K> {
	same(dialect, table.dialect);
	return new Delete({ table, using: [], with: [], where: [] });
}
