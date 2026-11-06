/** Reused generation admission and clean shutdown; native Worker startup is a separate host workload. @module */
import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as context from '@okikio/context';
import * as supervisor from './supervisor.ts';
import type { WorkerTerminationType } from './thread/types.ts';

await using owner = context.create({ id: 'supervisor-bench', clock: new context.TestClock() });
const terminal = Promise.withResolvers<WorkerTerminationType>();
const generation: supervisor.GenerationType<number, number> = {
	closed: terminal.promise,
	async request(_ctx, value) {
		return value;
	},
	async stop(reason) {
		terminal.resolve({ status: 'stopped', forced: false, reason });
	},
};
await using lifecycle = supervisor.create(owner, () => generation, {
	maximumRestarts: 0,
	maximumRequests: 1,
	backoff: 0,
});
await lifecycle.ready;
for (const count of [1, 1000]) {
	const requests = async function (supervised: boolean): Promise<number> {
		let total = 0;
		for (let index = 0; index < count; index++) {
			total += supervised ? await lifecycle.request(owner, 1) : await generation.request(owner, 1);
		}
		return total;
	};
	strictEqual(await requests(true), count);
	strictEqual(await requests(false), count);
	group(`supervisor ${count} successful calls; no request replay`, () => {
		bench('bounded admission and removable loss observation', async () => do_not_optimize(await requests(true)));
		bench('direct ready generation; no supervisor capacity', async () => do_not_optimize(await requests(false)));
	});
}
await run();
