/** How the `sha2` family runs outside WebAssembly: `node:crypto` names and pure JavaScript states. @module */
import { sha224, sha256, sha384, sha512, sha512_224, sha512_256 } from '@noble/hashes/sha2.js';
import { fixed } from './mod.ts';
import type { FallbackType } from '../_family.ts';
import type { Sha2NameType } from '../_wasm/registry.ts';

/** Fallbacks by algorithm name. */
export const fallbacks: Partial<Record<Sha2NameType, FallbackType>> = {
	sha224: fixed(sha224, 'sha224'),
	sha256: fixed(sha256, 'sha256'),
	sha384: fixed(sha384, 'sha384'),
	sha512: fixed(sha512, 'sha512'),
	'sha512-224': fixed(sha512_224, 'sha512-224'),
	'sha512-256': fixed(sha512_256, 'sha512-256'),
};
