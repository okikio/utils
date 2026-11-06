/** Incremental native UTF-8 conversion with explicit input bounds and source cleanup. @module */
import { iterable } from './mod.ts';
import type { ReaderOptions } from './reader.ts';

/** Native UTF-8 decoding policy. BOM handling follows TextDecoder's ignoreBOM option. */
export interface DecodeOptionsType extends ReaderOptions {
	readonly maximumBytes: number;
	readonly maximumChunkBytes: number;
	readonly fatal: boolean;
	/** False strips the initial BOM, true preserves it. Only the initial BOM is special. */
	readonly ignoreBOM: boolean;
}
/** Decode each admitted chunk incrementally; incomplete UTF-8 is resolved by fatal policy at successful EOF. */
export async function* decode(source: ReadableStream<Uint8Array>, options: DecodeOptionsType): AsyncGenerator<string> {
	for (const value of [options.maximumBytes, options.maximumChunkBytes]) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new RangeError('Text byte bounds must be non-negative safe integers.');
		}
	}
	if (typeof options.fatal !== 'boolean' || typeof options.ignoreBOM !== 'boolean') {
		throw new TypeError('Explicit fatal and BOM policies are required.');
	}
	const decoder = new TextDecoder('utf-8', { fatal: options.fatal, ignoreBOM: options.ignoreBOM });
	let total = 0;
	for await (const chunk of iterable(source, options)) {
		if (!(chunk instanceof Uint8Array)) throw new TypeError('UTF-8 input requires Uint8Array chunks.');
		if (chunk.length > options.maximumChunkBytes || chunk.length > options.maximumBytes - total) {
			throw new RangeError('UTF-8 input exceeds its byte policy.');
		}
		total += chunk.length;
		const text = decoder.decode(chunk, { stream: true });
		if (text.length) yield text;
	}
	const final = decoder.decode();
	if (final.length) yield final;
}

/**
 * Encode UTF-16 chunks with native TextEncoder while retaining at most one trailing high surrogate.
 * A surrogate pair split across chunks encodes identically to one complete string; unmatched EOF uses replacement.
 * Limits bound accepted output, not the temporary native encoding allocation.
 */
export async function* encode(
	source: ReadableStream<string>,
	options: ReaderOptions & Readonly<{ readonly maximumBytes: number; readonly maximumChunkCodeUnits: number }>,
): AsyncGenerator<Uint8Array> {
	for (const value of [options.maximumBytes, options.maximumChunkCodeUnits]) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new RangeError('Text encoding limits must be non-negative safe integers.');
		}
	}
	const encoder = new TextEncoder();
	let pending = '';
	let total = 0;
	/** Charge encoded bytes, including a carried surrogate, before exposing this chunk. */
	const accepted = (text: string): Uint8Array => {
		const bytes = encoder.encode(text);
		if (bytes.length > options.maximumBytes - total) throw new RangeError('Text output exceeds maximumBytes.');
		total += bytes.length;
		return bytes;
	};
	for await (const text of iterable(source, options)) {
		if (typeof text !== 'string') throw new TypeError('Text encoding requires strings.');
		if (text.length > options.maximumChunkCodeUnits) throw new RangeError('Text exceeds maximumChunkCodeUnits.');
		const combined = pending + text;
		const last = combined.charCodeAt(combined.length - 1);
		const incomplete = last >= 0xd800 && last <= 0xdbff;
		pending = incomplete ? combined.slice(-1) : '';
		const bytes = accepted(incomplete ? combined.slice(0, -1) : combined);
		if (bytes.length) yield bytes;
	}
	if (pending) yield accepted(pending);
}
