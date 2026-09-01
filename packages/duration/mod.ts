/**
 * Deterministic Temporal duration conversion for shared runtime mechanics.
 *
 * Calendar-bearing Temporal durations need a relative date before they can be
 * converted to milliseconds or compared. This utility owns that otherwise
 * repeated anchor choice. Callers still own domain-specific validity, bounds,
 * timer clamping, and error wording.
 *
 * @module
 */
import type { DurationInput } from './types.ts';

/**
 * Fixed calendar anchor used when a duration contains calendar units.
 *
 * Keeping the anchor private prevents callers from coupling business meaning to
 * an implementation detail. It also preserves the deterministic conversion
 * semantics historically used by the surrounding utilities.
 */
const relativeTo = Temporal.PlainDate.from('2000-01-01');

/** Convert one Temporal duration input to deterministic milliseconds. */
export function milliseconds(value: DurationInput): number {
	return Temporal.Duration.from(value).total({ unit: 'milliseconds', relativeTo });
}

/** Compare two Temporal duration inputs using the same deterministic calendar anchor. */
export function compare(left: DurationInput, right: DurationInput): number {
	return Temporal.Duration.compare(Temporal.Duration.from(left), Temporal.Duration.from(right), { relativeTo });
}

export type * from './types.ts';
