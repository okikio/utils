import * as recordCore from '@okikio/record';
import type {
	QueryAdapterCapabilities,
	QueryAdapterIssue,
	QueryAdapterValidationResult,
	QueryDefinition,
	QueryDocument,
	QueryFields,
	QueryOperatorName,
	QueryRequirements,
} from './types.ts';

import { enabledPaginationModes, paginationDefinitions, paginationWireExamples } from './pagination.ts';
import { wireOperator } from './values.ts';

/** Create JSON-safe documentation for a query definition. */
export function document<Fields extends QueryFields>(definition: QueryDefinition<Fields>): QueryDocument {
	return Object.freeze({
		...(definition.description !== undefined ? { description: definition.description } : {}),
		fields: Object.freeze(
			Object.entries(definition.fields).map(([name, value]) =>
				Object.freeze({
					name,
					...(value.description !== undefined ? { description: value.description } : {}),
					selectable: value.selectable,
					sortable: value.sortable,
					operators: Object.freeze((definition.filters[name] ?? []).map((operator) => operator.name)),
				})
			),
		),
		fieldsets: definition.fieldsets,
		defaultOrder: definition.order,
		pagination: definition.pagination,
		maximumFilters: definition.maximumFilters,
		maximumSorts: definition.maximumSorts,
		maximumSelectedFields: definition.maximumSelectedFields,
		maximumValuesPerFilter: definition.maximumValuesPerFilter,
		maximumValueLength: definition.maximumValueLength,
		maximumParameters: definition.maximumParameters,
		maximumDepth: definition.maximumDepth,
		maximumSiblings: definition.maximumSiblings,
		expressions: definition.expressions,
		defaultFields: definition.defaultFields,
		wire: Object.freeze({
			filter: 'filter[field]=value / filter[field][operator]=value',
			expression:
				'filter[$all][index][field][operator]=value / filter[$any][index][field][operator]=value / filter[$not][field][operator]=value',
			value: 'raw scalar or comma list / ~json: typed scalar or list',
			sort: 'sort=field:direction,field:direction',
			fields: 'fields=a,b / fields[resource]=a,b',
			pagination: Object.freeze(paginationWireExamples(definition.pagination)),
		}),
	});
}

/** Describe provider capabilities required to execute a query definition faithfully. */
export function requirements<Fields extends QueryFields>(definition: QueryDefinition<Fields>): QueryRequirements {
	const operators = new Set<QueryOperatorName>();
	for (const values of Object.values(definition.filters)) {
		for (const operator of values ?? []) operators.add(operator.name);
	}
	const stable = definition.order.find((entry) => entry.tiebreaker)?.field;
	// The adapter executes the complete order, including an appended stable field.
	// Count distinct eligible fields so a one-field query does not require capacity
	// for a second sort that no valid request could produce.
	const sortable = new Set([
		...Object.entries(definition.fields).filter(([, field]) => field.sortable).map(([name]) => name),
		...definition.order.map((entry) => entry.field),
	]);
	if (stable !== undefined) sortable.delete(stable);
	return Object.freeze({
		operators: Object.freeze([...operators]),
		expressions: definition.expressions,
		pagination: Object.freeze(enabledPaginationModes(definition.pagination)),
		fieldSelection: Object.freeze([
			'simple' as const,
			...(Object.keys(definition.fieldsets).length > 0 ? ['resource' as const] : []),
		]),
		maximumSorts: Math.max(
			definition.order.length,
			Math.min(definition.maximumSorts, sortable.size) + (stable === undefined ? 0 : 1),
		),
		...(stable !== undefined ? { stableTiebreaker: stable } : {}),
	});
}

