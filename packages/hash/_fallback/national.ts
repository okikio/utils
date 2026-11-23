/** How the `national` family runs outside WebAssembly: `node:crypto` names and pure JavaScript states. @module */
import type { FallbackType } from '../_family.ts';
import type { NationalNameType } from '../_wasm/registry.ts';

/** Fallbacks by algorithm name. */
export const fallbacks: Partial<Record<NationalNameType, FallbackType>> = {
	sm3: { native: 'sm3', hmac: true },
};
