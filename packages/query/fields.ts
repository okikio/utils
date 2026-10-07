import * as recordCore from '@okikio/record';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type {
	QueryDefinition,
	QueryField,
	QueryFieldOptions,
	QueryFields,
	QueryFieldSelection,
	QueryFieldsetDefinition,
	QueryFieldsets,
	QueryFilters,
	QueryIssue,
	QueryOperator,
	QueryOperatorName,
} from './types.ts';

import { listValues, uniqueStrings } from './values.ts';
import { issue } from './validation.ts';

const fieldsetPattern = /^fields\[([^\]]+)]$/;

const fieldNamePattern = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** Define one public query field. */
export function field<const Schema extends StandardSchemaV1>(
	schema: Schema,
	options: QueryFieldOptions = {},
): QueryField<Schema> {
	assertSchema(schema);
	return Object.freeze({
		kind: 'query-field',
		schema,
		...(options.description !== undefined ? { description: options.description } : {}),
		selectable: options.selectable ?? true,
		sortable: options.sortable ?? false,
		...(options.jsonSchema !== undefined ? { jsonSchema: options.jsonSchema } : {}),
	});
}

/**
 * Snapshots fields so later compilation cannot observe caller mutation.
 *
 * @internal
 */
export function freezeFields<Fields extends QueryFields>(fields: Fields): Fields {
	const entries = recordCore.entries(fields, 'query fields');
	if (entries.length === 0) throw new TypeError('A query definition must expose at least one field.');
	for (const [name, value] of entries) {
		assertFieldName(name);
		if (value.kind !== 'query-field') throw new TypeError(`Query field ${JSON.stringify(name)} is invalid.`);
	}
	return recordCore.snapshot(fields, 'query fields');
}

/**
 * Snapshots filters so later compilation cannot observe caller mutation.
 *
 * It keeps public query semantics provider-neutral so storage adapters can compile the same validated request differently.
 *
 * @internal
 */
export function freezeFilters<Fields extends QueryFields>(
	filters: QueryFilters<Fields>,
	fields: Fields,
): QueryFilters<Fields> {
	recordCore.assert(filters, 'query filters');
	const result: Record<string, readonly QueryOperator[]> = Object.create(null);
	for (const [fieldName, operators] of Object.entries(filters)) {
		if (!fields[fieldName]) throw new TypeError(`Filter field ${JSON.stringify(fieldName)} is not public.`);
		const seen = new Set<QueryOperatorName>();
		for (const operator of operators ?? []) {
			if (seen.has(operator.name)) throw new TypeError(`Filter ${fieldName} repeats operator ${operator.name}.`);
			seen.add(operator.name);
		}
		result[fieldName] = Object.freeze([...(operators ?? [])]);
	}
	return Object.freeze(result) as QueryFilters<Fields>;
}

/**
 * Snapshots fieldsets so later compilation cannot observe caller mutation.
 *
 * It keeps public query semantics provider-neutral so storage adapters can compile the same validated request differently.
 *
 * @internal
 */
export function freezeFieldsets(
	input: Readonly<Record<string, readonly string[] | QueryFieldsetDefinition>>,
): QueryFieldsets {
	recordCore.assert(input, 'query fieldsets');
	const result: Record<string, QueryFieldsetDefinition> = Object.create(null);
	for (const [resource, value] of Object.entries(input)) {
		assertFieldName(resource);
		const definition: QueryFieldsetDefinition = Array.isArray(value)
			? { fields: value }
			: value as QueryFieldsetDefinition;
		const fields = uniqueStrings([...definition.fields]);
		if (fields.length === 0) {
			throw new TypeError(`Fieldset ${JSON.stringify(resource)} must expose at least one field.`);
		}
		for (const fieldName of fields) assertFieldName(fieldName);
		result[resource] = Object.freeze({
			fields: Object.freeze(fields),
			...(definition.description !== undefined ? { description: definition.description } : {}),
		});
	}
	return Object.freeze(result);
}

/**
 * Checks selected fields and preserves the deterministic issues needed by callers.
 *
 * @internal
 */
