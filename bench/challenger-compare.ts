/** Eight whole-process HTTP trials support individual paired comparisons without timing gates. @module */
import { challengerCandidates, challengerNames } from './challenger-contract.ts';
import type { ChallengerCandidateType } from './challenger-contract.ts';

/** Fixed workload IDs prevent a missing entire matrix row from looking successful. */
export const challengerWorkloads = [
	'challenger-api',
	'challenger-routes-16',
	'challenger-routes-256',
	'challenger-routes-4096',
] as const;

/** Williams orders balance each candidate position and directed immediate predecessor twice. */
export const challengerOrders = [
	['utils', 'hono', 'vixeny', 'elysia'],
	['hono', 'elysia', 'utils', 'vixeny'],
	['elysia', 'vixeny', 'hono', 'utils'],
	['vixeny', 'utils', 'elysia', 'hono'],
	['vixeny', 'utils', 'elysia', 'hono'],
	['elysia', 'vixeny', 'hono', 'utils'],
	['hono', 'elysia', 'utils', 'vixeny'],
	['utils', 'hono', 'vixeny', 'elysia'],
] as const satisfies readonly (readonly ChallengerCandidateType[])[];

/** Reject missing, extra or repeated native runs before any ratios are computed. */
export function completeChallengers(aliases: readonly string[]): void {
	const expected = new Set(
		challengerWorkloads.flatMap((id) =>
			challengerCandidates.map((candidate) => `${challengerNames[candidate]}: ${id}`)
		),
	);
	for (const alias of aliases) {
		if (!expected.delete(alias)) throw new TypeError('Unexpected or duplicate challenger measurement.');
	}
	if (expected.size !== 0) throw new TypeError('Missing challenger matrix measurement.');
}

/** One competitor comparison retains all eight paired mean times, in nanoseconds. */
export interface ChallengerComparisonType {
	readonly workload: string;
	readonly competitor: string;
	readonly utilsNs: readonly number[];
	readonly competitorNs: readonly number[];
	readonly ratio: number;
	readonly interval95: readonly [number, number];
	readonly conclusion: 'lower Utils time' | 'higher Utils time' | 'difference unresolved';
}

/**
 * Estimate Utils/competitor using a Student-t interval on eight paired log ratios.
 *
 * This models approximately independent normal whole-process log ratios, not the
 * harness's correlated inner sample population. Each interval is individual95%;
 * the matrix does not assert simultaneous confidence or rank unresolved candidates.
 */
export function compareChallengers(
	workload: string,
	competitor: string,
	utilsNs: readonly number[],
	competitorNs: readonly number[],
): ChallengerComparisonType {
	if (
		utilsNs.length !== 8 || competitorNs.length !== 8 ||
		[...utilsNs, ...competitorNs].some((value) => !Number.isFinite(value) || value <= 0)
	) {
		throw new TypeError('Comparison requires eight paired finite positive timings.');
	}
	const logs = utilsNs.map((value, index) => Math.log(value / competitorNs[index]!));
	const mean = logs.reduce((sum, value) => sum + value, 0) / 8;
	const variance = logs.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 7;
	// Two-sided Student-t critical value for df=7; individual 95% confidence.
	// NIST tabulates its rounded value as 2.365: https://www.itl.nist.gov/div898/handbook/eda/section3/eda3672.htm
	const error = 2.364624251592784 * Math.sqrt(variance / 8);
	const interval95 = [Math.exp(mean - error), Math.exp(mean + error)] as const;
	return {
		workload,
		competitor,
		utilsNs,
		competitorNs,
		ratio: Math.exp(mean),
		interval95,
		conclusion: interval95[1] < 1
			? 'lower Utils time'
			: interval95[0] > 1
			? 'higher Utils time'
			: 'difference unresolved',
	};
}
