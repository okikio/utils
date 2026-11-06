import type { QueryOperator, QueryOperatorName } from './types.ts';

/**
 * Declare operator identity and operand count; actual comparison semantics belong to the storage adapter.
 *
 * @internal
 */
function operator<const Name extends QueryOperatorName>(
	name: Name,
	value: QueryOperator<Name>['value'],
	description: string,
): QueryOperator<Name> {
	return Object.freeze({ kind: 'query-operator', id: `query:${name}`, name, value, description });
}

/** Equality filter. */
export const eq: QueryOperator<'eq'> = operator('eq', 'one', 'Equals the supplied value.');
/** Inequality filter. */
export const ne: QueryOperator<'ne'> = operator('ne', 'one', 'Does not equal the supplied value.');
/** Greater-than filter. */
export const gt: QueryOperator<'gt'> = operator('gt', 'one', 'Is greater than the supplied value.');
/** Greater-than-or-equal filter. */
export const gte: QueryOperator<'gte'> = operator('gte', 'one', 'Is greater than or equal to the supplied value.');
/** Less-than filter. */
export const lt: QueryOperator<'lt'> = operator('lt', 'one', 'Is less than the supplied value.');
/** Less-than-or-equal filter. */
export const lte: QueryOperator<'lte'> = operator('lte', 'one', 'Is less than or equal to the supplied value.');
/** Inclusive pair/range filter. */
export const between: QueryOperator<'between'> = operator(
	'between',
	'pair',
	'Falls between the supplied pair of values.',
);
/** Set-membership filter. */
export const inArray: QueryOperator<'in'> = operator('in', 'many', 'Matches one of the supplied values.');
/** Set-exclusion filter. */
export const notInArray: QueryOperator<'nin'> = operator('nin', 'many', 'Does not match any supplied value.');
/** Case-sensitive substring filter. */
export const contains: QueryOperator<'contains'> = operator('contains', 'one', 'Contains the supplied value.');
/** Case-insensitive substring filter. */
export const icontains: QueryOperator<'icontains'> = operator(
	'icontains',
	'one',
	'Contains the supplied value ignoring case.',
);
/** Prefix filter. */
export const startsWith: QueryOperator<'startsWith'> = operator('startsWith', 'one', 'Starts with the supplied value.');
/** Suffix filter. */
export const endsWith: QueryOperator<'endsWith'> = operator('endsWith', 'one', 'Ends with the supplied value.');
/** Null check. */
export const isNull: QueryOperator<'isNull'> = operator('isNull', 'none', 'Has a null value.');
/** Non-null check. */
export const isNotNull: QueryOperator<'isNotNull'> = operator('isNotNull', 'none', 'Has a non-null value.');

/** Alias using the handbook spelling. */
export { inArray as in };
/** Explicit readable alias for `nin`. */
export { notInArray as nin };
