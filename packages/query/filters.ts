import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { QueryExpression } from './expression.ts';
import { inspectExpression } from './expression.ts';
import { isFilter } from './normalize.ts';
import type {
	QueryDefinition,
	QueryFields,
	QueryFilter,
	QueryIssue,
	QueryOperator,
	QueryOperatorName,
} from './types.ts';
import { implicitOperator, listValues, scalarValues } from './values.ts';
import { decodeValue, isTagged } from './value-codec.ts';
import { issue } from './validation.ts';

const operatorAliases: Readonly<Record<string, QueryOperatorName>> = Object.freeze({
	eq: 'eq',
	ne: 'ne',
	gt: 'gt',
	gte: 'gte',
	lt: 'lt',
	lte: 'lte',
	between: 'between',
	in: 'in',
	nin: 'nin',
	contains: 'contains',
	icontains: 'icontains',
	startswith: 'startsWith',
	starts_with: 'startsWith',
	endswith: 'endsWith',
	ends_with: 'endsWith',
	is_null: 'isNull',
	isnull: 'isNull',
	is_not_null: 'isNotNull',
	isnotnull: 'isNotNull',
});

interface WireNode {
	readonly children: Map<string, WireNode>;
	values?: readonly unknown[];
}

/** Parse the public field grammar into the existing domain-neutral Boolean AST. */
export async function parseFilters<Fields extends QueryFields>(
	definition: QueryDefinition<Fields>,
	entries: ReadonlyMap<string, readonly unknown[]>,
	issues: QueryIssue[],
): Promise<QueryExpression<QueryFilter<Fields>> | undefined> {
	const root: WireNode = { children: new Map() };
	let count = 0;
	for (const [key, values] of entries) {
		if (key !== 'filter' && !key.startsWith('filter[')) continue;
		const match = /^filter((?:\[[^\[\]]+\])+)$/.exec(key);
		if (!match) {
			issues.push(issue('invalid-expression', 'Malformed filter parameter.', [key]));
			continue;
		}
		const tokens = [...match[1]!.matchAll(/\[([^\[\]]+)\]/g)].map((part) => part[1]!);
		if (tokens.length > definition.maximumDepth * 2 + 2) {
			issues.push(issue('expression-too-deep', `Filter depth may not exceed ${definition.maximumDepth}.`, [key]));
			continue;
		}
		count += values.length;
		let node = root;
		for (const token of tokens) {
			let next = node.children.get(token);
			if (next === undefined) {
				next = { children: new Map() };
				node.children.set(token, next);
			}
			node = next;
		}
		node.values = values;
	}
	if (count > definition.maximumFilters) {
		issues.push(issue('too-many-filters', `At most ${definition.maximumFilters} filters are allowed.`, ['filter']));
	}
	if (issues.length > 0 || root.children.size === 0) return undefined;
	const result = await condition(root, ['filter'], 1);
	if (result !== undefined) {
		const dimensions = inspectExpression(result, isFilter<Fields>);
		if (dimensions.maximumDepth > definition.maximumDepth) {
			issues.push(issue('expression-too-deep', `Filter depth may not exceed ${definition.maximumDepth}.`, ['filter']));
		}
		if (dimensions.maximumSiblings > definition.maximumSiblings) {
			issues.push(
				issue('too-many-siblings', `At most ${definition.maximumSiblings} filter siblings are allowed.`, ['filter']),
			);
		}
	}
	return result;

	async function condition(
		node: WireNode,
		path: readonly PropertyKey[],
		depth: number,
	): Promise<QueryExpression<QueryFilter<Fields>> | undefined> {
		if (depth > definition.maximumDepth) {
			issues.push(issue('expression-too-deep', `Filter depth may not exceed ${definition.maximumDepth}.`, path));
			return undefined;
		}
		if (node.values !== undefined || node.children.size === 0) {
			issues.push(issue('invalid-expression', 'A Boolean condition must contain filters.', path));
			return undefined;
		}
		if (node.children.size > definition.maximumSiblings) {
			issues.push(
				issue('too-many-siblings', `At most ${definition.maximumSiblings} filter siblings are allowed.`, path),
			);
			return undefined;
		}
		const children: QueryExpression<QueryFilter<Fields>>[] = [];
		for (const [name, child] of node.children) {
			const childPath = [...path, name];
			if (name.startsWith('$')) {
				const kind = name.slice(1);
				if (kind !== 'all' && kind !== 'any' && kind !== 'not') {
					issues.push(issue('invalid-expression', `Unknown Boolean expression ${name}.`, childPath));
					continue;
				}
				if (!definition.expressions.includes(kind)) {
					issues.push(issue('unsupported-expression', `This query does not support ${name}.`, childPath));
					continue;
				}
				if (kind === 'not') {
					const filter = await condition(child, childPath, depth + 1);
					if (filter !== undefined) children.push(Object.freeze({ kind, filter }));
				} else {
					if (child.values !== undefined || child.children.size === 0) {
						issues.push(issue('invalid-expression', `${name} requires a nonempty indexed group.`, childPath));
						continue;
					}
					if (child.children.size > definition.maximumSiblings) {
						issues.push(
							issue(
								'too-many-siblings',
								`At most ${definition.maximumSiblings} filter siblings are allowed.`,
								childPath,
							),
						);
						continue;
					}
					const indices = [...child.children.keys()];
					if (
						indices.some((index) => !/^(?:0|[1-9]\d*)$/.test(index)) ||
						indices.some((_, index) => !child.children.has(String(index)))
					) {
						issues.push(issue('invalid-expression', `${name} indices must be contiguous from zero.`, childPath));
						continue;
					}
					const filters: QueryExpression<QueryFilter<Fields>>[] = [];
					// URL parameter order may vary; explicit indices preserve the editor order.
					for (let index = 0; index < indices.length; index++) {
						const filter = await condition(child.children.get(String(index))!, [...childPath, index], depth + 1);
						if (filter !== undefined) filters.push(filter);
					}
					if (filters.length > 0) children.push(Object.freeze({ kind, filters: Object.freeze(filters) }));
				}
				continue;
			}
			if (!Object.hasOwn(definition.fields, name)) {
				issues.push(issue('unknown-field', `Unknown filter field ${JSON.stringify(name)}.`, childPath));
				continue;
			}
			if (child.values !== undefined) children.push(...await leaf(name, undefined, child.values, childPath));
			for (const [operator, value] of child.children) {
				if (value.children.size > 0 || value.values === undefined) {
					issues.push(
						issue('invalid-expression', 'A filter operator requires a scalar or list value.', [...childPath, operator]),
					);
					continue;
				}
				children.push(...await leaf(name, operator, value.values, [...childPath, operator]));
			}
		}
		if (children.length === 0) return undefined;
		return children.length === 1 ? children[0] : Object.freeze({ kind: 'all', filters: Object.freeze(children) });
	}

	async function leaf(
		fieldName: string,
		explicit: string | undefined,
		values: readonly unknown[],
		path: readonly PropertyKey[],
	): Promise<QueryFilter<Fields>[]> {
		const result: QueryFilter<Fields>[] = [];
		if (values.some(isTagged) && values.some((value) => !isTagged(value))) {
			issues.push(issue('invalid-value', 'Raw and typed values may not be mixed for one filter parameter.', path));
			return result;
		}
		for (const raw of values) {
			const tagged = isTagged(raw);
			const alias = explicit?.toLowerCase();
			const operatorName = explicit === undefined
				? tagged ? 'eq' : implicitOperator(raw)
				: alias !== undefined && Object.hasOwn(operatorAliases, alias)
				? operatorAliases[alias]!
				: explicit as QueryOperatorName;
			const operator = (definition.filters[fieldName] ?? []).find((candidate) => candidate.name === operatorName);
			if (operator === undefined) {
				issues.push(
					issue('unknown-operator', `Operator ${JSON.stringify(operatorName)} is not allowed for ${fieldName}.`, [
						'filter',
						fieldName,
						operatorName,
					]),
				);
				continue;
			}
			let decoded: unknown;
			try {
				decoded = decodeValue(
					raw,
					definition.maximumValueLength,
					operator.value === 'many' ? definition.maximumValuesPerFilter : operator.value === 'pair' ? 2 : 1,
				);
			} catch {
				issues.push(issue('invalid-value', 'Malformed or oversized typed filter value.', path));
				continue;
			}
			const effective = explicit === undefined && (operatorName === 'isNull' || operatorName === 'isNotNull')
				? undefined
				: decoded;
			const parsed = await parseOperatorValue(
				definition.fields[fieldName]!.schema,
				operator,
				effective,
				path,
				definition,
				issues,
				tagged || Array.isArray(effective),
			);
			if (parsed.accepted) {
				result.push(
					Object.freeze({
						field: fieldName,
						operator: operator.name,
						...(parsed.hasValue ? { value: parsed.value } : {}),
					}) as QueryFilter<Fields>,
				);
			}
		}
		return result;
	}
}

