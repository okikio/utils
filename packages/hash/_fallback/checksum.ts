/** How the `checksum` family runs outside WebAssembly: `node:crypto` names and pure JavaScript states. @module */
import { crc, polynomials } from '../_crc32.ts';
import type { FallbackType } from '../_family.ts';
import type { CrcNameType } from '../_wasm/crc.ts';

/** Fallbacks by algorithm name. */
export const fallbacks: Partial<Record<CrcNameType | 'adler32' | 'fletcher16', FallbackType>> = {
	'CRC-32/ISO-HDLC': { portable: () => crc(polynomials.ieee) },
	'CRC-32/ISCSI': { portable: () => crc(polynomials.castagnoli) },
};
