/** Real-host activity corpus: cancellation must not hide errors raised while stopping. @module */
import * as activity from '@okikio/activity';
import * as context from '@okikio/context';
import * as engine from '@okikio/activity/engine';
import * as schema from '@okikio/schema';
import type { ActivityAttemptType } from '@okikio/workflow';

export const Engine = engine.define({ id: 'cleanup.host' });
export const Work = activity.define({
	id: 'cleanup.work',
	version: '1',
	description: 'Wait for cancellation, then join owned cleanup.',
	input: schema.string(),
	result: schema.string(),
	placement: engine.require(Engine),
});
export const Live = activity.implement(Work, {
	async run(ctx) {
		ctx.defer(async () => {
			// Disposal remains observable after cancellation; the caller must keep its host lease until this finishes.
			if (!ctx.input.startsWith('bench')) await new Promise<void>((resolve) => setTimeout(resolve, 40));
			if (ctx.input === 'dispose' || ctx.input === 'bench-dispose') throw new Error('owned disposer failed');
		});
		const aborted = new Promise<void>((resolve) => {
			ctx.signal.addEventListener('abort', () => resolve(), { once: true });
			if (ctx.signal.aborted) resolve();
		});
		try {
			await ctx.heartbeat('ready');
		} catch (error) {
			// The parent may cancel between receiving readiness and acknowledging it.
			if (!context.cancelled(error) && error !== ctx.signal.reason) throw error;
		}
		await aborted;
		if (ctx.input === 'success') return 'late success';
		if (ctx.input === 'undefined') throw undefined;
		if (ctx.input === 'throw') throw new Error('unrelated stop failure');
		throw ctx.signal.reason;
	},
});

/** Fresh fenced identities prevent one test or benchmark invocation from matching another. */
export function attempt(ctx: context.Context, input: string): ActivityAttemptType {
	return {
		jobId: crypto.randomUUID(),
		claimId: crypto.randomUUID(),
		attempt: 1,
		activityId: Work.id,
		activityVersion: Work.version,
		engineId: Engine.id,
		registrationId: 'cleanup',
		hostId: 'cleanup',
		generation: 1,
		origin: {
			workflowId: 'cleanup',
			workflowVersion: '1',
			runId: 'run',
			instructionPath: '0',
			instructionFingerprint: 'cleanup',
		},
		context: context.snapshot(ctx),
		input,
		admitted: true,
	};
}
