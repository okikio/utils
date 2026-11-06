import * as schema from '@okikio/schema';

import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as effect from '@okikio/capability/effect';
import * as resilience from '@okikio/capability/resilience';

export const InputSchema = schema.object({
	task: schema.string(),
	crashFirst: schema.defaults(schema.boolean(), () => false),
});

export const ResultSchema = schema.object({
	task: schema.string(),
	pid: schema.number({ integer: true }),
	attempt: schema.number({ integer: true }),
});

const AttemptSchema = ResultSchema;

export const Engine = engine.define({
	id: 'scenario.process-orchestration',
	description: 'Runs workflow activities in reusable child processes.',
});

export const Attempted = effect.define({
	id: 'scenario.process-orchestration.attempted',
	description: 'Records the child process identity for one fenced attempt.',
	value: AttemptSchema,
});

export const Execute = activity.define({
	id: 'scenario.process-orchestration.execute',
	version: '1',
	description: 'Runs one orchestration step in a child process.',
	input: InputSchema,
	result: ResultSchema,
	placement: engine.require(Engine),
	effects: [Attempted],
	resilience: resilience.retry({
		maximumAttempts: 3,
		initialDelay: { milliseconds: 1 },
		maximumDelay: { milliseconds: 1 },
		jitter: false,
	}),
});

export const ExecuteLive = activity.implement(Execute, {
	async run(ctx) {
		const pid = Deno.pid;
		await ctx.heartbeat({ task: ctx.input.task, pid, attempt: ctx.attempt });
		await effect.emit(ctx, Attempted, { task: ctx.input.task, pid, attempt: ctx.attempt }, {
			key: `attempt:${ctx.jobId}:${ctx.attempt}`,
		});
		if (ctx.input.crashFirst && ctx.attempt === 1) Deno.exit(23);
		return Object.freeze({ task: ctx.input.task, pid, attempt: ctx.attempt });
	},
});
