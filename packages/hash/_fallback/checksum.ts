/**
 * How the `checksum` family runs outside WebAssembly: native CRC-32 through `node:zlib`, and pure JavaScript states.
 *
 * `zlib.crc32()` (Node 22.2 and later, Deno and Bun) uses the CPU's carry-less multiply and runs at 5 to 90 GB/s,
 * against about 2.5 GB/s for the WebAssembly module, which has no such instruction. It is looked up on first use
 * through `process.getBuiltinModule()`, so importing this file loads nothing and a browser simply has no native path.
 *
 * @module
 */
import { crc, polynomials } from '../_crc32.ts';
import type { FallbackType } from '../_family.ts';
import type { HostStateType } from '../_runtime.ts';
import type { CrcNameType } from '../_wasm/crc.ts';

/** `zlib.crc32(data, previous)`, the one part of `node:zlib` this file uses. */
type Crc32Type = (data: Uint8Array, previous?: number) => number;

let zlib: Crc32Type | null | undefined;

/** The host's `zlib.crc32`, or `null` where it has none. Looked up once. */
function crc32(): Crc32Type | null {
	if (zlib !== undefined) return zlib;
	try {
		const process = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process;
		const found = (process?.getBuiltinModule?.('node:zlib') as { crc32?: unknown } | undefined)?.crc32;
		zlib = typeof found === 'function' ? found as Crc32Type : null;
	} catch {
		// A host that refuses built-in modules uses WebAssembly or pure JavaScript.
		zlib = null;
	}
	return zlib;
}

/** A native CRC-32/ISO-HDLC state; its digest is the 4 big-endian bytes, like the module's. */
function native(value = 0): HostStateType | undefined {
	const update = crc32();
	if (!update) return undefined;
	const state: HostStateType = {
		update(data) {
			value = update(data, value);
			return state;
		},
		digest() {
			const out = new Uint8Array(4);
			new DataView(out.buffer).setUint32(0, value >>> 0);
			return out;
		},
		copy: () => native(value)!,
	};
	return state;
}

/** Fallbacks by algorithm name. */
export const fallbacks: Partial<Record<CrcNameType | 'adler32' | 'fletcher16', FallbackType>> = {
	'CRC-32/ISO-HDLC': { host: () => native(), portable: () => crc(polynomials.ieee) },
	'CRC-32/ISCSI': { portable: () => crc(polynomials.castagnoli) },
};
