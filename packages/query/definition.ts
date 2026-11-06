import type {
	QueryAdapterCapabilities,
	QueryAllowedOperator,
	QueryCondition,
	QueryDefinition,
	QueryDefinitionInput,
	QueryFieldInput,
	QueryFields,
	QueryFilters,
	QueryOperandArguments,
	QueryValue,
} from './types.ts';
import { freezeFields, freezeFieldsets, freezeFilters, validateSelectedFields } from './fields.ts';
import { validateOrder } from './sort.ts';

import { document, inputSchema, outputSchema, requirements, validateAdapter, wireSchema } from './description.ts';
import { assertPositiveInteger, QueryValidationError } from './validation.ts';
import { safeParse } from './parse.ts';
import { encode, stringify } from './url.ts';
import { inspect, normalize } from './normalize.ts';
import { safeCreate } from './authoring.ts';

/**
 * Declare allowed fields, comparisons, sorts, page modes, and input budgets.
 * The result parses HTTP parameters and creates the same checked QueryValue
 * from typed expressions. Definitions own no data source or live resource.
 * Field schemas may validate asynchronously and transform input operands.
 *
 * @example Share one allowed search between links and programmatic callers
 * ```ts
 * import { define, field, offset } from '@okikio/query/definition';
 * import { eq } from '@okikio/query/operators';
 * import * as schema from '@okikio/schema';
 * const Search = define({
 *   fields: { name: field(schema.string()) },
 *   filters: { name: [eq] },
 *   pagination: offset(),
 * });
 * const value = await Search.create({ filter: Search.condition('name', 'eq', 'Ada') });
 * const same = await Search.parse(Search.encode(value));
 * ```
 */
export function define<
	const Fields extends QueryFields,
	const Filters extends QueryFilters<Fields> = QueryFilters<Fields> & Readonly<Record<string, never>>,
>(
	input: QueryDefinitionInput<Fields, Filters>,
): QueryDefinition<Fields, Filters> {
	const fields = freezeFields(input.fields);
	const filters = freezeFilters((input.filters ?? {}) as QueryFilters<Fields>, fields);
	const defaultOrder = Object.freeze([...(input.order ?? [])]);
	validateOrder(defaultOrder, fields, input.pagination);
	const defaultFields = Object.freeze(
		input.defaultFields ? [...input.defaultFields] : Object.keys(fields).filter((key) => fields[key]!.selectable),
	) as readonly (keyof Fields & string)[];
	validateSelectedFields(defaultFields, fields);
	const fieldsets = freezeFieldsets(input.fieldsets ?? {});
	const maximumFilters = input.maximumFilters ?? 20;
	const maximumSorts = input.maximumSorts ?? 5;
	const maximumSelectedFields = input.maximumSelectedFields ?? 100;
	const maximumValuesPerFilter = input.maximumValuesPerFilter ?? 100;
	const maximumValueLength = input.maximumValueLength ?? 4_096;
	const maximumParameters = input.maximumParameters ?? 200;
	const maximumDepth = input.maximumDepth ?? 8;
	const maximumSiblings = input.maximumSiblings ?? 100;
	const expressions = Object.freeze([...new Set(input.expressions ?? ['all'] as const)]);
	if (!expressions.includes('all') || expressions.some((kind) => kind !== 'all' && kind !== 'any' && kind !== 'not')) {
		throw new TypeError('Query expressions must include all and may only include all, any, and not.');
	}
	for (
		const [name, value] of Object.entries({
			maximumFilters,
			maximumSorts,
			maximumSelectedFields,
			maximumValuesPerFilter,
			maximumValueLength,
			maximumParameters,
			maximumDepth,
			maximumSiblings,
		})
	) assertPositiveInteger(value, name);

	const definition: QueryDefinition<Fields, Filters> = {
		kind: 'query-definition',
		fields,
		filters: filters as Filters,
		expressions,
		order: defaultOrder,
		pagination: input.pagination,
		fieldsets,
		maximumFilters,
		maximumSorts,
		maximumSelectedFields,
		maximumValuesPerFilter,
		maximumValueLength,
		maximumParameters,
		maximumDepth,
		maximumSiblings,
		defaultFields,
		...(input.description !== undefined ? { description: input.description } : {}),
		'~standard': {
			version: 1,
			vendor: 'utils-query',
			jsonSchema: {
				input: (options) => {
					assertTarget(options.target);
					return inputSchema(definition);
				},
				output: (options) => {
					assertTarget(options.target);
					return outputSchema(definition, options.target);
				},
			},
			validate: async (value: unknown) => {
				const result = await safeParse(definition, value);
				return result.success ? { value: result.value } : { issues: result.issues };
			},
		},
		wireSchema: () => wireSchema(definition),
		parse: async (value: unknown) => {
			const result = await safeParse(definition, value);
			if (result.success) return result.value;
			throw new QueryValidationError(result.issues);
		},
		safeParse: (value: unknown) => safeParse(definition, value),
		condition<Field extends keyof Fields & string, Operator extends QueryAllowedOperator<Filters, Field>>(
			field: Field,
			operator: Operator,
			...values: QueryOperandArguments<QueryFieldInput<Fields[Field]>, Operator>
		): QueryCondition<Field, QueryFieldInput<Fields[Field]>, Operator> {
			const allowed = filters[field]?.find((candidate) => candidate.name === operator);
			if (allowed === undefined) throw new TypeError('The condition field or operator is not enabled by this query.');
			const count = allowed.value === 'none' ? 0 : 1;
			if (values.length !== count) throw new TypeError(`The ${operator} condition expects ${count} operand argument.`);
			// The generic conditional return is selected by the same operator that
			// controls the arguments. Runtime field validation belongs to create().
			return { field, operator, ...(values.length === 0 ? {} : { value: values[0] }) } as QueryCondition<
				Field,
				QueryFieldInput<Fields[Field]>,
				Operator
			>;
		},
		create: async (value = {}) => {
			const result = await safeCreate(definition, value);
			if (result.success) return result.value;
			throw new QueryValidationError(result.issues);
		},
		safeCreate: (value = {}) => safeCreate(definition, value),
		encode: (value: QueryValue<Fields>) => encode(definition, value),
		normalize: (value: QueryValue<Fields>) => normalize(value),
		stringify: (value: QueryValue<Fields>) => stringify(definition, value),
		inspect: (value: QueryValue<Fields>) => inspect(value),
		document: () => document(definition),
		requirements: () => requirements(definition),
		validateAdapter: (capabilities: QueryAdapterCapabilities) => validateAdapter(definition, capabilities),
	};
	return Object.freeze(definition);
}

/** Return whether a value is a collection-query definition. */
export function is(value: unknown): value is QueryDefinition<QueryFields> {
	return typeof value === 'object' && value !== null &&
		(value as { readonly kind?: unknown }).kind === 'query-definition';
}

// These declarations compose a complete search contract without the root facade.
export { field } from './fields.ts';
export { asc, desc } from './sort.ts';
export { cursor, offset, pagination, paginationParameters } from './pagination.ts';
export { document, requirements, validateAdapter } from './description.ts';
export { QueryValidationError } from './validation.ts';

/** Reject unsupported projection targets instead of returning another draft silently. */
function assertTarget(target: string): asserts target is 'draft-2020-12' | 'draft-07' {
	if (target !== 'draft-2020-12' && target !== 'draft-07') {
		throw new TypeError(`Unsupported query JSON Schema target ${JSON.stringify(target)}.`);
	}
}
