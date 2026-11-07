import { Reducer } from './reducer.ts';
import { Scope } from './scope.ts';
import { Pause } from './pause.ts';
import { causeFromError } from './operation.ts';
import type { BranchView, Cause, ChildHandle, Exit, Step, StepExit, Supervision, WorkflowOperation } from './kernel.ts';

/** Error used when ordinary generator finally code yields a Step during unwind. */
export class CleanupStepError extends Error {
	readonly step: Step<unknown>;

	constructor(step: Step<unknown>) {
		super('Workflow generator cleanup blocks must not yield Steps. Register asynchronous cleanup on the branch scope.');
		this.name = 'CleanupStepError';
		this.step = step;
	}
}

/**
 * Owns one live iterator, its active Step, cancellation, and child Scope.
 *
 * ```text
 * ready -> running -> waiting -> ready ... -> closing -> terminal
 *                     |
 * cancellation -------+
 *                     v
 *              abort branch signal
 *                     |
 *              discard active Step
 *                     |
 *              wait for discard done
 *                     |
 *               iterator.return()
 *                     |
 *                 close Scope
 * ```
 */
export class Branch<Value> implements BranchView {
	/** Cancellation request for this branch. Observe the result to know when cleanup has joined. */
	readonly signal: AbortSignal;
	/** Owns nested branches and disposables until this branch exits. */
	readonly scope = new Scope();
	readonly #controller = new AbortController();
	readonly #iterator: Generator<Step<unknown>, Value, Exit<unknown>>;
	readonly #reducer: Reducer;
	readonly #pause: Pause;
	readonly #result: Promise<Exit<Value>>;
	#resolveResult!: (exit: Exit<Value>) => void;
	/** Discard callback for the currently waiting step, cleared before another step enters. */
	#activeExit: StepExit | undefined;
	#state: 'ready' | 'running' | 'waiting' | 'closing' | 'terminal' = 'ready';
	#cancelReason: unknown;
	/** The requested reason may be undefined, so presence is tracked independently. */
	#cancelRequested = false;
	/** Block duplicate discard requests while the current step acknowledges cleanup. */
	#discarding = false;
	#started = false;

	constructor(operation: WorkflowOperation<Value>, reducer = new Reducer(), pause = new Pause()) {
		this.#iterator = operation[Symbol.iterator]();
		this.#reducer = reducer;
		this.#pause = pause;
		this.signal = this.#controller.signal;
		this.#result = new Promise((resolve) => this.#resolveResult = resolve);
	}

