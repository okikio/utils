import * as schema from '@okikio/schema';
import type {
	QueryAdapterCapabilities,
	QueryAdapterIssue,
	QueryAdapterValidationResult,
	QueryDocument,
	QueryField,
	QueryFields,
	QueryOperatorName,
	QueryPolicy,
	QueryRequirements,
} from './types.ts';

import { enabledPaginationModes, paginationDefinitions, paginationWireExamples } from './pagination.ts';
import { wireOperator } from './values.ts';

/** Create JSON-safe documentation for a query definition. */
export function document<Fields extends QueryFields>(definition: QueryPolicy<Fields>): QueryDocument {
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
export function requirements<Fields extends QueryFields>(definition: QueryPolicy<Fields>): QueryRequirements {
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
	definition: QueryPolicy<Fields>,
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
 * Describe the HTTP parameter vocabulary for documentation tools.
 *
 * Encoded operands are decoded before field validation, and repeated keys and
 * nested input containers have separate parser rules. This document explains
 * those forms and their budgets; compiling it cannot replace Query parsing.
 *
 * @internal
 */
export function wireSchema<Fields extends QueryFields>(
	definition: QueryPolicy<Fields>,
	target: 'draft-2020-12' | 'draft-07' = 'draft-2020-12',
): Readonly<Record<string, unknown>> {
	const properties: Record<string, unknown> = Object.create(null);
	const patternProperties: Record<string, unknown> = Object.create(null);
	const tagged = Object.freeze({ type: 'string', pattern: '^~json:' });
	const wrappers = definition.expressions.map((kind) =>
		kind === 'not' ? '\\[\\$not\\]' : `\\[\\$${kind}\\]\\[(?:0|[1-9]\\d*)\\]`
	).join('|');
	const grouped = definition.maximumDepth < 2 ? undefined : `^filter(?:${wrappers}){1,${definition.maximumDepth - 1}}`;
	/** Describe the flat spelling and the enabled grouped spellings for the same filter operand. */
	function parameter(name: string, value: unknown): void {
		properties[`filter${name}`] = value;
		if (grouped !== undefined) patternProperties[`${grouped}${escapePattern(name)}$`] = value;
	}
	for (const [fieldName, operators] of Object.entries(definition.filters)) {
		const fieldDefinition = definition.fields[fieldName]!;
		const fieldSchema = (operators ?? []).some((operator) => operator.value === 'one')
			? fieldProjection(fieldDefinition, fieldName, 'input', target)
			: {};
		if (schemaResources(fieldSchema).linked) {
			// OpenAPI copies each parameter schema into its own location. A local
			// definition or repeated resource ID cannot retain its scope there.
			throw new TypeError(
				`Query field ${JSON.stringify(fieldName)} uses JSON Schema resource identifiers or references. ` +
					'Provide inline jsonSchema metadata for wireSchema() so each HTTP parameter can be documented independently.',
			);
		}
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
			examples: [definition.order.map((entry) => `${entry.field}:${entry.direction}`).join(',')],
		});
	}
	if (Object.values(definition.fields).some((field) => field.selectable)) {
		properties.fields = Object.freeze({
			type: 'string',
			description: 'Comma-separated selected fields for the primary resource.',
			examples: [definition.defaultFields.join(',')],
		});
	}
	for (const [resource, fieldset] of Object.entries(definition.fieldsets)) {
		properties[`fields[${resource}]`] = Object.freeze({
			type: 'string',
			description: fieldset.description ?? `Comma-separated fields for ${resource}.`,
			examples: [fieldset.fields.join(',')],
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
		description: 'HTTP parameter documentation. Validate decoded operands and request budgets with the query parser.',
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
 * Refuse an executable input projection that would erase decoding constraints.
 * A tagged payload can contain malformed JSON or a value rejected by its field
 * validator. Advertising a prefix pattern as equivalent input validation would
 * permit both. Keeping this failure at conversion leaves normal parsing usable.
 */
export function inputSchema<Fields extends QueryFields>(definition: QueryPolicy<Fields>): never {
	const field = Object.entries(definition.filters).find(([, operators]) =>
		(operators ?? []).some((operator) => operator.value !== 'none')
	)?.[0];
	const representation = field === undefined
		? 'URL parameter containers and decoded pagination values'
		: `~json: encoded operands for field ${JSON.stringify(field)}`;
	throw new TypeError(
		`Query input accepts ${representation}, which cannot be represented faithfully as JSON Schema. ` +
			'Use wireSchema() for HTTP documentation and parse() or create() for validation.',
	);
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

/**
 * Describe the parsed structural type independently of URL parameter spelling.
 *
 * The finite expression definitions retain the configured depth and immediate
 * child limits without duplicating every possible tree. Parser work budgets and
 * relations across values, such as page arithmetic and unique sort fields, still
 * belong to parse/create. Scalar outputs must be projectable or supplied by the
 * caller; JavaScript-only outputs cannot receive a guessed JSON representation.
 */
export function outputSchema<Fields extends QueryFields>(
	definition: QueryPolicy<Fields>,
	target: 'draft-2020-12' | 'draft-07' = 'draft-2020-12',
): Record<string, unknown> {
	const definitionsKey = target === 'draft-07' ? 'definitions' : '$defs';
	const reference = `#/${definitionsKey}/expression`;
	const definitions: Record<string, unknown> = Object.create(null);
	const descriptors = new Map<string, string>();
	const resources = new Map<string, string>();
	const leaves: unknown[] = [];
	for (const [name, operators] of Object.entries(definition.filters)) {
		const field = definition.fields[name]!;
		let scalar = (operators ?? []).some((operator) => operator.value !== 'none')
			? fieldProjection(field, name, 'output', target)
			: undefined;
		if (scalar !== undefined) {
			// Every operator points to one complete field document. Hoisting only
			// documents with a root ID would still duplicate nested resource IDs.
			// Reuse an identical descriptor across fields, but never let a second
			// document silently change the meaning of an existing resource ID.
			const descriptor = JSON.stringify(scalar);
			const existing = descriptors.get(descriptor);
			const key = existing ?? `field_${name}`;
			if (existing === undefined) {
				for (const id of schemaResources(scalar).identifiers) {
					const owner = resources.get(id);
					if (owner !== undefined) {
						throw new TypeError(
							`Query field ${JSON.stringify(name)} reuses JSON Schema $id or anchor ${JSON.stringify(id)} ` +
								`already declared by field ${
									JSON.stringify(owner)
								}. Supply distinct resource identifiers or the same complete field document.`,
						);
					}
					resources.set(id, name);
				}
				definitions[key] = scalar;
				descriptors.set(descriptor, key);
			}
			const id = typeof scalar === 'object' && scalar !== null ? (scalar as Record<string, unknown>).$id : undefined;
			scalar = { $ref: typeof id === 'string' ? id : `#/${definitionsKey}/${key}` };
		}
		for (const operator of operators ?? []) {
			let value: unknown;
			if (operator.value !== 'none') {
				value = operator.value === 'one' ? scalar : {
					type: 'array',
					items: scalar,
					minItems: operator.value === 'pair' ? 2 : 1,
					maxItems: operator.value === 'pair' ? 2 : definition.maximumValuesPerFilter,
				};
			}
			leaves.push({
				type: 'object',
				properties: {
					field: { const: name },
					operator: { const: operator.name },
					...(operator.value === 'none' ? {} : { value }),
				},
				required: ['field', 'operator', ...(operator.value === 'none' ? [] : ['value'])],
				additionalProperties: false,
			});
		}
	}
	definitions.condition = leaves.length === 0 ? false : { anyOf: leaves };
	for (let depth = definition.maximumDepth; depth >= 1; depth--) {
		const variants: unknown[] = [{ $ref: `#/${definitionsKey}/condition` }];
		if (depth < definition.maximumDepth) {
			const child = { $ref: `#/${definitionsKey}/expression${depth + 1}` };
			for (const kind of definition.expressions) {
				variants.push(
					kind === 'not'
						? {
							type: 'object',
							properties: { kind: { const: 'not' }, filter: child },
							required: ['kind', 'filter'],
							additionalProperties: false,
						}
						: {
							type: 'object',
							properties: {
								kind: { const: kind },
								filters: {
									type: 'array',
									items: child,
									minItems: 1,
									maxItems: Math.min(definition.maximumSiblings, definition.maximumFilters),
								},
							},
							required: ['kind', 'filters'],
							additionalProperties: false,
						},
				);
			}
		}
		definitions[depth === 1 ? 'expression' : `expression${depth}`] = { anyOf: variants };
	}
	const selectable = Object.keys(definition.fields).filter((name) => definition.fields[name]!.selectable);
	const fieldSelections: unknown[] = [
		{
			type: 'object',
			properties: {
				kind: { const: 'simple' },
				// Authored defaults can exceed a request's selection budget. Keep
				// that exact default, without widening every explicit selection.
				fields: {
					anyOf: [{ const: [...definition.defaultFields] }, selection(selectable, definition.maximumSelectedFields)],
				},
			},
			required: ['kind', 'fields'],
			additionalProperties: false,
		},
	];
	if (Object.keys(definition.fieldsets).length > 0) {
		fieldSelections.push({
			type: 'object',
			properties: {
				kind: { const: 'resource' },
				resources: {
					type: 'object',
					minProperties: 1,
					properties: Object.fromEntries(
						Object.entries(definition.fieldsets).map((
							[name, fieldset],
						) => [name, selection(fieldset.fields, definition.maximumSelectedFields)]),
					),
					additionalProperties: false,
				},
			},
			required: ['kind', 'resources'],
			additionalProperties: false,
		});
	}
	const modes = paginationDefinitions(definition.pagination);
	const pagination: unknown[] = [];
	if (modes.cursor !== undefined) {
		pagination.push({
			type: 'object',
			properties: {
				kind: { const: 'cursor' },
				limit: { type: 'integer', minimum: modes.cursor.minimumLimit, maximum: modes.cursor.maximumLimit },
				cursor: { type: 'string', minLength: 1 },
			},
			required: ['kind', 'limit'],
			additionalProperties: false,
		});
	}
	if (modes.offset !== undefined) {
		const common = {
			kind: { const: 'offset' },
			limit: { type: 'integer', minimum: modes.offset.minimumLimit, maximum: modes.offset.maximumLimit },
			offset: { type: 'integer', minimum: 0, maximum: modes.offset.maximumOffset },
		};
		pagination.push({
			type: 'object',
			properties: { ...common, source: { const: 'offset' } },
			required: ['kind', 'limit', 'offset', 'source'],
			additionalProperties: false,
		}, {
			type: 'object',
			properties: {
				...common,
				source: { const: 'page' },
				page: {
					type: 'integer',
					minimum: 1,
					maximum: Math.min(
						Number.MAX_SAFE_INTEGER,
						Math.floor(modes.offset.maximumOffset / modes.offset.minimumLimit) + 1,
					),
				},
			},
			required: ['kind', 'limit', 'offset', 'source', 'page'],
			additionalProperties: false,
		});
	}
	const sortable = [
		...new Set([
			...Object.keys(definition.fields).filter((name) => definition.fields[name]!.sortable),
			...definition.order.map((entry) => entry.field),
		]),
	];
	const stable = definition.order.find((entry) => entry.tiebreaker)?.field;
	return {
		type: 'object',
		description:
			'Parsed query structure. Query parse/create additionally enforce total work budgets, unique sort fields and pagination arithmetic.',
		properties: {
			filter: { $ref: reference },
			order: {
				type: 'array',
				maxItems: requirements(definition).maximumSorts,
				items: sortable.length === 0 ? false : {
					anyOf: sortable.map((field) => ({
						type: 'object',
						properties: {
							field: { const: field },
							direction: { enum: ['asc', 'desc'] },
							tiebreaker: { const: field === stable },
						},
						required: ['field', 'direction', 'tiebreaker'],
						additionalProperties: false,
					})),
				},
				...(stable === undefined ? {} : {
					contains: { type: 'object', properties: { field: { const: stable } }, required: ['field'] },
				}),
			},
			fields: { anyOf: fieldSelections },
			pagination: { anyOf: pagination },
		},
		required: ['order', 'fields', 'pagination'],
		additionalProperties: false,
		[definitionsKey]: definitions,
	};
}

/** Empty permission sets still have a valid empty-list representation; JSON Schema forbids an empty enum. */
function selection(names: readonly string[], maximum: number): Record<string, unknown> {
	return {
		type: 'array',
		items: names.length === 0 ? false : { enum: [...names] },
		uniqueItems: true,
		maxItems: Math.min(names.length, maximum),
	};
}

/** Preserve the field and direction when a converter cannot describe its value. */
function fieldProjection(
	field: QueryField,
	name: string,
	direction: 'input' | 'output',
	target: 'draft-07' | 'draft-2020-12',
): unknown {
	try {
		const document = (direction === 'input' ? field.jsonSchema : field.outputJsonSchema) ??
			schema.jsonSchema(field.schema, direction, { target });
		schemaResources(document);
		return document;
	} catch (cause) {
		const guidance = direction === 'input'
			? ' Provide inline jsonSchema metadata for wireSchema() so each HTTP parameter can be documented independently.'
			: '';
		throw new TypeError(
			`Query field ${JSON.stringify(name)} has no usable ${direction} JSON Schema projection.${guidance}`,
			{
				cause,
			},
		);
	}
}

/**
 * Collect resource identities while checking whether their scope survives
 * embedding. Walk schema-valued keywords only, leaving literal data containing
 * "$id" or "$ref" alone. Relative identifiers resolve against the nearest
 * absolute resource; unresolved relative references fail without rewriting.
 */
function schemaResources(value: unknown): Readonly<{ identifiers: readonly string[]; linked: boolean }> {
	const identifiers: string[] = [];
	let linked = false;
	/**
	 * Carry the nearest resource URI into nested schema documents.
	 * A nested $id changes the base for its descendants, but not for sibling documents.
	 */
	function visit(value: unknown, resource?: string): void {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
		const document = value as Record<string, unknown>;
		if (typeof document.$id === 'string') {
			linked = true;
			try {
				resource = new URL(document.$id, resource).href.replace(/#$/u, '');
			} catch (cause) {
				throw new TypeError('Relative JSON Schema resource identifiers need an absolute parent $id.', { cause });
			}
			identifiers.push(resource);
		}
		for (const key of ['$anchor', '$dynamicAnchor']) {
			if (typeof document[key] === 'string') {
				linked = true;
				identifiers.push(`${resource ?? ''}#${document[key]}`);
			}
		}
		for (const key of ['$ref', '$dynamicRef', '$recursiveRef']) {
			if (typeof document[key] !== 'string') continue;
			linked = true;
			if (resource === undefined && !absolute(document[key])) {
				throw new TypeError(
					'Relative JSON Schema references need an absolute $id before this field document can be embedded.',
				);
			}
		}
		linked ||= document.$recursiveAnchor === true;
		for (
			const key of [
				'not',
				'if',
				'then',
				'else',
				'contains',
				'additionalProperties',
				'additionalItems',
				'unevaluatedProperties',
				'unevaluatedItems',
				'propertyNames',
			]
		) visit(document[key], resource);
		for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems', 'items']) {
			const children = document[key];
			for (const child of Array.isArray(children) ? children : [children]) visit(child, resource);
		}
		for (const key of ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies']) {
			const children = document[key];
			if (typeof children === 'object' && children !== null) {
				for (const child of Object.values(children)) visit(child, resource);
			}
		}
	}
	visit(value);
	return { identifiers, linked };
}

/** URL parsing checks identifier syntax only and performs no network access. */
function absolute(value: string): boolean {
	try {
		new URL(value);
		return true;
	} catch {
		return false;
	}
}