/** Fail clearly when a provider adapter cannot honor a query definition. */
export function validateAdapter<Fields extends QueryFields>(
	definition: QueryDefinition<Fields>,
	capabilities: QueryAdapterCapabilities,
): QueryAdapterValidationResult {
	const required = requirements(definition);
	const issues: QueryAdapterIssue[] = [];
	const supportedExpressions = new Set(capabilities.expressions ?? ['all']);
	for (const kind of required.expressions) {
		if (!supportedExpressions.has(kind)) {
			issues.push(
				Object.freeze({ code: 'unsupported-expression', message: `Adapter does not support ${kind} expressions.` }),
			);
		}
	}
	if (capabilities.operators !== 'all') {
		const supported = new Set(capabilities.operators);
		for (const operator of required.operators) {
			if (!supported.has(operator)) {
				issues.push(Object.freeze({
					code: 'unsupported-operator',
					message: `Adapter does not support query operator ${operator}.`,
				}));
			}
		}
	}
	const paginationModes = new Set(capabilities.pagination);
	for (const mode of required.pagination) {
		if (!paginationModes.has(mode)) {
			issues.push(Object.freeze({
				code: 'unsupported-pagination',
				message: `Adapter does not support ${mode} pagination.`,
			}));
		}
	}
	const selections = new Set(capabilities.fieldSelection);
	for (const mode of required.fieldSelection) {
		if (!selections.has(mode)) {
			issues.push(Object.freeze({
				code: 'unsupported-field-selection',
				message: `Adapter does not support ${mode} field selection.`,
			}));
		}
	}
	if (capabilities.maximumSorts !== undefined && capabilities.maximumSorts < required.maximumSorts) {
		issues.push(Object.freeze({
			code: 'sort-limit',
			message:
				`Adapter supports at most ${capabilities.maximumSorts} sorts but the query permits ${required.maximumSorts}.`,
		}));
	}
	return issues.length === 0
		? Object.freeze({ valid: true, requirements: required })
		: Object.freeze({ valid: false, requirements: required, issues: Object.freeze(issues) });
}

/**
 * Builds the json schema used to validate data entering provider-neutral query definitions.
 *
 * Query internals validate and normalize public query semantics while leaving SQL or provider execution to concrete adapters.
 *
 * @internal
 */
