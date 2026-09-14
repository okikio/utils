import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';

/** Runtime measurement validated before it enters an effect occurrence. */
export interface MeterReadingType {
	readonly value: number;
	readonly at: string;
	readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

const meterReadingJsonSchema = Object.freeze({
	type: 'object' as const,
	required: Object.freeze(['value', 'at']),
	properties: Object.freeze({
		value: Object.freeze({ type: 'number' as const }),
		at: Object.freeze({ type: 'string' as const, format: 'date-time' }),
		attributes: Object.freeze({
			type: 'object' as const,
			additionalProperties: Object.freeze({ type: Object.freeze(['string', 'number', 'boolean']) }),
		}),
	}),
	additionalProperties: false,
});

const dateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

/**
 * Standard Schema contract for one accepted meter fact.
 *
 * The meter package only needs a small stable wire contract, so it does not
 * pull a validator implementation into production. Applications remain free to
 * use Zod, Valibot, ArkType, or any other Standard Schema implementation.
 */
export const MeterReadingSchema = Object.freeze({
	'~standard': Object.freeze({
		version: 1 as const,
		vendor: '@okikio/meter',
		validate(value: unknown): StandardSchemaV1.Result<MeterReadingType> {
			const issues = validateReading(value);
			return issues.length === 0 ? { value: value as MeterReadingType } : { issues };
		},
		jsonSchema: Object.freeze({
			input: () => meterReadingJsonSchema,
			output: () => meterReadingJsonSchema,
		}),
	}),
} satisfies StandardSchemaV1<unknown, MeterReadingType> & StandardJSONSchemaV1<unknown, MeterReadingType>);

/** Validate the complete meter value without invoking accessors on unknown records. */
function validateReading(value: unknown): StandardSchemaV1.Issue[] {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return [{ message: 'Expected a meter reading object.' }];
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record)) if (key !== 'value' && key !== 'at' && key !== 'attributes') return [{ message: `Unknown meter reading field ${key}.` }];
	const issues: StandardSchemaV1.Issue[] = [];
	if (typeof record.value !== 'number' || !Number.isFinite(record.value)) issues.push({ message: 'Meter value must be a finite number.', path: ['value'] });
	if (typeof record.at !== 'string' || !dateTimePattern.test(record.at) || Number.isNaN(Date.parse(record.at))) issues.push({ message: 'Meter timestamp must be an RFC 3339 date-time with an offset.', path: ['at'] });
	if (record.attributes !== undefined) issues.push(...validateAttributes(record.attributes));
	return issues;
}

/** Validate bounded scalar attribute values used by meter observations. */
function validateAttributes(value: unknown): StandardSchemaV1.Issue[] {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return [{ message: 'Meter attributes must be an object.', path: ['attributes'] }];
	const issues: StandardSchemaV1.Issue[] = [];
	for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
		if (typeof candidate === 'string' || typeof candidate === 'boolean') continue;
		if (typeof candidate === 'number' && Number.isFinite(candidate)) continue;
		issues.push({ message: 'Meter attribute values must be strings, finite numbers, or booleans.', path: ['attributes', key] });
	}
	return issues;
}
