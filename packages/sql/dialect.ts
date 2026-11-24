/**
 * What differs between SQL dialects when a fragment becomes text: how names are quoted, how parameters are written and
 * how a constant is written where the dialect takes no parameters.
 *
 * Only these differences live here. A dialect also owns its types, functions, statement builders and DDL, in its own
 * entry point, such as `@okikio/sql/postgres`. The core never writes dialect syntax itself.
 *
 * @module
 */
import type { SqlType } from './type.ts';

/** Where a constant is written as a literal. */
export type LiteralModeType = 'ddl' | 'routine';

/** One SQL dialect's text rules. */
export interface Dialect {
	/** A short name for messages, such as `postgres`. */
	readonly name: string;
	/** Quote a name that the core already checked as a plain identifier. */
	quote(name: string): string;
	/**
	 * The placeholder of the parameter at `index` (from 1) sent as `type`. `text` is the placeholder in the numbered
	 * form; `suffix` follows the hole in the template form, so a client's `sql` tag sends the same type.
	 */
	placeholder(index: number, type: string): { readonly text: string; readonly suffix: string };
	/**
	 * A constant written as a literal, where the dialect takes no parameters: in DDL, or in a function body. Throw for a
	 * value whose literal could change meaning.
	 */
	literal(value: unknown, type: string, mode: LiteralModeType): string;
	/** The type of a condition, which comparisons and `and`/`or` produce. */
	readonly boolean: SqlType<boolean>;
}

/** Fail when two parts of one expression or statement come from different dialects. */
export function same(left: Dialect, right: Dialect): Dialect {
	if (left !== right) throw new TypeError(`Cannot combine ${left.name} and ${right.name} SQL in one statement.`);
	return left;
}
