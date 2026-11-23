/** How the `legacy` family runs outside WebAssembly: `node:crypto` names and pure JavaScript states. @module */
import { md5, ripemd160, sha1 } from '@noble/hashes/legacy.js';
import { fixed } from './mod.ts';
import type { FallbackType } from '../_family.ts';
import type { LegacyNameType } from '../_wasm/registry.ts';

/** Fallbacks by algorithm name. */
export const fallbacks: Partial<Record<LegacyNameType, FallbackType>> = {
	md4: { native: 'md4' },
	md5: fixed(md5, 'md5'),
	sha1: fixed(sha1, 'sha1'),
	ripemd160: fixed(ripemd160, 'ripemd160'),
};
