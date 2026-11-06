/** Bounded binary materialization through the shared reader lifetime. @module */
import * as readers from './reader.ts';
import type { ReaderOptions } from './reader.ts';

/**
 * Read bounded bytes and release the reader lock on every exit. Source cancellation
 * may continue after an abort; options.onCleanup receives its eventual outcome.
 */
export async function bytes(
	source: ReadableStream<Uint8Array>,
	maximumBytes: number,
	options: AbortSignal | ReaderOptions = {},
): Promise<Uint8Array> {
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
		throw new RangeError('Stream maximumBytes must be a non-negative safe integer.');
	}
	const settings: ReaderOptions = 'aborted' in options ? { signal: options } : options;
	const reader = readers.open(source, settings);
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			if (!(next.value instanceof Uint8Array)) throw new TypeError('Binary streams require Uint8Array chunks.');
			total += next.value.byteLength;
			if (total > maximumBytes) throw new RangeError(`Stream exceeds ${maximumBytes} bytes.`);
			// Snapshot borrowed chunks: a producer may reuse its buffer after the next read.
			chunks.push(next.value.slice());
		}
	} finally {
		void reader.close('Binary stream read ended.');
	}
	const value = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		value.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return value;
}

/**
 * Emit owned fixed-size byte arrays through the framing implementation. The incomplete policy
 * either emits or rejects a final short array; framing also owns bounds and reader cleanup.
 */
export async function* rechunk(
	source: ReadableStream<Uint8Array>,
	size: number,
	options: import('./frame.ts').FrameOptionsType,
): AsyncGenerator<Uint8Array> {
	const { fixed } = await import('./frame.ts');
	yield* fixed(source, size, options);
}
