/**
 * A group owns bounded local admission and joins child Task cleanup; it is not a durable work queue.
 * @module
 */
import * as context from '@okikio/context';
import * as capacity from '@okikio/scheduler/capacity';
import { start } from './mod.ts';
import type { Task, TaskContext, TaskOptions } from './types.ts';

/** Constant-space terminal counters; child Task.done retains each exact result independently. */
export interface GroupSummaryType {
	/** Children whose ordinary Task handle was created. */
	readonly started: number;
	/** Children whose done resolved after cleanup. */
	readonly completed: number;
	/** Children whose done rejected, including cancellation or cleanup failure. */
	readonly failed: number;
	/**
	 * Group cancellation was requested; does not assert that every child stopped before its operation
	 * completed.
	 */
	readonly cancelled: boolean;
}
/** Group ownership does not replace individual Task result or cooperative pause authority. */
export interface Group extends AsyncDisposable {
	/** Settles only after admission is closed and every accepted start and child cleanup has settled. */
	readonly done: Promise<GroupSummaryType>;
	/**
	 * Await admission, then return a normal Task. Over-capacity and closed admission reject before
	 * retaining work.
	 */
	start<Value>(
		run: (ctx: TaskContext) => Value | Promise<Value>,
		options?: Omit<TaskOptions, 'ctx'>,
	): Promise<Task<Value>>;
	/** Stop new starts and drain already admitted/queued starts without cancelling them. */
	close(): Promise<GroupSummaryType>;
	/** Stop admission, cancel queued/active work cooperatively and join every child. */
	cancel(reason?: unknown): Promise<GroupSummaryType>;
	/**
	 * Current admission and completion counters; no child handles, payloads or error history are retained
	 * here.
	 */
	stats(): Readonly<
		GroupSummaryType & {
			readonly state: 'active' | 'closing' | 'closed';
			readonly pending: number;
			readonly active: number;
		}
	>;
}
/** Expected admission rejection; work has not started or been retained in the group's queue. */
export class GroupAdmissionError extends Error {
	constructor() {
		super('Task group admission is closed or full.');
		this.name = 'GroupAdmissionError';
	}
}

/**
 * Create a local group whose owner must close admission when no more starts are needed.
 * maximumWaiting counts calls awaiting a slot, not all children ever run. A slot
 * stays occupied through child cleanup, so concurrency includes cleanup work.
 *
 * In fail-fast mode, the first child rejection cancels siblings and rejects done
 * after all cleanup. Settled mode leaves failures on each Task.done and resolves
 * counters after close(). Keep and observe returned handles for per-child outcomes;
 * the group retains counters rather than a result array.
 */
export function create(
	options: Readonly<{
		/** Borrowed parent lifetime; the group owns its child context. */
		readonly ctx: context.Context;
		/** Maximum admitted child tasks, including their cleanup. */
		readonly concurrency: number;
		/** Maximum additional calls waiting for admission. Zero disables waiting. */
		readonly maximumWaiting: number;
		/** Whether one child failure cancels siblings or remains on individual child results. */
		readonly mode: 'fail-fast' | 'settled';
	}>,
): Group {
	if (
		!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 ||
		!Number.isSafeInteger(options.maximumWaiting) || options.maximumWaiting < 0 ||
		options.concurrency + options.maximumWaiting > Number.MAX_SAFE_INTEGER ||
		!['fail-fast', 'settled'].includes(options.mode)
	) throw new RangeError('Invalid task group admission or failure policy.');
	context.check(options.ctx);
	const concurrency = options.concurrency;
	const maximumWaiting = options.maximumWaiting;
	const mode = options.mode;
	const owner = context.child(options.ctx);
	const admission = capacity.create({ task: concurrency }, { maximumPending: maximumWaiting });
	const completion = Promise.withResolvers<GroupSummaryType>();
	// The group owns this terminal result even before the caller subscribes to it.
	void completion.promise.catch(() => undefined);
	let state: 'active' | 'closing' | 'closed' = 'active';
	let accepted = 0;
	let active = 0;
	let started = 0;
	let completed = 0;
	let failed = 0;
	let cancelled = false;
	/**
	 * Box preserves rejection with undefined and keeps one first-failure authority, never an unbounded
	 * history.
	 */
	let failure: { readonly error: unknown } | undefined;
	/** Publish before owner cleanup, which can synchronously reenter the abort listener. */
	let finishing = false;
	const summary = (): GroupSummaryType => Object.freeze({ started, completed, failed, cancelled });
	/** Only this transition disposes the group context; accepted children retain their slot through Task.done. */
	const finish = (): void => {
		if (state !== 'closing' || accepted !== 0 || finishing) return;
		finishing = true;
		void (async () => {
			try {
				await owner[Symbol.asyncDispose]();
				if (failure !== undefined) throw failure.error;
				completion.resolve(summary());
			} catch (error) {
				completion.reject(error);
			} finally {
				state = 'closed';
			}
		})();
	};
	/** Seal before abort dispatch so reentrant start calls cannot retain another operation. */
	const stop = (reason: unknown): void => {
		if (finishing || state === 'closed') return;
		state = 'closing';
		cancelled = true;
		if (mode === 'fail-fast') failure ??= { error: reason };
		context.cancel(owner, reason);
		finish();
	};
	const abort = (): void => stop(owner.signal.reason);
	owner.signal.addEventListener('abort', abort, { once: true });
	owner.defer(() => owner.signal.removeEventListener('abort', abort));
	if (owner.signal.aborted) abort();
	return Object.freeze({
		done: completion.promise,
		/**
		 * Reserve a bounded group admission before creating a child task.
		 * The returned child owns its operation; the group retains its capacity until that child and its cleanup finish.
		 */
		async start<Value>(
			run: (ctx: TaskContext) => Value | Promise<Value>,
			taskOptions: Omit<TaskOptions, 'ctx'> = {},
		): Promise<Task<Value>> {
			if (state !== 'active' || owner.signal.aborted || accepted >= concurrency + maximumWaiting) {
				throw new GroupAdmissionError();
			}
			if (typeof run !== 'function') throw new TypeError('Task group requires an operation.');
			accepted++;
			let slot: Awaited<ReturnType<typeof capacity.acquire>> | undefined;
			let handed = false;
			try {
				slot = await capacity.acquire(admission, { task: 1 }, owner.signal);
				owner.signal.throwIfAborted();
				const child = start<Value, never, never>(run, { ...taskOptions, ctx: owner });
				started++;
				active++;
				handed = true;
				const lease = slot;
				/** Observe exact child settlement while keeping rejection authority on the original Task.done. */
				void (async () => {
					try {
						await child.done;
						completed++;
					} catch (error) {
						failed++;
						if (mode === 'fail-fast') {
							failure ??= { error };
							stop(error);
						}
					} finally {
						active--;
						accepted--;
						lease.release();
						finish();
					}
				})();
				return child;
			} finally {
				if (!handed) {
					accepted--;
					slot?.release();
					finish();
				}
			}
		},
		close() {
			if (state === 'active') state = 'closing';
			finish();
			return completion.promise;
		},
		cancel(reason: unknown = new Error('Task group cancelled.')) {
			stop(reason);
			return completion.promise;
		},
		stats() {
			return Object.freeze({ ...summary(), state, pending: accepted - active, active });
		},
		async [Symbol.asyncDispose]() {
			await this.cancel(new Error('Task group disposed.'));
		},
	});
}
