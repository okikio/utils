/** Import-safe activity/workflow contracts for physical session test. */
import process from 'node:process';
import { threadId } from 'node:worker_threads';
import * as schema from '@okikio/schema';
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as resource from '@okikio/capability/resource';
import * as session from '@okikio/capability/resource/session';
import * as workflow from '@okikio/workflow';
import { Policy as BasePolicy } from './nested-contract.ts';

/**
 * Leave room for native transport and shared-host scheduling jitter. Publication still crosses
 * two renewal ticks: the 2,400 ms borrow lease gives an 800 ms tick, below the 1,800 ms delay.
 * These are fixture budgets; production session policy remains caller-owned.
 */
export const Timing = {
	/** Owner liveness on the SQL authority's clock, in milliseconds. */
	leaseMs: 4800,
	/** Borrow liveness in milliseconds; its third defines the renewal timer interval. */
	borrowMs: 2400,
	/** Ordinary idle retention in milliseconds; pool-selection cases use their separate budget. */
	idleMs: 6000,
	/** SQL publication delay in seconds, long enough to cross two renewal ticks. */
	publicationSeconds: 1.8,
};

/** Live counter state. It stays inside one native host and never crosses transport. */
export interface Counter {
	/** Random physical resource lifetime, independent of the saved session ID. */
	instance: string;
	/** Borrows that entered the callback, including held and cancelled operations. */
	count: number;
	/** Deferred borrow cleanups that have joined; the active callback is not yet included. */
	finished: number;
	/** Wait for the test's SQL release gate or borrow cancellation; the owning host supplies this function. */
	wait(signal: AbortSignal): Promise<void>;
}
/** The activity borrows this host-owned session collection without disposing it. */
export const Sessions = resource.define<session.Owner<Counter>>()({
	id: 'sessions.counter',
	description: 'Own explicit leased counter sessions on this host.',
});
/** Shared contract for both real threads and real child processes. */
export const Engine = engine.define({ id: 'sessions.native' });

/** Portable operations used by the coordinator; crash deliberately bypasses cleanup. */
export const InputSchema = schema.object({
	/** Optional exact pool host, forwarded through parent and child workflow placement. */
	host: schema.optional(workflow.placement.HostSchema),
	/** Choose acquisition, borrowing, cancellation, normal closure or forced owner loss. */
	op: schema.oneOf(['create', 'use', 'hold', 'cancel', 'close', 'crash']),
	/** Required for operations on existing state; absent for initial creation and crash. */
	reference: schema.optional(session.ReferenceSchema),
});
/** Evidence returned by the native activity, not manufactured by the coordinator. */
export const ResultSchema = schema.object({
	/** Physical host supplied by provider admission, when that provider exposes it. */
	host: schema.optional(workflow.placement.HostSchema),
	status: schema.oneOf(['ok', 'lost', 'closed', 'busy', 'owner', 'limit', 'cancelled']),
	reference: schema.optional(session.ReferenceSchema),
	/** Unchanged across borrows, different after explicit replacement. */
	instance: schema.optional(schema.string()),
	count: schema.optional(schema.number()),
	/** Completed cleanups before this callback's own cleanup runs. */
	finished: schema.optional(schema.number()),
	/** Native process ID; a process host must differ from the coordinator. */
	pid: schema.number(),
	/** Native thread ID; zero identifies the main thread in a child process. */
	thread: schema.number(),
});
/** Accepted input after transport validation. */
export type InputType = schema.Output<typeof InputSchema>;
/** Portable receipt used for the same assertions in native and container runs. */
export type ResultType = schema.Output<typeof ResultSchema>;
/** One resource-dependent activity exercises every session lifecycle operation. */
export const Work = activity.define({
	id: 'sessions.work',
	version: '1',
	input: InputSchema,
	result: ResultSchema,
	resources: [Sessions],
	placement: engine.require(Engine),
});
/** Operate on actual host-owned state; forced exit intentionally leaves no close receipt. */
export const Live = activity.implement(Work, {
	async run(ctx) {
		if (ctx.input.op === 'crash') process.exit(17);
		const owner = await ctx.get(Sessions);
		const receipt = { pid: process.pid, thread: threadId, host: ctx.physicalHost };
		try {
			if (ctx.input.op === 'create') {
				return {
					...receipt,
					status: 'ok' as const,
					reference: await owner.create({ signal: ctx.signal, host: ctx.physicalHost }),
				};
			}
			const ref = ctx.input.reference!;
			if (ctx.input.op === 'close') {
				await owner.close(ref);
				return { ...receipt, status: 'ok' as const };
			}
			const abort = new AbortController();
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				return await owner.use(ref, async (value, borrow) => {
					value.count++;
					// The delay makes cleanup observable. Returning from the activity
					// must still join it before another exclusive borrow can enter.
					borrow.defer(async () => {
						await new Promise((resolve) => setTimeout(resolve, 15));
						value.finished++;
					});
					if (ctx.input.op === 'hold') {
						await value.wait(borrow.signal);
					}
					if (ctx.input.op === 'cancel') {
						timer = setTimeout(() => abort.abort(new Error('cancelled')), 10);
						await new Promise<void>((resolve) =>
							borrow.signal.addEventListener('abort', () => resolve(), { once: true })
						);
						borrow.signal.throwIfAborted();
					}
					return {
						...receipt,
						status: 'ok' as const,
						instance: value.instance,
						count: value.count,
						finished: value.finished,
					};
				}, { signal: AbortSignal.any([ctx.signal, abort.signal]) });
			} finally {
				// The timer belongs to this borrow, not to the reusable session.
				if (timer !== undefined) clearTimeout(timer);
			}
		} catch (error) {
			if (error instanceof session.SessionError) return { ...receipt, status: error.code };
			if (ctx.input.op === 'cancel') return { ...receipt, status: 'cancelled' as const };
			throw error;
		}
	},
});
/** The child forwards the reference unchanged to the activity. */
export const Child = workflow.define({
	id: 'sessions.child',
	version: '1',
	input: InputSchema,
	result: ResultSchema,
	activities: [Work],
});
/** Nesting proves saved placement survives both workflow boundaries. */
export const Parent = workflow.define({
	id: 'sessions.parent',
	version: '1',
	input: InputSchema,
	result: ResultSchema,
	workflows: [Child],
});
/** Activity placement is inherited from the parent's selected executor and host. */
export const ChildLive = workflow.implement(Child, function* (ctx) {
	return yield* activity.request(Work, ctx.input);
});
/** Keep the parent free of live resource access, including during replay. */
export const ParentLive = workflow.implement(Parent, function* (ctx) {
	return yield* workflow.child(Child, ctx.input);
});
/** One attempt keeps crash evidence visible; an automatic retry could conceal host replacement. */
export const Policy = workflow.PolicySchema.parse({
	...BasePolicy,
	activities: [{ ...BasePolicy.activities[0]!, definition: Work, maxAttempts: 1 }],
	workflows: [{
		definition: Parent,
		maxInstructions: 5,
		requires: [],
		maximumChildren: 1,
		children: [{ definition: Child, maximum: 1 }],
	}, { definition: Child, maxInstructions: 5, requires: [] }],
});
