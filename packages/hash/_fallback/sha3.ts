/** How the `sha3` family runs outside WebAssembly: `node:crypto` names and pure JavaScript states. @module */
import {
	keccak_224,
	keccak_256,
	keccak_384,
	keccak_512,
	sha3_224,
	sha3_256 as nobleSha3_256,
	sha3_384,
	sha3_512 as nobleSha3_512,
	shake128,
	shake256,
} from '@noble/hashes/sha3.js';
import {
	cshake128,
	cshake256,
	kmac128,
	kmac256,
	kt128,
	kt256,
	turboshake128,
	turboshake256,
} from '@noble/hashes/sha3-addons.js';
import { fixed, xof } from './mod.ts';
import type { FallbackType } from '../_family.ts';
import type { Sha3NameType } from '../_wasm/registry.ts';

/** Fallbacks by algorithm name. */
export const fallbacks: Partial<Record<Sha3NameType, FallbackType>> = {
	'sha3-224': fixed(sha3_224, 'sha3-224'),
	'sha3-256': fixed(nobleSha3_256, 'sha3-256'),
	'sha3-384': fixed(sha3_384, 'sha3-384'),
	'sha3-512': fixed(nobleSha3_512, 'sha3-512'),
	keccak224: fixed(keccak_224),
	keccak256: fixed(keccak_256),
	keccak384: fixed(keccak_384),
	keccak512: fixed(keccak_512),
	shake128: xof(shake128, undefined, 'shake128'),
	shake256: xof(shake256, undefined, 'shake256'),
	cshake128: xof(cshake128, 'personalization'),
	cshake256: xof(cshake256, 'personalization'),
	turboshake128: xof(turboshake128),
	turboshake256: xof(turboshake256),
	kt128: xof(kt128),
	kt256: xof(kt256),
	kmac128: { portable: (key, dkLen) => key ? kmac128.create(key, { dkLen }) as never : undefined },
	kmac256: { portable: (key, dkLen) => key ? kmac256.create(key, { dkLen }) as never : undefined },
};