	/** Start the branch exactly once and return its terminal Exit. */
	start(): Promise<Exit<Value>> {
		if (this.#started) return this.#result;
		this.#started = true;
		this.#reducer.enqueue(() => this.#advance(undefined));
		return this.#result;
	}

	/** Request cancellation and resolve only after active work and scope cleanup stop. */
	async cancel(reason: unknown): Promise<void> {
		if (this.#state === 'terminal') return;
		if (!this.#cancelRequested) {
			this.#cancelRequested = true;
			this.#cancelReason = reason;
			this.#controller.abort(reason);
		}
		this.#reducer.enqueue(() => this.#beginCancellation(), 'critical');
		await this.#result;
	}

	/** Resolve when the branch becomes terminal. */
	async settled(): Promise<void> {
		await this.#result;
	}

	/** Return the branch terminal Exit. */
	result(): Promise<Exit<Value>> {
		return this.#result;
	}

	/** Whether this execution tree is cooperatively paused. */
	get paused(): boolean {
		return this.#pause.paused;
	}

	/** Pause this execution tree at its next explicit checkpoint. */
	pause(): void {
		if (this.#state === 'terminal' || this.#state === 'closing') return;
		this.#pause.pause();
	}

	/** Resume every branch waiting at a cooperative checkpoint. */
	resume(): void {
		this.#pause.resume();
	}

	/** Wait at a cooperative checkpoint owned by this execution tree. */
	checkpoint(): Promise<void> {
		return this.#pause.checkpoint(this.signal);
	}

	/** Register asynchronous cleanup on this branch Scope. */
	defer(dispose: () => void | PromiseLike<void>): void {
		this.scope.defer(dispose);
	}

	/**
	 * Create an owned child that shares this branch reducer and Scope.
	 *
	 * `fail-fast` raises an unhandled child failure into the owner. `collect`
	 * and `isolate` leave the terminal Exit on the returned handle so a
	 * combinator or explicit owner can decide what to do with it. All modes
	 * still keep the child inside this Scope; none creates detached work.
	 */
	spawn<ChildValue>(operation: WorkflowOperation<ChildValue>, supervision: Supervision): ChildHandle<ChildValue> {
		const child = new Branch(operation, this.#reducer, this.#pause);
		this.scope.addChild(child);
		void child.start().then((exit) => {
			if (supervision === 'fail-fast' && exit.type === 'failure') {
				this.#reducer.enqueue(() => this.#beginFailure(exit.cause), 'critical');
			}
		});
		return child;
	}

	/** Advance the iterator once, then retain one active Step discard function until its callback queues the next transition. */
	#advance(resume: Exit<unknown> | undefined): void {
		if (this.#state === 'terminal' || this.#state === 'closing') return;
		if (this.#cancelRequested) return this.#beginCancellation();
		this.#state = 'running';
		let next: IteratorResult<Step<unknown>, Value>;
		try {
			next = resume === undefined ? this.#iterator.next() : this.#iterator.next(resume);
		} catch (error) {
			return void this.#close(causeFromError(error));
		}
		if (next.done) return void this.#closeSuccess(next.value);
		this.#state = 'waiting';
		let resolved = false;
		try {
			this.#activeExit = next.value.enter((exit) => {
				if (resolved) return;
				resolved = true;
				this.#reducer.enqueue(() => {
					this.#activeExit = undefined;
					if (this.#cancelRequested) this.#beginCancellation();
					else this.#advance(exit);
				});
			}, this);
		} catch (error) {
			this.#activeExit = undefined;
			this.#reducer.enqueue(() => this.#close(Object.freeze({ type: 'failure', failure: error })));
		}
	}

	/** Discard the active Step and wait for its acknowledgement before running generator cleanup. */
	#beginCancellation(): void {
		if (this.#state === 'terminal' || this.#state === 'closing' || this.#discarding) return;
		const activeExit = this.#activeExit;
		if (activeExit !== undefined) {
			this.#discarding = true;
			try {
				activeExit((discardExit) =>
					this.#reducer.enqueue(() => {
						this.#discarding = false;
						this.#activeExit = undefined;
						this.#unwind(discardExit.type === 'failure' ? discardExit.cause : undefined);
					})
				);
			} catch (failure) {
				this.#discarding = false;
				this.#activeExit = undefined;
				this.#unwind(Object.freeze({ type: 'failure', failure }));
			}
			return;
		}
		this.#unwind();
	}

