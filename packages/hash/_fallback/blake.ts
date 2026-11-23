/** How the `blake` family runs outside WebAssembly: `node:crypto` names and pure JavaScript states. @module */
import { blake2b as noble2b, blake2s as noble2s } from '@noble/hashes/blake2.js';
import { blake3 as noble3 } from '@noble/hashes/blake3.js';
import type { FallbackType } from '../_family.ts';
import type { StateType } from '../_hasher.ts';
import type { BlakeNameType } from '../_wasm/registry.ts';

/** Fallbacks by algorithm name. */
export const fallbacks: Partial<Record<BlakeNameType, FallbackType>> = {
	'blake2b-128': two(noble2b, 16),
	'blake2b-160': two(noble2b, 20),
	'blake2b-224': two(noble2b, 28),
	'blake2b-256': two(noble2b, 32),
	'blake2b-384': two(noble2b, 48),
	'blake2b-512': { ...two(noble2b, 64), native: 'blake2b512' },
	'blake2s-128': two(noble2s, 16),
	'blake2s-160': two(noble2s, 20),
	'blake2s-224': two(noble2s, 28),
	'blake2s-256': { ...two(noble2s, 32), native: 'blake2s256' },
	blake3: { portable: (key, dkLen) => noble3.create({ dkLen, ...(key ? { key } : {}) }) },
	'blake3-derive': { portable: (key, dkLen) => noble3.create({ dkLen, context: key ?? new Uint8Array(0) }) },
};

/** BLAKE2 with Noble's `dkLen` and `key` options, which match the module's sizes and keyed mode. */
function two(hash: { create(options: { dkLen: number; key?: Uint8Array }): StateType }, dkLen: number): FallbackType {
	return { portable: (key) => hash.create({ dkLen, ...(key ? { key } : {}) }) };
}
