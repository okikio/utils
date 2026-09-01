/**
 * Shared cooperative pause gate for one live workflow execution tree.
 *
 * Pausing never interrupts an active Promise, stream read, callback, or other
 * indivisible operation. Work stops only when code reaches an explicit
 * checkpoint. Child branches share the same gate, so one execution has one
 * pause state even when it owns several concurrent branches.
 *
 * @internal
 */
export class Pause {
	#paused = false;
	#gate: Promise<void> | undefined;
	#release: (() => void) | undefined;

	/** Whether the execution is currently paused. */
	get paused(): boolean {
		return this.#paused;
	}

	/** Prevent future checkpoints from passing until {@link resume} is called. */
	pause(): void {
		if (this.#paused) return;
		this.#paused = true;
		this.#gate = new Promise<void>((resolve) => this.#release = resolve);
	}

	/** Release every checkpoint currently waiting on this pause generation. */
	resume(): void {
		if (!this.#paused) return;
		this.#paused = false;
		const release = this.#release;
		this.#release = undefined;
		this.#gate = undefined;
		release?.();
	}

	/**
	 * Wait until the execution is not paused.
	 *
	 * The branch signal remains authoritative. Cancellation rejects a paused
	 * checkpoint immediately and removes its abort listener instead of waiting
	 * for an unrelated future resume.
	 */
	async checkpoint(signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		while (this.#paused) {
			const gate = this.#gate;
			if (gate === undefined) continue;
			await waitForGate(gate, signal);
			signal.throwIfAborted();
		}
	}
}

/** Wait for one pause generation without leaking an abort listener. */
function waitForGate(gate: Promise<void>, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<void>((resolve, reject) => {
		const onAbort = () => {
			cleanup();
			reject(signal.reason);
		};
		const cleanup = () => signal.removeEventListener('abort', onAbort);
		signal.addEventListener('abort', onAbort, { once: true });
		void gate.then(
			() => {
				cleanup();
				resolve();
			},
			(error) => {
				cleanup();
				reject(error);
			},
		);
	});
}
