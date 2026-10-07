/** Measure actual activity execution and replay, rather than only instruction hashing. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { z } from 'zod';
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as context from '@okikio/context';
import * as workflow from '@okikio/workflow';
import * as dispatch from '@okikio/workflow/dispatch';
import * as history from '@okikio/workflow/history';
import { run } from './run.ts';

const Local = engine.define({ id: 'benchmark-local' });
const Echo = activity.define({
	id: 'bench.echo',
	version: '1',
	input: z.string(),
	result: z.string(),
	placement: engine.require(Local),
});
const Definition = workflow.define({
	id: 'bench.recovery',
	version: '1',
	input: z.string(),
	result: z.string(),
	activities: [Echo],
});
const implementation = workflow.implement(Definition, function* (ctx) {
	return yield* activity.request(Echo, ctx.input);
});
await using owner = context.create({ id: 'benchmark-recovery' });

/** A new local host executes once; a replacement Scheduler replays without calling its provider. */
async function executeAndReplay(): Promise<number> {
	await using jobs = dispatch.memory();
	await using records = history.memory();
	let calls = 0;
	await using _executor = await workflow.executor({
		dispatch: jobs,
		engine: Local,
		hostId: 'bench-host',
		capacity: 1,
		provider: {
			activities: [Echo],
			async run(_ctx, attempt) {
				calls += 1;
				return { type: 'success', value: attempt.input } as const;
			},
		},
	});
	{
		await using scheduler = workflow.scheduler({ activityDispatch: jobs, history: records });
		await using ctx = await workflow.context({
			definition: Definition,
			runId: 'bench-run',
			input: 'hello',
			ctx: owner,
		});
		strictEqual(await workflow.run({ ctx, implementation, scheduler }), 'hello');
	}
	{
		await using scheduler = workflow.scheduler({ activityDispatch: jobs, history: records });
		await using ctx = await workflow.context({
			definition: Definition,
			runId: 'bench-run',
			input: 'hello',
			ctx: owner,
		});
		strictEqual(await workflow.run({ ctx, implementation, scheduler }), 'hello');
	}
	return calls;
}
strictEqual(await executeAndReplay(), 1);
group('workflow local recovery', () => {
	bench(
		'execute activity + replace Scheduler + replay completion',
		async () => do_not_optimize(await executeAndReplay()),
	).gc('once');
});
await run();
