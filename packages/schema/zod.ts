import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as z from 'zod';

/** Select whether JSON Schema describes a schema's accepted input or validated output. */
export type ZodJsonSchemaIoType = 'input' | 'output';

/**
 * Project a Zod Standard Schema to JSON Schema without making generic schema utilities depend on Zod semantics.
 *
 * The Standard Schema vendor identifier selects Zod without depending on Zod's private runtime fields. The function returns
 * `undefined` for other vendors so callers can compose several schema-library projectors.
 */
export function jsonSchema(schema: StandardSchemaV1, io: ZodJsonSchemaIoType = 'output'): unknown | undefined {
	if (schema['~standard'].vendor !== 'zod') return undefined;
	return z.toJSONSchema(schema as z.ZodType, { io, target: 'draft-2020-12' });
}
