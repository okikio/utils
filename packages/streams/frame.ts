/** Bounded byte framing over the existing reader lifetime. Output frames own their bytes. @module */
import { iterable } from './mod.ts';
import type { ReaderOptions } from './reader.ts';

/** Independent total, incoming-chunk and retained-frame limits. All values count bytes. */
export interface FrameOptionsType extends ReaderOptions {
	/** Maximum total admitted source bytes, including delimiters and incomplete frames. */
	readonly maximumBytes: number;
	/** Reject an oversized provider chunk before buffering it. The provider still owns its original allocation. */
	readonly maximumChunkBytes: number;
	/** Maximum retained content bytes for one output frame; split excludes the delimiter. */
	readonly maximumFrameBytes: number;
	/** Emit the final incomplete frame or reject it. Empty EOF never adds a trailing empty frame. */
	readonly incomplete: 'emit' | 'reject';
}

/** Validate policy before acquiring the source. A provider's existing allocation is not a reader heap guarantee. */
function limits(options: FrameOptionsType): void {
	for (const name of ['maximumBytes', 'maximumChunkBytes', 'maximumFrameBytes'] as const) {
		if (!Number.isSafeInteger(options[name]) || options[name] < 0) {
			throw new RangeError(`${name} must be a non-negative safe integer.`);
		}
	}
	if (!['emit', 'reject'].includes(options.incomplete)) throw new TypeError('An incomplete-frame policy is required.');
}

/** Enforce chunk and total limits without reading ahead of the consumer. */
async function* chunks(source: ReadableStream<Uint8Array>, options: FrameOptionsType): AsyncGenerator<Uint8Array> {
	let total = 0;
	for await (const chunk of iterable(source, options)) {
		if (!(chunk instanceof Uint8Array)) throw new TypeError('Framing requires Uint8Array chunks.');
		if (chunk.byteLength > options.maximumChunkBytes) throw new RangeError('Source chunk exceeds maximumChunkBytes.');
		if (chunk.byteLength > options.maximumBytes - total) throw new RangeError('Source exceeds maximumBytes.');
		total += chunk.byteLength;
		yield chunk;
	}
}

/**
 * Split non-overlapping delimiters, excluding them from newly owned output frames.
 * A prefix table remembers partial delimiter matches, avoiding a rescan when
 * a delimiter repeats its own prefix (the KMP matching algorithm).
 * Carry is at most maximumFrameBytes + delimiter.length; no source read occurs while a frame is yielded.
 * Early exit releases the source lock promptly; onCleanup retains eventual cancellation outcome.
 */
export async function* split(
	source: ReadableStream<Uint8Array>,
	delimiter: Uint8Array,
	options: FrameOptionsType,
): AsyncGenerator<Uint8Array> {
	limits(options);
	if (!(delimiter instanceof Uint8Array) || delimiter.length === 0 || delimiter.length > options.maximumChunkBytes) {
		throw new RangeError('Delimiter must be nonempty and fit maximumChunkBytes.');
	}
	const separator = delimiter.slice();
	if (!Number.isSafeInteger(options.maximumFrameBytes + separator.length)) {
		throw new RangeError('Frame and delimiter limit is too large.');
	}
	const carry = new Uint8Array(options.maximumFrameBytes + separator.length);
	/** Prefix lengths permit fallback without rescanning bytes already admitted to carry. */
	const prefix = new Uint32Array(separator.length);
	for (let index = 1, length = 0; index < separator.length; index++) {
		while (length > 0 && separator[index] !== separator[length]) length = prefix[length - 1]!;
		if (separator[index] === separator[length]) length++;
		prefix[index] = length;
	}
	/** Bytes carried for the current frame, including a possible unfinished delimiter. */
	let length = 0;
	/** Delimiter prefix currently matched at the end of carry; never re-read source bytes. */
	let matched = 0;
	for await (const chunk of chunks(source, options)) {
		for (const byte of chunk) {
			carry[length++] = byte;
			// Reuse the longest matching suffix after a mismatch instead of rescanning retained bytes.
			while (matched > 0 && byte !== separator[matched]) matched = prefix[matched - 1]!;
			if (byte === separator[matched]) matched++;
			if (length - matched > options.maximumFrameBytes) throw new RangeError('Frame exceeds maximumFrameBytes.');
			if (matched === separator.length) {
				yield carry.slice(0, length - matched);
				length = 0;
				matched = 0;
			}
		}
	}
	if (length > 0) {
		if (length > options.maximumFrameBytes) throw new RangeError('Final frame exceeds maximumFrameBytes.');
		if (options.incomplete === 'reject') throw new SyntaxError('Source ended before its frame delimiter.');
		yield carry.slice(0, length);
	}
}

/** Emit owned fixed-size frames. The final short frame follows the explicit incomplete policy. */
export async function* fixed(
	source: ReadableStream<Uint8Array>,
	size: number,
	options: FrameOptionsType,
): AsyncGenerator<Uint8Array> {
	limits(options);
	if (!Number.isSafeInteger(size) || size < 1 || size > options.maximumFrameBytes) {
		throw new RangeError('Frame size must be positive and fit maximumFrameBytes.');
	}
	let carry = new Uint8Array(size);
	let used = 0;
	for await (const chunk of chunks(source, options)) {
		let offset = 0;
		while (offset < chunk.length) {
			const count = Math.min(size - used, chunk.length - offset);
			carry.set(chunk.subarray(offset, offset + count), used);
			used += count;
			offset += count;
			if (used === size) {
				// Transfer this buffer to the consumer; the next frame must use a new allocation.
				yield carry;
				carry = new Uint8Array(size);
				used = 0;
			}
		}
	}
	if (used > 0) {
		if (options.incomplete === 'reject') throw new SyntaxError('Source ended inside a fixed-size frame.');
		yield carry.slice(0, used);
	}
}