/**
 * Parses operator value into the validated internal model used by later phases.
 *
 * It keeps public query semantics provider-neutral so storage adapters can compile the same validated request differently.
 *
 * @internal
 */
export async function parseOperatorValue<Fields extends QueryFields>(
	schema: StandardSchemaV1,
	operator: QueryOperator,
	raw: unknown,
	path: readonly PropertyKey[],
	definition: QueryDefinition<Fields>,
	issues: QueryIssue[],
	typed = false,
): Promise<Readonly<{ readonly accepted: boolean; readonly hasValue: boolean; readonly value?: unknown }>> {
	if (operator.value === 'none') {
		if (raw !== '' && raw !== undefined && raw !== null && raw !== true && raw !== 'true') {
			issues.push(issue('invalid-value', `${operator.name} does not accept a value.`, path));
			return { accepted: false, hasValue: false };
		}
		return { accepted: true, hasValue: false };
	}
	const values = operator.value === 'one' || typed ? scalarValues(raw) : listValues(raw);
	if (values.length > definition.maximumValuesPerFilter) {
		issues.push(issue(
			'too-many-filter-values',
			`At most ${definition.maximumValuesPerFilter} values are allowed for one filter.`,
			path,
		));
		return { accepted: false, hasValue: true };
	}
	if (operator.value === 'pair' && values.length !== 2) {
		issues.push(issue('invalid-value', `${operator.name} requires exactly two values.`, path));
		return { accepted: false, hasValue: true };
	}
	if (operator.value === 'one' && values.length !== 1) {
		issues.push(issue('invalid-value', `${operator.name} requires exactly one value.`, path));
		return { accepted: false, hasValue: true };
	}
	if (operator.value === 'many' && values.length === 0) {
		issues.push(issue('invalid-value', `${operator.name} requires at least one value.`, path));
		return { accepted: false, hasValue: true };
	}
	const parsed: unknown[] = [];
	for (const value of values) {
		if (typeof value === 'string' && value.length > definition.maximumValueLength) {
			issues.push(issue(
				'value-too-long',
				`Filter values may contain at most ${definition.maximumValueLength} characters.`,
				path,
			));
			continue;
		}
		const validation = await schema['~standard'].validate(value);
		if (validation.issues) {
			for (const schemaIssue of validation.issues) {
				const issuePath = (schemaIssue.path ?? []).map((segment) =>
					typeof segment === 'object' && segment !== null && 'key' in segment ? segment.key : segment as PropertyKey
				);
				issues.push(issue('invalid-value', schemaIssue.message, [...path, ...issuePath]));
			}
		} else parsed.push(validation.value);
	}
	if (parsed.length !== values.length) return { accepted: false, hasValue: true };
	return {
		accepted: true,
		hasValue: true,
		value: operator.value === 'one' ? parsed[0] : Object.freeze(parsed),
	};
}
