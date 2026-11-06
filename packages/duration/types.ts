/** Input accepted by Temporal duration conversion helpers. */
export type DurationInput = Temporal.DurationLike;

/** Temporal's singular and plural unit names, from years through nanoseconds. */
export type Unit = Temporal.DurationTotalOptions['unit'];

/** Clock units whose integer counts can be represented exactly as bigint nanoseconds. */
export type ClockUnit = Exclude<Unit, 'year' | 'years' | 'month' | 'months' | 'week' | 'weeks' | 'day' | 'days'>;

/** Units with a fixed elapsed size: a week is seven days and a day is 24 hours. */
export type ElapsedUnit = Exclude<Unit, 'year' | 'years' | 'month' | 'months'>;

/** Explicit calendar reference used for calendar-unit or daylight-saving arithmetic. */
export interface ConversionOptions {
	/** A date uses 24-hour days; a zoned date-time follows that zone's transitions. Temporal date records are accepted. */
	readonly relativeTo?: Temporal.DurationRelativeToOptions['relativeTo'];
}

/**
 * Temporal rounding options, including unit sizes, increment, rounding mode and calendar reference.
 * At least one of `smallestUnit` or `largestUnit` must be supplied. Calendar
 * units require `relativeTo`; no arbitrary date is supplied by round().
 */
export type RoundOptions = Temporal.DurationRoundingOptions;
