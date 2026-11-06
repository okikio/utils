/**
 * Own one local operation that can pause cooperatively, accept cancellation, and report its result after
 * cleanup. A Promise alone cannot request a pause or tell a caller that resource disposal has finished.
 *
 * Put checkpoints between operations that can safely pause. Pass the context signal to I/O for
 * cancellation. done carries the final value or failure, including cleanup failure; disposal waits for
 * pending cleanup.
 *
 * A task is one process-local lifetime. It does not prove that another service accepted a write, and it
 * does not save workflow progress across process loss.
 *
 * @example
 * ```ts
 * import * as task from '@okikio/task';
 * const cleanup: string[] = [];
 * await using work = task.start(async (ctx) => {
 * 	ctx.defer(() => {
 * 		cleanup.push('released');
 * 	});
 * 	await ctx.checkpoint();
 * 	return 42;
 * }, { id: 'local-operation' });
 * console.log(await work.done, work.status, cleanup.join(','));
 * ```
 *
 * @module
 */
import { asyncDispose, SuppressedError } from '@okikio/dispose';
import * as context from '@okikio/context';
import { ProgressEffect } from './progress.ts';
export { ProgressEffect, ProgressSchema } from './progress.ts';
export type { ProgressType } from './progress.ts';
import * as effect from '@okikio/capability/effect';
import * as capability from '@okikio/capability/execution';
import type { ResourceDefinition } from '@okikio/capability/resource';
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
 * Capability setup failures reject done after child cleanup, without calling run.
 */
export function start<
	Value,
	Allowed extends ResourceDefinition = never,
	Progress extends effect.EffectDefinition = never,
>(
	run: (ctx: TaskContext<Allowed>) => Value | Promise<Value>,
	options: TaskOptions<Allowed, Progress> = {},
): Task<Value, typeof ProgressEffect | Progress> {
	if (typeof run !== 'function') throw new TypeError('Task start requires a function.');

	const owner = options.ctx === undefined
		? context.create({ id: options.id ?? crypto.randomUUID() })
		: context.child(options.ctx, options.id === undefined ? {} : { id: options.id });
	let status: TaskStatusType = 'running';
	let terminal = false;
	let pauseRequested = false;
	// Each pause request gets two signals: observed acknowledges a safe checkpoint;
	// resumed lets that checkpoint continue. Reusing them across pause generations
	// would allow an earlier resume to release a later pause.
	let observed = resolved();
	let resumed = resolved();
	/**
	 * Parent cancellation must wake the current pause generation; a paused checkpoint owns no native
	 * operation to abort.
	 */
	const aborted = (): void => {
		if (terminal) return;
		status = 'cancelling';
		pauseRequested = false;
		resumed.resolve();
		observed.resolve();
	};
	owner.signal.addEventListener('abort', aborted, { once: true });
	owner.defer(() => owner.signal.removeEventListener('abort', aborted));

	const reports = effect.observe<typeof ProgressEffect | Progress>({ onError: options.onError });

	const done = (async () => {
		let value!: Value;
		let workFailed = false;
		let workError: unknown;
		try {
			// Scope construction can fail; it must use the same joined cleanup path as work.
			const capabilities = capability.scope(owner, {
				...(options.resources === undefined
					? {}
					: { resources: { collection: options.resources, allowed: options.allowed ?? [] } }),
				...(options.requirements === undefined ? {} : { requirements: options.requirements }),
				effects: {
					effects: [
						...new Set([
							ProgressEffect,
							...(options.effects ?? []),
							...(options.progress === undefined ? [] : [options.progress]),
						]),
					],
					emitter: {
						async emit(ctx, occurrence) {
							if (occurrence.definition === ProgressEffect || occurrence.definition === options.progress) {
								await reports.emit(ctx, occurrence as effect.EffectOccurrence<typeof ProgressEffect | Progress>);
							} else {
								if (options.emitter === undefined) throw new effect.MissingEffectEmitterError();
								await options.emitter.emit(ctx, occurrence);
							}
						},
					},
				},
			});
			const taskCtx = context.view(capabilities, {
				checkpoint: async () => {
					// Check cancellation on both sides of the pause wait. Aborting a paused
					// task opens the gate, but must not allow its next business operation.
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
			await taskCtx.checkpoint();
			value = await run(taskCtx);
			context.check(owner);
		} catch (error) {
			workFailed = true;
			workError = error;
			status = owner.signal.aborted ? 'cancelled' : 'failed';
		}
		// Stop pause/resume transitions before cleanup starts. done still waits for
		// cleanup, and a cleanup failure can replace the visible terminal status.
		terminal = true;
		observed.resolve();
		resumed.resolve();
		try {
			await owner[asyncDispose]();
		} catch (cleanup) {
			status = 'failed';
			reports.close();
			if (workFailed) throw new SuppressedError(cleanup, workError, 'Task work failed and cleanup also failed.');
			throw cleanup;
		}
		reports.close();
		if (workFailed) throw workError;
		status = 'completed';
		return value;
	})();

	return Object.freeze({
		done,
		updates: reports.events,
		get progress() {
			return reports.latest;
		},
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
		/**
		 * Request cooperative cancellation and wait for cleanup. The done promise still carries the
		 * operation's value or failure.
		 */
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
		async [asyncDispose]() {
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
