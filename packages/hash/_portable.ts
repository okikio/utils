/** Noble SHA-2, the incremental path for hosts without built-in `node:crypto`. @module */
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';
import { wrap } from './_hasher.ts';
import type { HasherType } from './_hasher.ts';
import type { AlgorithmType } from './digest.ts';

/** Allocate one Noble state; the owner must finalize or destroy it. */
export function portable(name: AlgorithmType): HasherType {
	switch (name) {
		case 'sha256':
			return wrap(sha256.create());
		case 'sha384':
			return wrap(sha384.create());
		case 'sha512':
			return wrap(sha512.create());
		default:
			throw new TypeError('Unsupported SHA-2 algorithm.');
	}
}
