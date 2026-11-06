// @benchmark optional
/** Node-only: eight activity results through nested workflows on one warm physical host. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { bench, do_not_optimize, group } from 'mitata';
import { run as measure } from '#tools/bench/run.ts';
import * as context from '@okikio/context';
import * as workflow from '@okikio/workflow';
import { compute, Engine } from '#fixtures/nested-contract.ts';
import { open, run, scheduler as createScheduler } from '#fixtures/nested-host.ts';

await using owner = context.create({ id: 'nested-bench' });
await using owners = new AsyncDisposableStack();
for (const kind of ['thread', 'process'] as const) {
	for (const concurrency of [1, 4]) {
		const name = `${kind}:${concurrency}`;
		const provider = owners.use(await open(owner, kind, name, concurrency));
		const scheduler = owners.use(createScheduler());
		owners.use(
			await scheduler.register({
				engine: Engine,
				provider,
				hostId: name,
				compute: compute(name, kind, 8),
				capacity: 8,
			}),
		);
		const location = workflow.placement.on({ id: `${kind}:${name}`, generation: 1 });
		for (const load of ['io', 'cpu', 'mixed'] as const) {
			/** Timing includes nested dispatch, bounded host admission, validation and attempt cleanup. */
			const batch = async (): Promise<void> => {
				const inputs = Array.from({ length: 4 }, (_, index) => load === 'mixed' ? (index % 2 ? 'cpu' : 'io') : load);
				const results = await Promise.all(inputs.map((input) => run(owner, scheduler, location, input)));
				const instance = results[0]![0]!.instance;
				for (const [index, receipts] of results.entries()) {
					if (
						receipts.length !== 2 ||
						receipts.some((receipt) =>
							receipt.owner !== name || receipt.instance !== instance || receipt.value !== inputs[index] ||
							receipt.checksum !== (inputs[index] === 'cpu' ? 199980000 : 0)
						)
					) throw new Error('Nested host result or physical resource identity oracle failed.');
				}
				do_not_optimize(results);
			};
			await batch();
			group(`${kind}, concurrency ${concurrency}, ${load}, four parents / eight activities`, () => {
				bench('nested dispatch + execution + cleanup', batch);
			});
		}
	}
}
await measure();
