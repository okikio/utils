import { withFilter } from './normalize.ts';
import type { QueryFields, QueryIssue, QueryParseResult, QueryPolicy, QueryValue } from './types.ts';
import { parseFields } from './fields.ts';
import { parseSorts } from './sort.ts';
import { parsePagination } from './pagination.ts';
import { failure, issue } from './validation.ts';
import { parseFilters } from './filters.ts';
import { normalizeInput } from './wire.ts';

/**
 * Validate one wire request, applying the definition's field schemas and budgets.
 * Parameter bounds are checked before asynchronous field validation. The result
 * combines checked filters, ordered sorts, selected fields, and one page. Schema
 * issues become query issues; exceptions thrown by a validator remain exceptions.
 *
 * @internal
 */
export async function safeParse<Fields extends QueryFields>(
	definition: QueryPolicy<Fields>,
	input: unknown,
): Promise<QueryParseResult<QueryValue<Fields>>> {
	const issues: QueryIssue[] = [];
	const entries = normalizeInput(input, issues, definition.maximumParameters, definition.maximumDepth);
	if ([...entries.values()].reduce((count, values) => count + values.length, 0) > definition.maximumParameters) {
		issues.push(issue(
			'too-many-parameters',
			`At most ${definition.maximumParameters} query parameters are allowed.`,
			[],
		));
	}
	if (issues.length > 0) return failure(issues);

	const filters = await parseFilters(definition, entries, issues);
	const order = parseSorts(definition, entries, issues);
	const fields = parseFields(definition, entries, issues);
	const parsedPagination = parsePagination(definition.pagination, entries, issues);
	if (issues.length > 0) return failure(issues);

	return Object.freeze({
		success: true,
		value: withFilter(filters, {
			order: Object.freeze(order),
			fields,
			pagination: parsedPagination,
		}),
	});
}
