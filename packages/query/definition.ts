import type {
	QueryAdapterCapabilities,
	QueryDefinition,
	QueryDefinitionInput,
	QueryFields,
	QueryFilters,
	QueryValue,
} from './types.ts';
import { freezeFields, freezeFieldsets, freezeFilters, validateSelectedFields } from './fields.ts';
import { validateOrder } from './sort.ts';

import { document, jsonSchema, requirements, validateAdapter } from './description.ts';
import { assertPositiveInteger, QueryValidationError } from './validation.ts';
import { safeParse } from './parse.ts';
import { encode, stringify } from './url.ts';
import { inspect, normalize } from './normalize.ts';

/** Define one storage-neutral collection query contract. */
export function define<const Fields extends QueryFields>(
	input: QueryDefinitionInput<Fields>,
): QueryDefinition<Fields> {
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

	const definition: QueryDefinition<Fields> = {
		kind: 'query-definition',
		fields,
		filters,
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
			validate: async (value: unknown) => {
				const result = await safeParse(definition, value);
				return result.success ? { value: result.value } : { issues: result.issues };
			},
		},
		'~standard-json-schema': {
			version: 1,
			vendor: 'utils-query',
			jsonSchema: () => jsonSchema(definition),
		},
		wireSchema: () => jsonSchema(definition),
		parse: async (value: unknown) => {
			const result = await safeParse(definition, value);
			if (result.success) return result.value;
			throw new QueryValidationError(result.issues);
		},
		safeParse: (value: unknown) => safeParse(definition, value),
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

// Keep the deployed definition subpath while implementation responsibilities move.
export { field } from './fields.ts';
export { asc, desc } from './sort.ts';
export { cursor, offset, pagination, paginationParameters } from './pagination.ts';
export { document, requirements, validateAdapter } from './description.ts';
export { QueryValidationError } from './validation.ts';
