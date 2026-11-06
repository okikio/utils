/** Bounded streaming digests with explicit reader and hasher ownership. @module */
import { open } from '@okikio/streams/reader';
import type { ReaderOptions as ReaderOptionsType } from '@okikio/streams/reader';
export type { CleanupOutcome as CleanupOutcomeType, ReaderOptions as ReaderOptionsType } from '@okikio/streams/reader';
export type { AlgorithmType } from './digest.ts';
export type { HasherType } from './_hasher.ts';
import { create } from './sync.ts';
import type { AlgorithmType } from './digest.ts';
import type { HasherType } from './_hasher.ts';
/** Resource and source cancellation policy for one streaming digest. */
export interface OptionsType extends ReaderOptionsType {
	/** Inclusive byte ceiling. Required, finite, nonnegative and a safe integer. */
	readonly maximumBytes: number;
}
/**
 * Hash chunks without retaining the complete input. The source must yield bytes.
 * A factory supports optional families without eagerly importing them. Its fresh
 * state transfers to this call and is always destroyed. Errors or abort cancel
 * the source unless preventCancel is set. Cleanup remains inspectable through
 * onCleanup; a hanging cancel hook never delays rejection or lock release.
 * The byte ceiling limits admitted data, not allocations made by the source.
 */
export async function read(
	algorithm: AlgorithmType | (() => HasherType),
	source: ReadableStream<Uint8Array>,
	options: OptionsType,
): Promise<Uint8Array> {
	// Snapshot policy before awaiting source reads; caller mutation must not
	// raise the admitted byte ceiling or replace cancellation ownership.
	const { maximumBytes, signal, preventCancel, onCleanup } = options;
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
		throw new RangeError('maximumBytes must be a nonnegative safe integer.');
	}
	signal?.throwIfAborted();
	const state = typeof algorithm === 'function' ? algorithm() : create(algorithm);
	try {
		const reader = open(source, { signal, preventCancel, onCleanup });
		try {
			let total = 0;
			for (;;) {
				const chunk = await reader.read();
				if (chunk.done) return state.digest();
				if (!(chunk.value instanceof Uint8Array)) throw new TypeError('Digest streams must yield Uint8Array chunks.');
				if (chunk.value.byteLength > maximumBytes - total) {
					throw new RangeError('Digest input exceeds maximumBytes.');
				}
				total += chunk.value.byteLength;
				state.update(chunk.value);
			}
		} catch (error) {
			void reader.close(error);
			throw error;
		}
	} finally {
		state.destroy();
	}
}
