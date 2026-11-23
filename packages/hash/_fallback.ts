/**
 * Builders that turn `@noble/hashes` functions into the fallback states of `_family.ts`.
 *
 * Noble states already have `update`, `digest`, `clone` and `destroy`, so they need no adapter. These
 * helpers only decide which options a Noble function can honor; a builder returns `undefined` for the
 * rest, and the runtime then needs the WebAssembly module.
 *
 * @module
 */
import { hmac } from '@noble/hashes/hmac.js';
import type { StateType } from './_hasher.ts';
import type { FallbackType } from './_family.ts';

/** A Noble hash function: callable, with a `create` that takes options. */
interface NobleType {
	create(options?: Record<string, unknown>): StateType;
	readonly outputLen: number;
	readonly blockLen: number;
}

/** A fixed-length hash, with HMAC when `keyed` is true. */
export function fixed(hash: NobleType, native?: string, keyed = true): FallbackType {
	return {
		...(native ? { native, hmac: keyed } : {}),
		portable: (key) =>
			key === undefined ? hash.create() : keyed ? (hmac.create(hash as never, key) as unknown as StateType) : undefined,
	};
}

/** An extendable output that Noble sizes with `dkLen`; `custom` names the option for the key bytes. */
export function xof(hash: NobleType, custom?: string, native?: string): FallbackType {
	return {
		...(native ? { native, xof: true } : {}),
		portable: (key, length) => {
			if (key !== undefined && !custom) return undefined;
			return hash.create({ dkLen: length, ...(key !== undefined && custom ? { [custom]: key } : {}) });
		},
	};
}
