/**
 * PostgreSQL types and how each value crosses the client boundary.
 *
 * - **Send.** A value is sent as text with an explicit cast (`($1::text)::integer`), so no client encodes it a second
 *   time, and a client that writes values into the SQL text cannot change their meaning.
 * - **Read.** A selected value is converted in SQL to a form every client returns the same way: text, `integer` or
 *   `boolean`. Then `decode` checks it and builds the JavaScript value.
 * - **Text form.** Each type's `encode` gives the text its cast reads, which arrays and composite values build on.
 *
 * @module
 */
import type { Fragment } from '../../fragment.ts';
import type { SqlType } from '../../type.ts';
import { cast, dialect } from '../dialect.ts';

export { boolean } from '../dialect.ts';
export { nullable, type SqlType } from '../../type.ts';
export { bigint, double, integer, long, numeric, real, smallint } from './numbers.ts';
export { bytea, enumerated, jsonb, text, uuid } from './text.ts';
export { date, interval, type IntervalType, time, timestamp, timestamptz } from './time.ts';
export { array, composite, type FieldsType, type FieldValuesType } from './compound.ts';

/** The result of a function such as `pg_advisory_xact_lock` that returns nothing. */
export const empty: SqlType<undefined> = Object.freeze({
	dialect,
	name: 'void',
	send: () => {
		throw new TypeError('A void value cannot be sent.');
	},
	// A void result has a text form (the empty string); reading it keeps the column without a special case.
	read: (expression: Fragment) => cast(expression, 'text'),
	decode: () => undefined,
});
