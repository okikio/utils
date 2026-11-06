/** Server delay advice is data; this module never sleeps, retries, clones or consumes a request body. @module */
import { date } from './_date.ts';
/** Missing, invalid and usable advice remain distinguishable. All delay units are milliseconds. */
export type RetryPlanType =
	| Readonly<{ readonly kind: 'missing' | 'invalid' }>
	| Readonly<
		{
			readonly kind: 'delay';
			readonly milliseconds: number;
			readonly capped: boolean;
			readonly source: 'seconds' | 'date';
		}
	>;
/**
 * Parse RFC 9110 Retry-After with a caller-owned clock and finite delay/header budgets.
 * Past dates mean zero delay. Huge decimal integers cap without overflowing or allocating BigInts.
 * The caller owns idempotency, body replay, deadline and actual retry execution.
 */
export function planRetryAfter(
	value: string | null | undefined,
	options: Readonly<{
		/** Epoch milliseconds when the response was received; no ambient clock is read. */
		readonly now: number;
		/** Largest accepted delay in whole milliseconds. */
		readonly maximumDelay: number;
		/** Maximum accepted header UTF-16 code units, checked before trimming or parsing. */
		readonly maximumCodeUnits: number;
	}>,
): RetryPlanType {
	if (
		!Number.isSafeInteger(options.now) || Math.abs(options.now) > 8_640_000_000_000_000 ||
		!Number.isSafeInteger(options.maximumDelay) || options.maximumDelay < 0 ||
		!Number.isSafeInteger(options.maximumCodeUnits) || options.maximumCodeUnits < 1
	) throw new RangeError('Invalid Retry-After clock or budgets.');
	if (value == null) return Object.freeze({ kind: 'missing' });
	if (value.length > options.maximumCodeUnits) return Object.freeze({ kind: 'invalid' });
	const field = value.replace(/^[ \t]+|[ \t]+$/g, '');
	if (/^\d+$/.test(field)) {
		const milliseconds = Number(field) * 1000;
		return Object.freeze({
			kind: 'delay',
			source: 'seconds',
			capped: milliseconds > options.maximumDelay,
			milliseconds: Math.min(milliseconds, options.maximumDelay),
		});
	}
	const parsed = date(field, options.now);
	if (parsed === undefined) return Object.freeze({ kind: 'invalid' });
	const milliseconds = Math.max(0, parsed - options.now);
	return Object.freeze({
		kind: 'delay',
		source: 'date',
		capped: milliseconds > options.maximumDelay,
		milliseconds: Math.min(milliseconds, options.maximumDelay),
	});
}
