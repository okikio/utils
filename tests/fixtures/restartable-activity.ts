import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as effect from '@okikio/effect';
import * as resilience from '@okikio/resilience';

function contract<Output>(validate: (value: unknown) => Output): StandardSchemaV1<unknown, Output> {
	return Object.freeze({
		'~standard': Object.freeze({
			version: 1,
			vendor: 'restartable-scenario',
			validate(value: unknown) {
				try { return { value: validate(value) }; }
				catch (error) { return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }; }
			},
		}),
	});
}

export const InputSchema = contract((value) => {
	if (typeof value !== 'object' || value === null) throw new TypeError('Expected activity input.');
	const input = value as { value?: unknown; stallFirst?: unknown };
	if (typeof input.value !== 'string') throw new TypeError('Expected input.value string.');
	if (input.stallFirst !== undefined && typeof input.stallFirst !== 'boolean') throw new TypeError('Expected input.stallFirst boolean.');
	return Object.freeze({ value: input.value, stallFirst: input.stallFirst === true });
});

export const ResultSchema = contract((value) => {
	if (typeof value !== 'object' || value === null || typeof (value as { stored?: unknown }).stored !== 'string') {
		throw new TypeError('Expected stored result.');
	}
	return Object.freeze({ stored: (value as { stored: string }).stored });
});

const CommitSchema = contract((value) => {
	if (typeof value !== 'object' || value === null) throw new TypeError('Expected commit value.');
	const commit = value as { stored?: unknown; attempt?: unknown };
	if (typeof commit.stored !== 'string' || !Number.isSafeInteger(commit.attempt) || Number(commit.attempt) < 1) {
		throw new TypeError('Expected stored string and positive attempt.');
	}
	return Object.freeze({ stored: commit.stored, attempt: Number(commit.attempt) });
});

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
		await effect.emit(ctx, Committed, { stored: ctx.input.value, attempt: ctx.attempt }, { key: `commit:${ctx.jobId}` });

		// Model a host disappearing after external commit but before returning the
		// activity result. The replacement Scheduler must recover through the same
		// durable job identity rather than manufacture a second logical job.
		if (ctx.input.stallFirst && ctx.attempt === 1) await new Promise<void>(() => {});
		return Object.freeze({ stored: ctx.input.value });
	},
});
