/** Real browser Duration operations with an explicit, identity-preserving Temporal installer. @module */
import * as duration from '../mod.ts';

/** Validate numeric settings and a real calendar transition in the browser's Temporal implementation. */
export async function verify(): Promise<readonly string[]> {
	const existing = globalThis.Temporal;
	await import('../polyfill.ts');
	if (globalThis.Temporal === undefined || existing !== undefined && globalThis.Temporal !== existing) {
		throw new Error('Explicit Temporal installation replaced or failed to provide the browser implementation.');
	}
	const retry = duration.from(2.5, 'seconds');
	if (
		retry.toString() !== 'PT2.5S' || duration.total(retry, 'milliseconds') !== 2500 ||
		duration.convert(2500, 'milliseconds', 'seconds') !== 2.5 ||
		duration.from(0.1 + 0.2, 'seconds').toString() !== 'PT0.3S'
	) throw new Error('Browser fractional construction or unit conversion changed its authored value.');
	const calendar = duration.convert(1, 'day', 'hours', {
		relativeTo: '2026-03-08T00:00:00-05:00[America/New_York]',
	});
	if (calendar !== 23 || duration.elapsed({ days: 1 }, 'hours') !== 24) {
		throw new Error('Browser calendar conversion lost the anchored daylight-saving transition.');
	}
	return [
		existing === undefined ? 'duration explicit Temporal installation' : 'duration native Temporal identity preserved',
		'duration fractional construction and unit conversion in the browser',
		'duration anchored 23-hour calendar day and fixed 24-hour elapsed day',
	];
}
