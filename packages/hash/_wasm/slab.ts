/**
 * Short outputs share one backing buffer, as Node.js `Buffer` pools do.
 *
 * Deno keeps every typed array's bytes outside the JavaScript heap, so `new Uint8Array(32)` costs about 800 ns there,
 * against about 25 ns in Node.js and Bun, which keep arrays of up to 64 bytes on the heap. For a 64-byte input that
 * allocation was most of the call. An output of up to 64 bytes is therefore copied into an 8 KiB slab and returned as
 * a view; a full slab is replaced, never reused, so no two outputs overlap.
 *
 * The cost is that such an output's `buffer` is larger than the output and is shared with other outputs. Copy it with
 * `slice()` before transferring its buffer or handing `buffer` to code that assumes it holds only this output.
 *
 * @module
 */

const SIZE = 8192;
/** The largest output that goes into a slab. */
export const SHORT = 64;

let slab = new Uint8Array(SIZE);
let used = 0;

/** A copy of `source`: a view into the current slab when it is short, else a new array. */
export function output(source: Uint8Array): Uint8Array {
	const length = source.length;
	if (length > SHORT) return source.slice();
	if (used + length > SIZE) {
		slab = new Uint8Array(SIZE);
		used = 0;
	}
	const out = slab.subarray(used, used += length);
	out.set(source);
	return out;
}
