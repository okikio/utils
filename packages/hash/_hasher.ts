/** Stateful digest ownership shared by optional algorithm families. @module */
/**
 * One calculation built from successive byte chunks, such as pieces of an upload.
 * update() extends the same calculation; digest() finishes it and returns bytes.
 * The object is mutable, so concurrent consumers must use separate instances.
 */
export interface HasherType {
	/** Consume the visible bytes immediately without retaining caller storage. */
	update(input: Uint8Array): this;
	/** Finalize once and release provider state. Further use throws. */
	digest(): Uint8Array;
	/** Fork an independent state before finalization. */
	clone(): HasherType;
	/** Release unfinished state. Repeated disposal is harmless. */
	destroy(): void;
}
/** Minimal maintained-provider contract; no provider internals escape the package. */
export interface StateType {
	/** Feed bytes synchronously. */
	update(input: Uint8Array): StateType;
	/** Finalize into owned output. */
	digest(): Uint8Array;
	/** Copy live provider state. */
	clone(): StateType;
	/** Clear mutable provider memory. JavaScript cannot promise complete erasure. */
	destroy(): void;
}
/** Wrap provider state with one terminal-state rule across all algorithms. */
export function wrap(state: StateType): HasherType {
	/** A terminal wrapper never delegates into disposed provider memory. */
	let closed = false;
	/** Guard every operation that needs live state. */
	const assert = (): void => {
		if (closed) throw new Error('Hasher is finalized or destroyed.');
	};
	return {
		update(input) {
			assert();
			state.update(input);
			return this;
		},
		digest() {
			assert();
			// Mark terminal before calling the provider: even a failed digest cannot be retried.
			closed = true;
			try {
				return state.digest();
			} finally {
				state.destroy();
			}
		},
		clone() {
			assert();
			return wrap(state.clone());
		},
		destroy() {
			if (!closed) {
				closed = true;
				state.destroy();
			}
		},
	};
}
