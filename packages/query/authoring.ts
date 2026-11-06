import * as record from '@okikio/collection/record';
import { paginationDefinitions } from './pagination.ts';
import { safeParse } from './parse.ts';
import { failure, issue } from './validation.ts';
import type { QueryFields, QueryIssue, QueryParseResult, QueryPolicy, QueryValue } from './types.ts';

/**
 * Validate typed semantic input through the same field and policy checks as URL
 * input. This translation changes syntax only: values are passed directly to
 * their field schemas, so transformed schema inputs are not validated twice.
 * Authored trees are bounded before recursion and never evaluated as code.
 *
 * @internal
 */
export function safeCreate<Fields extends QueryFields>(
	definition: QueryPolicy<Fields>,
	input: unknown = {},
): Promise<QueryParseResult<QueryValue<Fields>>> {
	const issues: QueryIssue[] = [];
	if (!record.is(input)) {
		return Promise.resolve(failure([issue('invalid-input', 'A query input must be a plain data record.', [])]));
	}
	const wire: Record<string, unknown> = Object.create(null);
	let nodes = 0;
	const maximumNodes = definition.maximumFilters * definition.maximumDepth;
	const active = new Set<object>();
	if (input.filter !== undefined) wire.filter = expression(input.filter, ['filter'], 1);
	if (input.order !== undefined) {
		const order = array(input.order, ['order'], definition.maximumSorts, 'too-many-sorts');
		if (order !== undefined) {
			const entries: string[] = [];
			for (const [index, entry] of order.entries()) {
				if (
					!record.is(entry) || typeof entry.field !== 'string' ||
					(entry.direction !== 'asc' && entry.direction !== 'desc')
				) {
					issues.push(issue('invalid-sort', 'A sort requires a field and asc or desc direction.', ['order', index]));
				} else entries.push(`${entry.field}:${entry.direction}`);
			}
			if (entries.length > 0) wire.sort = entries.join(',');
		}
	}
	if (input.fields !== undefined) {
		if (Array.isArray(input.fields)) wire.fields = input.fields;
		else if (!record.is(input.fields)) {
			issues.push(issue('invalid-input', 'A projection must be a field list or plain selection record.', ['fields']));
		} else if (input.fields.kind === 'simple') wire.fields = input.fields.fields;
		else if (input.fields.kind === 'resource') wire.fields = input.fields.resources;
		else issues.push(issue('invalid-input', 'A projection kind must be simple or resource.', ['fields', 'kind']));
	}
	if (input.pagination !== undefined) {
		const page = input.pagination;
		if (!record.is(page)) {
			issues.push(issue('invalid-input', 'Pagination must be a plain data record.', ['pagination']));
		} else {
			const policies = paginationDefinitions(definition.pagination);
			if (page.kind === 'cursor' && policies.cursor !== undefined) {
				const names = policies.cursor.parameters;
				if (page.cursor !== undefined) wire[names.cursor] = page.cursor;
				wire[names.limit] = page.limit ?? policies.cursor.defaultLimit;
				if (policies.default !== 'cursor' && page.cursor === undefined) {
					issues.push(
						issue(
							'pagination-conflict',
							'The first cursor page must be the default mode when no cursor token is present.',
							['pagination'],
						),
					);
				}
			} else if ((page.kind === 'offset' || page.kind === 'page') && policies.offset !== undefined) {
				const names = policies.offset.parameters;
				if (page.kind === 'page') {
					wire[names.page] = page.page ?? 1;
					wire[names.perPage] = page.limit ?? policies.offset.defaultLimit;
				} else {
					wire[names.offset] = page.offset ?? 0;
					wire[names.limit] = page.limit ?? policies.offset.defaultLimit;
				}
			} else {issues.push(
					issue('unsupported-pagination', 'This query does not support the requested page mode.', [
						'pagination',
						'kind',
					]),
				);}
		}
	}
	return issues.length > 0 ? Promise.resolve(failure(issues)) : safeParse(definition, wire);

	/** Bound semantic trees before lowering them into the documented wire grammar. */
	function expression(value: unknown, path: readonly PropertyKey[], depth: number): unknown {
		if (++nodes > maximumNodes) {
			issues.push(
				issue('too-many-filters', 'The authored expression exceeds the configured filter and depth budgets.', path),
			);
			return undefined;
		}
		if (depth > definition.maximumDepth) {
			issues.push(issue('expression-too-deep', `Filter depth may not exceed ${definition.maximumDepth}.`, path));
			return undefined;
		}
		if (!record.is(value) || active.has(value)) {
			issues.push(issue('invalid-expression', 'Conditions must be acyclic plain data records.', path));
			return undefined;
		}
		if ('field' in value) {
			if (typeof value.field !== 'string' || !Object.hasOwn(definition.fields, value.field)) {
				issues.push(issue('unknown-field', 'The condition field is not declared by this query.', [...path, 'field']));
				return undefined;
			}
			if (
				typeof value.operator !== 'string' ||
				!(definition.filters[value.field] ?? []).some((operator) => operator.name === value.operator)
			) {
				issues.push(
					issue('unknown-operator', 'The condition operator is not enabled for this field.', [...path, 'operator']),
				);
				return undefined;
			}
			const nullary = value.operator === 'isNull' || value.operator === 'isNotNull';
			if (Object.hasOwn(value, 'value') === nullary) {
				issues.push(
					issue(
						'invalid-value',
						nullary ? 'A null condition does not accept an operand.' : 'This condition requires an operand.',
						[...path, 'value'],
					),
				);
				return undefined;
			}
			return { [value.field]: { [value.operator]: value.value } };
		}
		active.add(value);
		try {
			if (value.kind === 'not') return { $not: expression(value.filter, [...path, 'filter'], depth + 1) };
			if (value.kind !== 'all' && value.kind !== 'any') {
				issues.push(issue('invalid-expression', 'A Boolean group kind must be all, any, or not.', [...path, 'kind']));
				return undefined;
			}
			const children = array(value.filters, [...path, 'filters'], definition.maximumSiblings, 'too-many-siblings');
			if (children === undefined) return undefined;
			if (children.length === 0) {
				issues.push(issue('invalid-expression', 'A Boolean group requires at least one condition.', path));
				return undefined;
			}
			const filters: unknown[] = [];
			for (let index = 0; index < children.length; index++) {
				filters.push(expression(children[index], [...path, 'filters', index], depth + 1));
				if (nodes > maximumNodes) break;
			}
			return { [`$${value.kind}`]: filters };
		} finally {
			active.delete(value);
		}
	}

	/** Snapshot ordinary array slots without calling accessors or materializing unbounded inputs. */
	function array(
		value: unknown,
		path: readonly PropertyKey[],
		maximum: number,
		code: QueryIssue['code'],
	): unknown[] | undefined {
		if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
			issues.push(issue('invalid-input', 'Query lists must be ordinary arrays.', path));
			return undefined;
		}
		if (value.length > maximum) {
			issues.push(issue(code, `At most ${maximum} entries are allowed.`, path));
			return undefined;
		}
		const result: unknown[] = [];
		for (let index = 0; index < value.length; index++) {
			const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
			if (descriptor === undefined || !('value' in descriptor)) {
				issues.push(issue('invalid-input', 'Query arrays require own data properties.', [...path, index]));
				return undefined;
			}
			result.push(descriptor.value);
		}
		return result;
	}
}
