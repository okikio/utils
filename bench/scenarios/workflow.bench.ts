import { bench, do_not_optimize, group, run } from 'mitata';

import * as workflow from '@okikio/workflow';

const operations = Array.from({ length: 32 }, (_, index) => workflow.sleep({ milliseconds: index + 1 }, { key: `timer-${index}` }));

group('durable workflow identity', () => {
	bench('identify 32 deterministic timer instructions', async () => {
		const identities: string[] = [];
		for (let index = 0; index < operations.length; index += 1) {
			const step = operations[index]![Symbol.iterator]().next();
			if (step.done) throw new Error('benchmark workflow operation did not yield');
			identities.push((await workflow.identify(step.value, `bench.workflow@1/${index}:sleep`)).fingerprint);
		}
		do_not_optimize(identities);
	}).gc('once');
});

await run();
