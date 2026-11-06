/** Owned validation, inference and Standard JSON Schema projection for meter values. @module */
import * as schema from '@okikio/schema';
import { temporal } from '@okikio/duration/temporal';

/**
 * A reading keeps its original RFC 3339 spelling and fractional precision.
 * The lexical profile requires seconds and an explicit offset. Temporal checks
 * the calendar and time without Date's rollover of impossible days or hour 24.
 * Leap-second spellings remain unsupported, matching the epoch-time contract.
 */
const TimestampSchema: schema.JsonReader<string, string> = schema.refine(
	schema.string({
		pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u,
	}),
	(value) => {
		// RFC 3339 permits more than Temporal's nine fractional digits. The
		// fraction is already lexical text; omit it only for calendar validity.
		const offset = value.endsWith('Z') ? 'Z' : value.slice(-6);
		try {
			temporal.Instant.from(value.slice(0, 19) + offset);
			return true;
		} catch {
			return false;
		}
	},
	'Meter timestamp must be an RFC 3339 date-time with an offset.',
);

/** One contract supplies runtime validation, TypeScript inference and portable JSON Schema. */
export const MeterReadingSchema: schema.ObjectReader<
	{
		readonly value: schema.JsonReader<number, number>;
		readonly at: schema.JsonReader<string, string>;
		readonly attributes: schema.JsonReader<
			Partial<Record<string, string | number | boolean>> | undefined,
			Partial<Record<string, string | number | boolean>> | undefined
		>;
	},
	'reject'
> = schema.object({
	value: schema.number(),
	/** Observation instant with an explicit offset; original fractional text remains unchanged. */
	at: TimestampSchema,
	attributes: schema.optional(schema.record(
		schema.string(),
		schema.union([
			schema.string(),
			schema.number(),
			schema.boolean(),
		]),
	)),
});

/** Application value accepted for a measured effect. */
export type MeterReadingType = schema.Output<typeof MeterReadingSchema>;