export function validateSelectedFields<Fields extends QueryFields>(
	selected: readonly (keyof Fields & string)[],
	fields: Fields,
): void {
	for (const name of selected) {
		const definition = fields[name];
		if (!definition) throw new TypeError(`Default selected field ${JSON.stringify(name)} is not public.`);
		if (!definition.selectable) {
			throw new TypeError(`Default selected field ${JSON.stringify(name)} is not selectable.`);
		}
	}
}

/**
 * Rejects invalid field name before it can enter authoritative module state.
 *
 * @internal
 */
export function assertFieldName(value: string): void {
	if (!fieldNamePattern.test(value)) throw new TypeError(`Invalid query field ${JSON.stringify(value)}.`);
}

/**
 * Rejects invalid schema before it can enter authoritative module state.
 *
 * @internal
 */
export function assertSchema(value: unknown): asserts value is StandardSchemaV1 {
	if (
		typeof value !== 'object' || value === null ||
		typeof (value as { ['~standard']?: { validate?: unknown } })['~standard']?.validate !== 'function'
	) {
		throw new TypeError('Query fields must use Standard Schema-compatible validators.');
	}
}

/**
 * Parses fields into the validated internal model used by later phases.
 *
 * It keeps public query semantics provider-neutral so storage adapters can compile the same validated request differently.
 *
 * @internal
 */
export function parseFields<Fields extends QueryFields>(
	definition: QueryDefinition<Fields>,
	entries: ReadonlyMap<string, readonly unknown[]>,
	issues: QueryIssue[],
): QueryFieldSelection<keyof Fields & string> {
	const simpleRaw = [...(entries.get('fields') ?? [])];
	const resourceRaw = new Map<string, unknown[]>();
	for (const [key, values] of entries) {
		const match = fieldsetPattern.exec(key);
		if (!match) continue;
		resourceRaw.set(match[1]!, [...(resourceRaw.get(match[1]!) ?? []), ...values]);
	}
	if (simpleRaw.length > 0 && resourceRaw.size > 0) {
		issues.push(issue(
			'field-selection-conflict',
			'Use either fields=a,b or fields[resource]=a,b in one request, not both.',
			['fields'],
		));
	}
	if (resourceRaw.size > 0) {
		const resources: Record<string, readonly string[]> = Object.create(null);
		let selectedCount = 0;
		for (const [resource, raw] of resourceRaw) {
			const fieldset = definition.fieldsets[resource];
			if (!fieldset) {
				issues.push(
					issue('unknown-fieldset', `Unknown fieldset resource ${JSON.stringify(resource)}.`, ['fields', resource]),
				);
				continue;
			}
			const selected = uniqueStrings(raw.flatMap(listValues).map(String).filter(Boolean));
			selectedCount += selected.length;
			const allowed = new Set(fieldset.fields);
			for (const name of selected) {
				if (!allowed.has(name)) {
					issues.push(issue(
						'unknown-field',
						`Unknown field ${JSON.stringify(name)} for resource ${JSON.stringify(resource)}.`,
						['fields', resource],
					));
				}
			}
			resources[resource] = Object.freeze(selected);
		}
		if (selectedCount > definition.maximumSelectedFields) {
			issues.push(issue(
				'too-many-selected-fields',
				`At most ${definition.maximumSelectedFields} selected fields are allowed.`,
				['fields'],
			));
		}
		return Object.freeze({ kind: 'resource', resources: Object.freeze(resources) });
	}

	if (simpleRaw.length === 0) return Object.freeze({ kind: 'simple', fields: definition.defaultFields });
	const result: (keyof Fields & string)[] = [];
	for (const name of uniqueStrings(simpleRaw.flatMap(listValues).map(String).filter(Boolean))) {
		const fieldDefinition = definition.fields[name];
		if (!fieldDefinition) {
			issues.push(issue('unknown-field', `Unknown selected field ${JSON.stringify(name)}.`, ['fields']));
			continue;
		}
		if (!fieldDefinition.selectable) {
			issues.push(issue('selection-disabled', `Field ${JSON.stringify(name)} cannot be selected.`, ['fields']));
			continue;
		}
		result.push(name);
	}
	if (result.length > definition.maximumSelectedFields) {
		issues.push(issue(
			'too-many-selected-fields',
			`At most ${definition.maximumSelectedFields} selected fields are allowed.`,
			['fields'],
		));
	}
	return Object.freeze({ kind: 'simple', fields: Object.freeze(result) });
}
