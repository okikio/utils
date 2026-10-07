import type {
	QueryDefinition,
	QueryFields,
	QueryIssue,
	QueryOrder,
	QueryPaginationDefinition,
	QuerySort,
	QuerySortDirection,
} from './types.ts';
import { assertFieldName } from './fields.ts';
import { enabledPaginationModes } from './pagination.ts';
import { listValues } from './values.ts';
import { issue } from './validation.ts';

const fieldNamePattern = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** Define ascending default/stable ordering. */
export function asc<const Field extends string>(
	fieldName: Field,
	options: Readonly<{ readonly tiebreaker?: boolean }> = {},
): QueryOrder<Field> {
	return order(fieldName, 'asc', options.tiebreaker ?? false);
}

/** Define descending default/stable ordering. */
export function desc<const Field extends string>(
	fieldName: Field,
	options: Readonly<{ readonly tiebreaker?: boolean }> = {},
): QueryOrder<Field> {
	return order(fieldName, 'desc', options.tiebreaker ?? false);
}

/**
 * Parses sorts into the validated internal model used by later phases.
 *
 * It keeps public query semantics provider-neutral so storage adapters can compile the same validated request differently.
 *
 * @internal
 */
export function parseSorts<Fields extends QueryFields>(
	definition: QueryDefinition<Fields>,
	entries: ReadonlyMap<string, readonly unknown[]>,
	issues: QueryIssue[],
): QuerySort<keyof Fields & string>[] {
	const requested = (entries.get('sort') ?? []).flatMap(listValues).map(String).filter(Boolean);
	const result: QuerySort<keyof Fields & string>[] = [];
	const seen = new Set<string>();
	for (const token of requested) {
		const parsed = parseSortToken(token);
		if (!parsed) {
			issues.push(issue(
				'invalid-sort',
				`Invalid sort ${JSON.stringify(token)}. Use field:asc or field:desc.`,
				['sort'],
			));
			continue;
		}
		const fieldDefinition = definition.fields[parsed.field];
		if (!fieldDefinition) {
			issues.push(issue('unknown-field', `Unknown sort field ${JSON.stringify(parsed.field)}.`, ['sort']));
			continue;
		}
		if (!fieldDefinition.sortable && !definition.order.some((entry) => entry.field === parsed.field)) {
			issues.push(issue('sorting-disabled', `Field ${JSON.stringify(parsed.field)} is not sortable.`, ['sort']));
			continue;
		}
		if (seen.has(parsed.field)) {
			issues.push(issue('duplicate-sort', `Sort field ${JSON.stringify(parsed.field)} is duplicated.`, ['sort']));
			continue;
		}
		seen.add(parsed.field);
		result.push(
			Object.freeze({ field: parsed.field, direction: parsed.direction, tiebreaker: false }) as QuerySort<
				keyof Fields & string
			>,
		);
	}
	if (result.length === 0) return definition.order.map(normalizeOrder);
	for (const stable of definition.order.filter((entry) => entry.tiebreaker)) {
		if (!seen.has(stable.field)) result.push(normalizeOrder(stable));
		else {
			const index = result.findIndex((entry) => entry.field === stable.field);
			result[index] = Object.freeze({ ...result[index]!, tiebreaker: true });
		}
	}
	// Canonical URLs include the stable field. It must not consume the requested-sort
	// budget merely because a caller replays the encoded query instead of omitting it.
	if (result.filter((entry) => !entry.tiebreaker).length > definition.maximumSorts) {
		issues.push(issue('too-many-sorts', `At most ${definition.maximumSorts} sorts are allowed.`, ['sort']));
	}
	return result;
}

/**
 * Parses sort token into the validated internal model used by later phases.
 *
 * @internal
 */
export function parseSortToken(
	token: string,
): Readonly<{ readonly field: string; readonly direction: QuerySortDirection }> | undefined {
	const trimmed = token.trim();
	if (trimmed.length === 0 || trimmed.startsWith('+') || trimmed.startsWith('-')) return undefined;
	const parts = trimmed.split(':');
	if (parts.length > 2) return undefined;
	const fieldName = parts[0]?.trim() ?? '';
	if (!fieldNamePattern.test(fieldName)) return undefined;
	const direction = (parts[1]?.trim() || 'asc') as QuerySortDirection;
	if (direction !== 'asc' && direction !== 'desc') return undefined;
	return Object.freeze({ field: fieldName, direction });
}

/**
 * Normalizes order into the canonical internal form used by later phases.
 *
 * @internal
 */
export function normalizeOrder<Field extends string>(entry: QueryOrder<Field>): QuerySort<Field> {
	return Object.freeze({
		field: entry.field,
		direction: entry.direction,
		tiebreaker: entry.tiebreaker,
	});
}

/**
 * Checks order and preserves the deterministic issues needed by callers.
 *
 * It keeps public query semantics provider-neutral so storage adapters can compile the same validated request differently.
 *
 * @internal
 */
export function validateOrder<Fields extends QueryFields>(
	entries: readonly QueryOrder<keyof Fields & string>[],
	fields: Fields,
	paginationDefinition: QueryPaginationDefinition,
): void {
	const seen = new Set<string>();
	let tiebreakers = 0;
	for (const entry of entries) {
		if (!fields[entry.field]) throw new TypeError(`Order field ${JSON.stringify(entry.field)} is not public.`);
		if (seen.has(entry.field)) throw new TypeError(`Order field ${JSON.stringify(entry.field)} is duplicated.`);
		seen.add(entry.field);
		if (entry.tiebreaker) tiebreakers += 1;
	}
	if (tiebreakers > 1) throw new TypeError('A query order may contain only one tiebreaker.');
	if (enabledPaginationModes(paginationDefinition).includes('cursor') && tiebreakers !== 1) {
		throw new TypeError('Cursor pagination requires exactly one stable tiebreaker order field.');
	}
}

/**
 * Normalizes the order requested by callers of provider-neutral query definitions.
 *
 * @internal
 */
export function order<const Field extends string>(
	fieldName: Field,
	direction: QuerySortDirection,
	tiebreaker: boolean,
): QueryOrder<Field> {
	assertFieldName(fieldName);
	return Object.freeze({ kind: 'query-order', field: fieldName, direction, tiebreaker });
}
