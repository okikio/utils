/**
 * Types for CockroachDB, which speaks PostgreSQL's protocol and SQL.
 *
 * Statements, functions and schema statements come from `@okikio/sql/postgres` unchanged. Only the types that
 * CockroachDB reads differently are replaced here; take `types` from this module instead:
 *
 * - `double` and `real` are read through `decimal`. The PostgreSQL types read a float's exact bits with `float8send`,
 *   which CockroachDB does not have. A float's own text depends on the session's `extra_float_digits`, which is 0 by
 *   default and then rounds to 15 digits; CockroachDB's float-to-`decimal` cast keeps the shortest exact form at any
 *   setting. A `real` is rounded to 32 bits again, so it reads as the same number PostgreSQL returns.
 *
 * Other differences are CockroachDB's own: triggers cannot list update columns, only the ISO `DateStyle` exists, and
 * `pg_cancel_backend` is missing; a cancel request still works. See the interop suite's known limits.
 *
 * @example
 * ```ts ignore
 * import * as sql from '@okikio/sql/postgres';
 * import { types } from '@okikio/sql/postgres/cockroach';
 *
 * const readings = sql.schema('app').table('readings', { id: sql.column(types.integer), value: sql.column(types.double) });
 * ```
 *
 * @module
 */
import type { SqlType } from '../type.ts';
import { textOf, textual } from './types/shared.ts';
import * as postgres from './types/mod.ts';
import { expect } from '../type.ts';
import { type Fragment, join, keyword } from '../fragment.ts';

/** The `decimal` text of a float, such as `0.30000000000000004` or `1E+300`, with `NaN`, the infinities and `-0`. */
const float = /^(?:NaN|-?Infinity|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)$/u;

/** `((x)::decimal)::text`: CockroachDB's exact, shortest text for a float. */
function exact(expression: Fragment): Fragment {
	return join([keyword('(('), expression, keyword(')::decimal)::text')]);
}

function floating(name: string, round: (value: number) => number): SqlType<number> {
	return textual(
		name,
		(value: number) => {
			const number = expect(
				value,
				(v): v is number => typeof v === 'number',
				name,
			);
			return Object.is(number, -0) ? '-0' : String(number);
		},
		(raw) => round(Number(textOf(raw, float, name))),
		exact,
	);
}

/** CockroachDB's types: PostgreSQL's, with floats read through `decimal`. */
export const types: typeof postgres = Object.freeze({
	...postgres,
	double: floating('double precision', (value) => value),
	real: floating('real', Math.fround),
});
