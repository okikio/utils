/** Four compiled HTTP candidates share literal request/response oracles; import performs no IO. @module */
import { cases, observe, request, routingCases } from '../../tests/fixtures/http-parity/corpus.ts';
import type { CaseType, ParityApiType } from '../../tests/fixtures/http-parity/corpus.ts';
import { createHonoApi, createHonoRouting } from '../../tests/fixtures/http-parity/hono.ts';
import { createUtilsApi, createUtilsRouting } from '../../tests/fixtures/http-parity/utils.ts';
import { createElysiaApi, createElysiaRouting } from '../../tests/fixtures/http-parity/elysia.ts';
import { createVixenyApi, createVixenyRouting } from '../../tests/fixtures/http-parity/vixeny.ts';
import { challengerCandidates } from '../challenger-contract.ts';
import type { ChallengerCandidateType } from '../challenger-contract.ts';
export { challengerCandidates, challengerNames } from '../challenger-contract.ts';
export type { ChallengerCandidateType } from '../challenger-contract.ts';

/** Compiled owner with a fully consumed independent response projection per run. */
export interface ChallengerOperationType {
	readonly run: () => Promise<readonly unknown[]>;
	readonly close: () => Promise<void>;
	readonly expected: readonly unknown[];
	readonly units: number;
}

/** Setup, compilation, preflight and warmup precede sampling; close follows it. */
export interface ChallengerWorkloadType {
	readonly id: string;
	readonly scope: string;
	readonly candidates: readonly ChallengerCandidateType[];
	readonly benchmark: boolean;
	readonly open: (candidate: ChallengerCandidateType) => Promise<ChallengerOperationType>;
}

/**
 * Return batch workloads for comparison and individual vectors for CPU attribution.
 *
 * Every candidate receives the same cases and authored expected observations. A
 * failed capability preflight blocks measurement instead of changing the corpus
 * for one candidate. These operations measure in-process Fetch dispatch, not a
 * listening server, native socket throughput, gateway policy or service ownership.
 * Elysia's runtime adapter choice belongs to its candidate factory.
 */
export function httpChallengerCases(): readonly ChallengerWorkloadType[] {
	const result: ChallengerWorkloadType[] = [workload('challenger-api', cases, true)];
	for (const value of cases) result.push(workload(`challenger-api-${value.id}`, [value], false));
	for (const count of [16, 256, 4096]) {
		const values = routingCases(count);
		result.push(workload(`challenger-routes-${count}`, values, true, count));
		for (const value of values) result.push(workload(`challenger-routes-${count}-${value.id}`, [value], false, count));
	}
	return result;
}

/** Preserve one literal corpus and await each candidate's compilation outside the operation. */
function workload(
	id: string,
	values: readonly CaseType[],
	benchmark: boolean,
	routeCount?: number,
): ChallengerWorkloadType {
	return {
		id,
		benchmark,
		candidates: challengerCandidates,
		scope:
			'Warm compiled Fetch dispatch; fresh identical requests and complete response observations; setup and close excluded.',
		async open(candidate) {
			let app: ParityApiType;
			switch (candidate) {
				case 'utils':
					app = routeCount === undefined ? createUtilsApi() : createUtilsRouting(routeCount);
					break;
				case 'hono':
					app = routeCount === undefined ? createHonoApi() : createHonoRouting(routeCount);
					break;
				case 'elysia':
					app = await (routeCount === undefined ? createElysiaApi() : createElysiaRouting(routeCount));
					break;
				case 'vixeny':
					app = await (routeCount === undefined ? createVixenyApi() : createVixenyRouting(routeCount));
					break;
				default:
					throw new TypeError('Unknown HTTP challenger candidate.');
			}
			return {
				async run() {
					const output: unknown[] = [];
					for (const value of values) output.push(await observe(await app.fetch(request(value)), value));
					return output;
				},
				close: () => app.close(),
				expected: values.map((value) => value.expected),
				units: values.length,
			};
		},
	};
}
