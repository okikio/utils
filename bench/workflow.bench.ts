import { bench, do_not_optimize, group } from 'mitata';

import * as workflow from '@okikio/workflow';

const operations = Array.from({ length: 32 }, (_, index) => workflow.sleep({ milliseconds: index + 1 }, { key: `timer-${index}` }));

/** Derive the fixed workflow identity corpus outside and inside the timed workload. */
async function identify(): Promise<readonly string[]> {
	const identities: string[] = [];
	for (let index = 0; index < operations.length; index += 1) {
		const step = operations[index]![Symbol.iterator]().next();
		if (step.done) throw new Error('Benchmark workflow operation did not yield.');
		identities.push((await workflow.identify(step.value, `bench.workflow@1/${index}:sleep`)).fingerprint);
	}
	return identities;
}

const initial = await identify();
const repeated = await identify();
if (initial.length !== operations.length || new Set(initial).size !== operations.length || !initial.every((value, index) => value === repeated[index])) {
	throw new Error('Workflow benchmark identifiers are not unique and deterministic.');
}

group('durable workflow identity', () => {
	bench('identify 32 deterministic timer instructions', async () => {
		do_not_optimize(await identify());
	}).gc('once');
});
