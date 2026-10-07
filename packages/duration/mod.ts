/**
 * Convert human-readable Temporal durations to one deterministic numeric value. A month needs a calendar anchor; repeating that decision across queues, retries and timeouts produces inconsistent answers.
 *
 * Use milliseconds() for shared conversion and compare() for shared ordering. Calendar units use 2000-01-01, so this is deterministic mechanics rather than a business calendar. A timer may still reject years and months; a lease may require positive time. On hosts without Temporal, import the explicit polyfill first. Use the temporal ponyfill export when your own application wants a local Temporal value without changing globals.
 *
 * @example
 * ```ts
 * import '@okikio/duration/polyfill';
 * import '@okikio/dispose/polyfill';
 * import * as duration from '@okikio/duration';
 * console.log(duration.milliseconds('PT2.5S'));
 * console.log(duration.compare({ months: 1 }, { days: 31 }));
 * ```
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
