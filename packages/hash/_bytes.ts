/** Exact-range admission shared by hash operations. @module */
/** Text is encoded as UTF-8; views include only their visible bytes. */
export type InputType = string | ArrayBufferLike | ArrayBufferView<ArrayBufferLike>;
/** Copy before an asynchronous boundary so later caller mutations cannot change the payload. */
export function copy(input: InputType): Uint8Array<ArrayBuffer> {
	if (typeof input === 'string') return new TextEncoder().encode(input);
	return Uint8Array.from(
		ArrayBuffer.isView(input)
			? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
			: new Uint8Array(input),
	);
}
