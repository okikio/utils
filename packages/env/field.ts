/** Adapter-independent environment field normalization. @module */
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { defineEnvironmentField } from './definition.ts';
import { resolveMetadata } from './metadata.ts';
import type { EnvironmentField, EnvironmentFieldMetadata, EnvironmentFieldMetadataInput } from './types.ts';

/** Keep explicit secret examples invalid and remove examples inherited from a reusable schema. */
export function metadata(
	kind: 'variable' | 'secret',
	native: Readonly<Record<string, unknown>> | undefined,
	explicit?: EnvironmentFieldMetadataInput,
	key?: string,
): EnvironmentFieldMetadata {
	if (kind === 'secret' && explicit?.example !== undefined) {
		throw new TypeError('Secret environment fields cannot include example values.');
	}
	const resolved = resolveMetadata(native, explicit, key);
	if (kind === 'variable' || resolved.example === undefined) return resolved;
	const { example: _example, ...safe } = resolved;
	return safe;
}

/** Reuse an authored field or memoize a bare variable within its adapter's own identity map. */
export function normalize<Schema extends StandardSchemaV1>(
	input: Schema | EnvironmentField<Schema>,
	key: string,
	variables: WeakMap<object, EnvironmentField<Schema, 'variable'>>,
	native: (schema: Schema) => Readonly<Record<string, unknown>> | undefined,
): EnvironmentField<Schema> {
	if (
		'kind' in input && (input.kind === 'variable' || input.kind === 'secret') && 'schema' in input &&
		'metadata' in input
	) {
		return input as EnvironmentField<Schema>;
	}
	const schema = input as Schema;
	const existing = variables.get(schema);
	if (existing) return existing;
	const field = defineEnvironmentField('variable', schema, metadata('variable', native(schema), undefined, key));
	variables.set(schema, field);
	return field;
}
