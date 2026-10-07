/** Compare four native compiled applications on the same fully consumed literal corpus. @module */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { deepStrictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { challengerArguments, challengerRuntime, runChallengers } from './challenger-run.ts';
import { challengerOrders } from './challenger-compare.ts';
import { challengerNames, httpChallengerCases } from './fixtures/http-challengers.ts';
import type { ChallengerOperationType } from './fixtures/http-challengers.ts';
import { elysiaConfiguration } from '../tests/fixtures/http-parity/elysia.ts';
import { vixenyContract } from '../tests/fixtures/http-parity/vixeny.ts';

const selector = challengerArguments.find((value) => value.startsWith('--order='))?.slice(8) ?? '0';
const orderIndex = Number(selector);
if (
	!/^\d+$/u.test(selector) || !Number.isSafeInteger(orderIndex) || orderIndex < 0 ||
	orderIndex >= challengerOrders.length
) {
	throw new TypeError('Select a registered challenger order.');
}
const order = challengerOrders[orderIndex]!;
const selection = challengerArguments.find((value) => value.startsWith('--workload='))?.slice(11);
const workloads = httpChallengerCases();
if (selection !== undefined && !workloads.some((value) => value.id === selection)) {
	throw new TypeError('Select a registered HTTP challenger workload.');
}
const owners: ChallengerOperationType[] = [];
let failed = false;
let primary: unknown;
console.error(
	JSON.stringify({
		phase: 'challenger-runtime',
		runtime: challengerRuntime(),
		order,
		elysia: elysiaConfiguration,
		vixeny: vixenyContract,
	}),
);
try {
	for (
		const workload of workloads.filter((value) => selection === undefined ? value.benchmark : value.id === selection)
	) {
		const candidates: { name: string; operation: ChallengerOperationType }[] = [];
		for (const candidate of order) {
			const operation = await workload.open(candidate);
			owners.push(operation);
			deepStrictEqual(await operation.run(), operation.expected);
			candidates.push({ name: challengerNames[candidate], operation });
		}
		group(workload.id, () => {
			for (const { name, operation } of candidates) {
				bench(`${name}: ${workload.id}`, async () => do_not_optimize(await operation.run())).gc('once');
			}
		});
	}
	await runChallengers();
} catch (error) {
	failed = true;
	primary = error;
}
// Join every owner before propagating work or cleanup failures. An async callback
// also captures a synchronous close failure without skipping the remaining owners.
const results = await Promise.allSettled(owners.reverse().map(async (owner) => await owner.close()));
const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
if (failures.length) {
	const cleanup = new AggregateError(failures.map((result) => result.reason), 'HTTP challenger cleanup failed.');
	throw failed ? new SuppressedError(cleanup, primary, 'HTTP challenger work and cleanup both failed.') : cleanup;
}
if (failed) throw primary;
