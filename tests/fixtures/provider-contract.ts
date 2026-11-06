/** Exact contracts shared by the native local/thread/process conformance corpus. */
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as schema from '@okikio/schema';
import * as failure from '@okikio/result/failure';
export const Engine = engine.define({ id: 'native.provider' });
export const Rejected = failure.define({
	id: 'native.provider.rejected',
	description: 'A deliberate declared provider failure.',
	data: schema.string(),
});
export const Work = activity.define({
	id: 'native.provider.work',
	version: '1',
	description: 'Runs the same checked corpus on each native provider.',
	input: schema.string(),
	result: schema.string(),
	failures: [Rejected],
	placement: engine.require(Engine),
});
export const Live = activity.implement(Work, {
	async run(ctx) {
		if (ctx.input === 'stuck') {
			await ctx.heartbeat({ host: Host, phase: 'stuck' });
			await new Promise<void>(() => {});
		}
		if (ctx.input === 'host') return Host;
		if (ctx.input === 'hold') {
			await ctx.heartbeat({ host: Host, phase: 'hold' });
			return Host;
		}
		if (ctx.input === 'delay') await new Promise<void>((resolve) => setTimeout(resolve, 2));
		if (ctx.input === 'failure') throw await failure.create(Rejected, { data: 'expected', message: 'declared' });
		if (ctx.input === 'fault') throw new Error('undeclared');
		if (ctx.input === 'cancel') {
			await ctx.heartbeat({ host: Host, phase: 'cancel' });
			await new Promise<void>((resolve) => {
				ctx.signal.addEventListener('abort', () => resolve(), { once: true });
			});
		}
		await ctx.checkpoint();
		await ctx.heartbeat({ alive: true });
		return ctx.input.toUpperCase();
	},
});

/** Distinguishes actual runtime instances; it never supplies workflow identity. */
const Host = crypto.randomUUID();
