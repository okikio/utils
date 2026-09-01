/**
 * Process-local Task lifecycle with cancellation, cooperative pause, and cleanup.
 *
 * A Task is not a workflow run, activity job, queue item, process, or Worker.
 * Durable systems can create several Tasks while retrying or replaying the same
 * durable identity.
 *
 * @module
 */
import '@okikio/dispose/polyfill';
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
		...(options.requirements?.interpreters === undefined
			? {}
			: { interpreters: options.requirements.interpreters }),
		unknown: options.requirements?.unknown ?? 'reject',
	});
	const resolver = options.resources === undefined ? undefined : resource.scope(options.resources, requirementCtx, options.allowed);

	let status: TaskStatusType = 'running';
	let terminal = false;
	let pauseRequested = false;
	let observed = resolved();
	let resumed = resolved();

	const taskCtx = context.view(requirementCtx, {
		async get<Resource extends Allowed>(definition: Resource) {
			if (resolver === undefined) throw new TypeError(`Task has no resource collection for ${JSON.stringify(definition.id)}.`);
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

	let primary: unknown;
	const done = (async () => {
		try {
			await taskCtx.checkpoint();
			const value = await run(taskCtx);
			context.check(owner);
			status = 'completed';
			return value;
		} catch (error) {
			primary = error;
			status = owner.signal.aborted ? 'cancelled' : 'failed';
			throw error;
		} finally {
			terminal = true;
			observed.resolve();
			resumed.resolve();
			try {
				await owner[Symbol.asyncDispose]();
			} catch (cleanup) {
				status = 'failed';
				if (primary !== undefined) throw new SuppressedError(cleanup, primary, 'Task work failed and cleanup also failed.');
				throw cleanup;
			}
		}
	})();

	return Object.freeze({
		done,
		signal: owner.signal,
		get status() { return status; },
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
			if (terminal) return;
			status = 'cancelling';
			pauseRequested = false;
			resumed.resolve();
			observed.resolve();
			context.cancel(owner, reason ?? new Error('Task cancelled.'));
			try { await done; } catch { /* `done` remains terminal authority. */ }
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