	/**
	 * Raise an unhandled child failure into this branch without converting the
	 * failure into a cancellation cause.
	 *
	 * The active Step still gets its discard handshake first. After that, the
	 * generator enters return-mode and the original child cause remains the
	 * primary terminal cause for this owner.
	 */
	#beginFailure(cause: Cause): void {
		if (this.#state === 'terminal' || this.#state === 'closing' || this.#discarding) return;
		this.#controller.abort(cause);
		const activeExit = this.#activeExit;
		if (activeExit !== undefined) {
			this.#discarding = true;
			try {
				activeExit((discardExit) =>
					this.#reducer.enqueue(() => {
						this.#discarding = false;
						this.#activeExit = undefined;
						this.#unwindFailure(cause, discardExit.type === 'failure' ? discardExit.cause : undefined);
					})
				);
			} catch (failure) {
				this.#discarding = false;
				this.#activeExit = undefined;
				this.#unwindFailure(cause, Object.freeze({ type: 'failure', failure }));
			}
			return;
		}
		this.#unwindFailure(cause);
	}

	/** Enter generator return-mode after cancellation; retain discard, generator and scope failures alongside the cancellation. */
	#unwind(discardCause?: Cause): void {
		if (this.#state === 'terminal' || this.#state === 'closing') return;
		this.#state = 'closing';
		// A thrown undefined is still a failure; keep presence separate from its value.
		let hasUnwindFailure = false;
		let unwindFailure: unknown;
		try {
			const step = this.#iterator.return?.(undefined as never);
			if (step !== undefined && !step.done) {
				hasUnwindFailure = true;
				unwindFailure = new CleanupStepError(step.value);
			}
		} catch (error) {
			hasUnwindFailure = true;
			unwindFailure = error;
		}
		const cancellation = Object.freeze({ type: 'cancelled', reason: this.#cancelReason } satisfies Cause);
		void this.scope.close(this.#cancelReason).then((cleanupCauses) => {
			const causes: Cause[] = [cancellation];
			if (discardCause !== undefined) causes.push(discardCause);
			if (hasUnwindFailure) causes.push(Object.freeze({ type: 'failure', failure: unwindFailure }));
			causes.push(...cleanupCauses);
			this.#settleFailure(
				causes.length === 1 ? causes[0]! : Object.freeze({ type: 'multiple', causes: Object.freeze(causes) }),
			);
		});
	}

	/** Unwind after a child failure, preserving that primary cause while appending discard and scope cleanup failures. */
	#unwindFailure(cause: Cause, discardCause?: Cause): void {
		if (this.#state === 'terminal' || this.#state === 'closing') return;
		this.#state = 'closing';
		// A thrown undefined is still a failure; keep presence separate from its value.
		let hasUnwindFailure = false;
		let unwindFailure: unknown;
		try {
			const step = this.#iterator.return?.(undefined as never);
			if (step !== undefined && !step.done) {
				hasUnwindFailure = true;
				unwindFailure = new CleanupStepError(step.value);
			}
		} catch (error) {
			hasUnwindFailure = true;
			unwindFailure = error;
		}
		void this.scope.close(cause).then((cleanupCauses) => {
			const causes: Cause[] = [cause];
			if (discardCause !== undefined) causes.push(discardCause);
			if (hasUnwindFailure) causes.push(Object.freeze({ type: 'failure', failure: unwindFailure }));
			causes.push(...cleanupCauses);
			this.#settleFailure(
				causes.length === 1 ? causes[0]! : Object.freeze({ type: 'multiple', causes: Object.freeze(causes) }),
			);
		});
	}

	/** Join children and dispose resources before publishing success. Any required cleanup failure replaces success. */
	#closeSuccess(value: Value): void {
		if (this.#state === 'terminal' || this.#state === 'closing') return;
		this.#state = 'closing';
		void this.scope.close(undefined).then((cleanupCauses) => {
			if (cleanupCauses.length === 0) this.#settle(Object.freeze({ type: 'success', value }));
			else {this.#settleFailure(
					cleanupCauses.length === 1 ? cleanupCauses[0]! : Object.freeze({ type: 'multiple', causes: cleanupCauses }),
				);}
		});
	}

	/** Close the scope after a generator defect; retain its cause before any cleanup failures. */
	#close(cause: Cause): void {
		if (this.#state === 'terminal' || this.#state === 'closing') return;
		this.#state = 'closing';
		void this.scope.close(cause).then((cleanupCauses) => {
			const causes = cleanupCauses.length === 0 ? [cause] : [cause, ...cleanupCauses];
			this.#settleFailure(
				causes.length === 1 ? causes[0]! : Object.freeze({ type: 'multiple', causes: Object.freeze(causes) }),
			);
		});
	}

	/** Publish a structured failure after the caller has completed scope cleanup. */
	#settleFailure(cause: Cause): void {
		this.#settle(Object.freeze({ type: 'failure', cause }));
	}

	/** Resolve the shared result once and mark the branch terminal before notifying observers. */
	#settle(exit: Exit<Value>): void {
		if (this.#state === 'terminal') return;
		this.#state = 'terminal';
		this.#resolveResult(exit);
	}
}
