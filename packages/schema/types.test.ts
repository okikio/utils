import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as schema from './mod.ts';

/** A validator whose accepted input and parsed output intentionally differ. */
declare const PortSchema: StandardSchemaV1<string, number>;

/** Compile-time consumer examples prove Standard Schema output inference remains exact. */
function schemaTypes(): void {
	const parsed: Promise<number> = schema.parse(PortSchema, '8787');
	const validated: Promise<schema.ValidationResult<number>> = schema.validate(PortSchema, '8787');
	void parsed;
	void validated;

	// parse() and validate() must expose the validator output, not its input type.
	// @ts-expect-error The parsed output is number, not string.
	const wrong: Promise<string> = schema.parse(PortSchema, '8787');
	void wrong;

	// @ts-expect-error validate() must retain number in its successful result.
	const wrongValidation: Promise<schema.ValidationResult<string>> = schema.validate(PortSchema, '8787');
	void wrongValidation;
}

void schemaTypes;
