import * as schema from '@okikio/schema';

import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as effect from '@okikio/capability/effect';
import * as resilience from '@okikio/capability/resilience';

export const InputSchema = schema.object({
	value: schema.string(),
	stallFirst: schema.defaults(schema.boolean(), () => false),
});

export const ResultSchema = schema.object({ stored: schema.string() });

const CommitSchema = schema.object({ stored: schema.string(), attempt: schema.number({ integer: true, minimum: 1 }) });

export const Engine = engine.define({
	id: 'scenario.restartable-worker',
	description: 'Runs restartable distributed activity attempts.',
});

export const Committed = effect.define({
	id: 'scenario.restartable-worker.committed',
	description: 'Represents an externally visible idempotent commit.',
	value: CommitSchema,
});

export const Persist = activity.define({
	id: 'scenario.restartable-worker.persist',
	version: '1',
	description: 'Commits one value through a remote activity host.',
	input: InputSchema,
	result: ResultSchema,
	placement: engine.require(Engine),
	effects: [Committed],
	resilience: resilience.retry({
		maximumAttempts: 3,
		initialDelay: { milliseconds: 1 },
		maximumDelay: { milliseconds: 1 },
		jitter: false,
	}),
});

export const PersistLive = activity.implement(Persist, {
	async run(ctx) {
		// Renew before the commit. Once the effect emitter acknowledges, the test
		// knows the first attempt has a full claim lease and an external side effect.
		await ctx.heartbeat({ phase: 'committing', attempt: ctx.attempt });
		await effect.emit(ctx, Committed, { stored: ctx.input.value, attempt: ctx.attempt }, {
			key: `commit:${ctx.jobId}`,
		});

		// Model a host disappearing after external commit but before returning the
		// activity result. The replacement Scheduler must recover through the same
		// durable job identity rather than manufacture a second logical job.
		if (ctx.input.stallFirst && ctx.attempt === 1) await new Promise<void>(() => {});
		return Object.freeze({ stored: ctx.input.value });
	},
});
