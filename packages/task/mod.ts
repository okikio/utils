/**
 * Control one process-local operation with cooperative pause, cancellation and joined cleanup. A Promise alone cannot request a pause or communicate whether cancellation and resource disposal have finished.
 *
 * Add checkpoints between indivisible provider calls so pause requests have a place to take effect. Pass the context signal into I/O for cancellation. done owns the terminal value and cleanup failure; disposal joins pending cleanup. A task is one local lifetime, while a workflow can create many tasks during retries or replay. Do not use a task status as evidence of durable external acceptance.
 *
 * @example
 * ```ts
 * import '@okikio/duration/polyfill';
 * import '@okikio/dispose/polyfill';
 * import * as task from '@okikio/task';
 * const cleanup: string[] = [];
 * await using work = task.start(async (ctx) => {
 *   ctx.defer(() => { cleanup.push('released'); });
 *   await ctx.checkpoint();
 *   return 42;
 * }, { id: 'local-operation' });
 * console.log(await work.done, work.status, cleanup.join(','));
 * ```
 *
 * @module
 */
import * as context from '@okikio/context';
import * as requirements from '@okikio/requirement';
import * as resource from '@okikio/resource';
import type { ResourceDefinition } from '@okikio/resource';
import type { Task, TaskContext, TaskOptions, TaskStatusType } from './types.ts';

/** Small internal deferred value used only for one pause generation. */
interface Deferred {
	/** Promise awaited by every checkpoint blocked on the same pause generation. */
	readonly promise: Promise<void>;
	/** Release the current pause generation exactly once. */
	resolve(): void;
}

/**
 * Start one process-local Task.
 *
 * The Task owns its child context and values registered through that context.
 * It borrows an optional resource collection. Pausing is cooperative: an
 * indivisible provider call can finish before the next `checkpoint()` waits.
 */
export function start<Value, Allowed extends ResourceDefinition = never>(
	run: (ctx: TaskContext<Allowed>) => Value | Promise<Value>,
	options: TaskOptions<Allowed> = {},
): Task<Value> {
	if (typeof run !== 'function') throw new TypeError('Task start requires a function.');

	const owner = options.ctx === undefined
		? context.create({ id: options.id ?? crypto.randomUUID() })
		: context.child(options.ctx, options.id === undefined ? {} : { id: options.id });
	const requirementCtx = requirements.scope(owner, {
		...(options.requirements?.interpreters === undefined ? {} : { interpreters: options.requirements.interpreters }),
		unknown: options.requirements?.unknown ?? 'reject',
	});
	const resolver = options.resources === undefined
		? undefined
		: resource.scope(options.resources, requirementCtx, options.allowed);

	let status: TaskStatusType = 'running';
	let terminal = false;
	let pauseRequested = false;
	let observed = resolved();
	let resumed = resolved();

	const taskCtx = context.view(requirementCtx, {
		async get<Resource extends Allowed>(definition: Resource) {
			if (resolver === undefined) {
				throw new TypeError(`Task has no resource collection for ${JSON.stringify(definition.id)}.`);
			}
			return await resolver.get(definition);
		},
		checkpoint: async () => {
			context.check(owner);
			if (pauseRequested && !terminal) {
				status = 'paused';
				observed.resolve();
				await resumed.promise;
			}
			context.check(owner);
			if (!terminal && !pauseRequested && status !== 'cancelling') status = 'running';
		},
	}) as TaskContext<Allowed>;

	const done = (async () => {
		let value!: Value;
		let workFailed = false;
		let workError: unknown;
		try {
			await taskCtx.checkpoint();
			value = await run(taskCtx);
			context.check(owner);
		} catch (error) {
			workFailed = true;
			workError = error;
			status = owner.signal.aborted ? 'cancelled' : 'failed';
		}
		terminal = true;
		observed.resolve();
		resumed.resolve();
		try {
			await owner[Symbol.asyncDispose]();
		} catch (cleanup) {
			status = 'failed';
			if (workFailed) throw new SuppressedError(cleanup, workError, 'Task work failed and cleanup also failed.');
			throw cleanup;
		}
		if (workFailed) throw workError;
		status = 'completed';
		return value;
	})();

	return Object.freeze({
		done,
		signal: owner.signal,
		get status() {
			return status;
		},
		pause() {
			if (terminal || status === 'paused') return Promise.resolve();
			if (status === 'pausing') return observed.promise;
			pauseRequested = true;
			status = 'pausing';
			observed = deferred();
			resumed = deferred();
			return observed.promise;
		},
		resume() {
			if (terminal || status === 'cancelling') return;
			pauseRequested = false;
			resumed.resolve();
			if (status === 'pausing') observed.resolve();
			status = 'running';
		},
		async cancel(reason?: unknown) {
			if (terminal) {
				try {
					await done;
				} catch { /* done owns the result and cleanup failure. */ }
				return;
			}
			status = 'cancelling';
			pauseRequested = false;
			resumed.resolve();
			observed.resolve();
			context.cancel(owner, reason ?? new Error('Task cancelled.'));
			try {
				await done;
			} catch { /* `done` remains terminal authority. */ }
		},
		async [Symbol.asyncDispose]() {
			await this.cancel(new Error('Task disposed.'));
		},
	});
}

/** Create one pending pause-generation signal with idempotent resolution. */
function deferred(): Deferred {
	let settled = false;
	let resolve!: () => void;
	const promise = new Promise<void>((done) => resolve = done);
	return Object.freeze({
		promise,
		resolve() {
			if (settled) return;
			settled = true;
			resolve();
		},
	});
}

/** Create an already-settled generation used when no pause is active. */
function resolved(): Deferred {
	return Object.freeze({ promise: Promise.resolve(), resolve() {} });
}

export type { Task, TaskContext, TaskOptions, TaskStatusType } from './types.ts';
