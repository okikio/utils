/** Probe representation capability without running input validators. @module */
import type { StandardJSONSchemaV1, StandardTypedV1 } from '@standard-schema/spec';
import { jsonSchema } from './validation.ts';

/** A converter's current response, not a guarantee about validation or round-trip fidelity. */
export type ProjectionType =
	| Readonly<{ readonly supported: true; readonly schema: Readonly<Record<string, unknown>> }>
	| Readonly<{ readonly supported: false; readonly reason: 'unavailable' | 'rejected' }>;

/** Independent input/output projection results for one explicit JSON Schema target. */
export interface SchemaInspectionType {
	/** Wire/input projection before any transform callback. */
	readonly input: ProjectionType;
	/** Validated/output projection, which opaque transformations often cannot supply. */
	readonly output: ProjectionType;
}

/**
 * Ask only declared converters for each projection. No parse/validate callback
 * runs. Converter callbacks are trusted code and can run; any converter rejection
 * becomes a redacted unsupported result, including thrown undefined. No raw
 * exception or payload enters this diagnostic. Successful documents are fresh
 * converter-owned results, not deep-frozen copies. This is inspection, not a
 * replacement for invoking jsonSchema() when the exact conversion failure matters.
 */
export function inspect(
	definition: StandardTypedV1,
	options: StandardJSONSchemaV1.Options = { target: 'draft-2020-12' },
): SchemaInspectionType {
	const converters = (definition['~standard'] as Partial<StandardJSONSchemaV1.Props>).jsonSchema;
	const project = (direction: 'input' | 'output'): ProjectionType => {
		if (typeof converters?.[direction] !== 'function') {
			return Object.freeze({ supported: false, reason: 'unavailable' });
		}
		try {
			return Object.freeze({ supported: true, schema: jsonSchema(definition, direction, options) });
		} catch {
			return Object.freeze({ supported: false, reason: 'rejected' });
		}
	};
	return Object.freeze({ input: project('input'), output: project('output') });
}