export function jsonSchema<Fields extends QueryFields>(
	definition: QueryDefinition<Fields>,
): Readonly<Record<string, unknown>> {
	const properties: Record<string, unknown> = Object.create(null);
	const patternProperties: Record<string, unknown> = Object.create(null);
	const tagged = Object.freeze({ type: 'string', pattern: '^~json:' });
	const wrappers = definition.expressions.map((kind) =>
		kind === 'not' ? '\\[\\$not\\]' : `\\[\\$${kind}\\]\\[(?:0|[1-9]\\d*)\\]`
	).join('|');
	const grouped = definition.maximumDepth < 2 ? undefined : `^filter(?:${wrappers}){1,${definition.maximumDepth - 1}}`;
	function parameter(name: string, value: unknown): void {
		properties[`filter${name}`] = value;
		if (grouped !== undefined) patternProperties[`${grouped}${escapePattern(name)}$`] = value;
	}
	for (const [fieldName, operators] of Object.entries(definition.filters)) {
		const fieldDefinition = definition.fields[fieldName]!;
		const fieldSchema = recordCore.is(fieldDefinition.jsonSchema) ? fieldDefinition.jsonSchema : Object.freeze({});
		const typedFieldSchema = Object.freeze({ anyOf: Object.freeze([fieldSchema, tagged]) });
		const implicit = (operators ?? []).filter((operator) =>
			operator.name === 'eq' || operator.name === 'isNull' || operator.name === 'isNotNull'
		);
		if (implicit.length > 0) {
			const acceptsValue = implicit.some((operator) => operator.name === 'eq');
			const keywords = [
				...(implicit.some((operator) => operator.name === 'isNull') ? ['null'] : []),
				...(implicit.some((operator) => operator.name === 'isNotNull') ? ['not_null'] : []),
			];
			let schema: Readonly<Record<string, unknown>>;
			if (acceptsValue && keywords.length > 0) {
				schema = Object.freeze({
					anyOf: Object.freeze([fieldSchema, tagged, Object.freeze({ type: 'string', enum: Object.freeze(keywords) })]),
				});
			} else if (acceptsValue) schema = typedFieldSchema;
			else schema = Object.freeze({ type: 'string', enum: Object.freeze(keywords) });
			parameter(
				`[${fieldName}]`,
				Object.freeze({
					...schema,
					description: `Filter ${fieldName} by equality${keywords.length > 0 ? ` or ${keywords.join('/')}` : ''}.`,
				}),
			);
		}
		for (const operator of operators ?? []) {
			let description = operator.description;
			if (operator.value === 'pair') {
				description = `${operator.description} Supply two comma-separated values or a typed list.`;
			} else if (operator.value === 'many') {
				description =
					`${operator.description} Supply a comma-separated or typed list. Repeated parameters remain separate conditions.`;
			}
			parameter(
				`[${fieldName}][${wireOperator(operator.name)}]`,
				Object.freeze({
					...(operator.value === 'one' ? typedFieldSchema : { type: 'string' }),
					description,
				}),
			);
		}
	}
	if (Object.values(definition.fields).some((field) => field.sortable)) {
		properties.sort = Object.freeze({
			type: 'string',
			description:
				'Comma-separated field:asc or field:desc entries. A unique stable tiebreaker is appended when omitted.',
			example: definition.order.map((entry) => `${entry.field}:${entry.direction}`).join(','),
		});
	}
	if (Object.values(definition.fields).some((field) => field.selectable)) {
		properties.fields = Object.freeze({
			type: 'string',
			description: 'Comma-separated selected fields for the primary resource.',
			example: definition.defaultFields.join(','),
		});
	}
	for (const [resource, fieldset] of Object.entries(definition.fieldsets)) {
		properties[`fields[${resource}]`] = Object.freeze({
			type: 'string',
			description: fieldset.description ?? `Comma-separated fields for ${resource}.`,
			example: fieldset.fields.join(','),
		});
	}
	const modes = paginationDefinitions(definition.pagination);
	if (modes.cursor !== undefined) {
		properties[modes.cursor.parameters.cursor] = Object.freeze({
			type: 'string',
			minLength: 1,
			description: 'Opaque cursor returned by a previous response.',
		});
		properties[modes.cursor.parameters.limit] = integerParameter(
			modes.cursor.minimumLimit,
			modes.cursor.maximumLimit,
			'Maximum number of records returned.',
		);
	}
	if (modes.offset !== undefined) {
		properties[modes.offset.parameters.offset] = Object.freeze({
			type: 'integer',
			minimum: 0,
			maximum: modes.offset.maximumOffset,
			description: 'Number of records to skip. Do not combine with page/per_page.',
		});
		properties[modes.offset.parameters.limit] ??= integerParameter(
			modes.offset.minimumLimit,
			modes.offset.maximumLimit,
			'Maximum number of records returned with offset pagination.',
		);
		properties[modes.offset.parameters.page] = Object.freeze({
			type: 'integer',
			minimum: 1,
			description: 'One-indexed page number. Do not combine with cursor or offset.',
		});
		properties[modes.offset.parameters.perPage] = integerParameter(
			modes.offset.minimumLimit,
			modes.offset.maximumLimit,
			'Number of records per page.',
		);
	}
	return Object.freeze({
		type: 'object',
		additionalProperties: true,
		properties: Object.freeze(properties),
		patternProperties: Object.freeze(patternProperties),
		'x-query': Object.freeze({
			expressions: definition.expressions,
			maximumDepth: definition.maximumDepth,
			maximumSiblings: definition.maximumSiblings,
			maximumFilters: definition.maximumFilters,
			maximumValuesPerFilter: definition.maximumValuesPerFilter,
			maximumValueLength: definition.maximumValueLength,
			maximumParameters: definition.maximumParameters,
			valueCodec: '~json:',
		}),
	});
}

/**
 * Creates the integer query-parameter contract used by pagination and other numeric query fields.
 *
 * @internal
 */
export function integerParameter(
	minimum: number,
	maximum: number,
	description: string,
): Readonly<Record<string, unknown>> {
	return Object.freeze({ type: 'integer', minimum, maximum, description });
}

/** Escape public field/operator text when documenting bracket expression paths. */
function escapePattern(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
