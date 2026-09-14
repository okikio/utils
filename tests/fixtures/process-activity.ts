import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as effect from '@okikio/effect';
import * as resilience from '@okikio/resilience';

function contract<Output>(validate: (value: unknown) => Output): StandardSchemaV1<unknown, Output> {
	return Object.freeze({
		'~standard': Object.freeze({
			version: 1,
			vendor: 'process-orchestration-scenario',
			validate(value: unknown) {
				try { return { value: validate(value) }; }
				catch (error) { return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }; }
			},
		}),
	});
}

export const InputSchema = contract((value) => {
	if (typeof value !== 'object' || value === null) throw new TypeError('Expected process activity input.');
	const input = value as { task?: unknown; crashFirst?: unknown };
	if (typeof input.task !== 'string') throw new TypeError('Expected task string.');
	if (input.crashFirst !== undefined && typeof input.crashFirst !== 'boolean') throw new TypeError('Expected crashFirst boolean.');
	return Object.freeze({ task: input.task, crashFirst: input.crashFirst === true });
});

export const ResultSchema = contract((value) => {
	if (typeof value !== 'object' || value === null) throw new TypeError('Expected process activity result.');
	const result = value as { task?: unknown; pid?: unknown; attempt?: unknown };
	if (typeof result.task !== 'string' || !Number.isSafeInteger(result.pid) || !Number.isSafeInteger(result.attempt)) {
		throw new TypeError('Expected task, pid, and attempt result fields.');
	}
	return Object.freeze({ task: result.task, pid: Number(result.pid), attempt: Number(result.attempt) });
});

const AttemptSchema = contract((value) => {
	if (typeof value !== 'object' || value === null) throw new TypeError('Expected process attempt effect.');
	const attempt = value as { task?: unknown; pid?: unknown; attempt?: unknown };
	if (typeof attempt.task !== 'string' || !Number.isSafeInteger(attempt.pid) || !Number.isSafeInteger(attempt.attempt)) {
		throw new TypeError('Expected task, pid, and attempt effect fields.');
	}
	return Object.freeze({ task: attempt.task, pid: Number(attempt.pid), attempt: Number(attempt.attempt) });
});

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
