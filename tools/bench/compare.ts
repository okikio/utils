/** Run-to-run paired uncertainty, separate from the harness's correlated inner timing population. @module */

/** Six fresh-process paired observations summarize one workload, with times in nanoseconds. */
export interface ComparisonType {
	readonly workload: string;
	readonly utilsNs: readonly number[];
	readonly honoNs: readonly number[];
	readonly ratio: number;
	readonly interval95: readonly [number, number];
	readonly conclusion: 'lower Utils time' | 'higher Utils time' | 'difference unresolved';
}

/** Stable report identities keep coverage checks independent from displayed workload descriptions. */
export const workloads = [
	'api',
	'gateway',
	'routes-16',
	'routes-256',
	'routes-4096',
] as const;

/** Reject a missing whole workload pair, unknown aliases and repeated measurements before reporting uncertainty. */
export function complete(aliases: readonly string[]): void {
	const expected = new Set(workloads.flatMap((name) => [`Utils: ${name}`, `Hono: ${name}`]));
	for (const alias of aliases) {
		if (!expected.delete(alias)) throw new TypeError('Unexpected or duplicate parity measurement.');
	}
	if (expected.size !== 0) throw new TypeError('Missing parity workload measurement.');
}

/**
 * Compare exactly six counterbalanced trials using a Student-t interval on paired log time ratios.
 * A ratio below one means Utils took less time. The interval models run-to-run variability under
 * approximately independent normal log ratios; it cannot account for systematic host bias.
 * An interval containing one is inconclusive, not proof of equivalence or a performance gate.
 */
export function compare(workload: string, utilsNs: readonly number[], honoNs: readonly number[]): ComparisonType {
	if (
		utilsNs.length !== 6 || honoNs.length !== 6 ||
		[...utilsNs, ...honoNs].some((value) => !Number.isFinite(value) || value <= 0)
	) throw new TypeError('Comparison requires six paired finite positive timings.');
	const logs = utilsNs.map((value, index) => Math.log(value / honoNs[index]!));
	const mean = logs.reduce((sum, value) => sum + value, 0) / logs.length;
	const variance = logs.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (logs.length - 1);
	// Two-sided 95% Student-t critical value for five degrees of freedom (NIST table).
	const error = 2.570581835636314 * Math.sqrt(variance / logs.length);
	const interval95 = [Math.exp(mean - error), Math.exp(mean + error)] as const;
	return {
		workload,
		utilsNs,
		honoNs,
		ratio: Math.exp(mean),
		interval95,
		conclusion: interval95[1] < 1
			? 'lower Utils time'
			: interval95[0] > 1
			? 'higher Utils time'
			: 'difference unresolved',
	};
}
