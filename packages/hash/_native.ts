/**
 * The host's built-in `node:crypto` SHA-2, found without importing it.
 *
 * Deno, Node and Bun expose their built-in modules through `process.getBuiltinModule()`. A browser has no `process`,
 * so `provider` is `undefined` there and callers fall back to Web Crypto or Noble. Looking the module up at run time,
 * instead of importing `node:crypto`, keeps bundlers from pulling a Node polyfill into browser builds.
 *
 * The native hash consumes its input synchronously, so a caller that changes its buffer afterwards cannot change the
 * digest. That is why this path needs no defensive copy, unlike the asynchronous Web Crypto path.
 *
 * @module
 */
import type { InputType } from './_bytes.ts';
import type { StateType } from './_hasher.ts';
import { algorithm } from './_output.ts';
import type { AlgorithmType, EncodingType } from './digest.ts';

/** The part of a `node:crypto` Hash object that this package uses. */
export interface HashType {
	update(data: string | ArrayBufferView): HashType;
	digest(): Uint8Array;
	digest(encoding: 'hex' | 'base64url'): string;
	copy(): HashType;
}

/** The part of `node:crypto` that this package uses. */
export interface ProviderType {
	createHash(name: AlgorithmType): HashType;
}

/** Built-in SHA-2 of this host, or `undefined` where the host has none. */
export const provider: ProviderType | undefined = lookup();

function lookup(): ProviderType | undefined {
	try {
		const host = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process;
		const found = host?.getBuiltinModule?.('node:crypto') as Partial<ProviderType> | undefined;
		return typeof found?.createHash === 'function' ? found as ProviderType : undefined;
	} catch {
		// A host that refuses built-in modules, such as a permission-limited runtime, uses the portable path.
		return undefined;
	}
}

/** Node accepts strings and views but not a bare ArrayBuffer; a view over it needs no copy. */
function data(input: InputType): string | ArrayBufferView {
	return typeof input === 'string' || ArrayBuffer.isView(input) ? input : new Uint8Array(input);
}

/** A Buffer result as a plain Uint8Array; a digest Buffer owns its memory, so this is usually a view, not a copy. */
export function bytes(value: Uint8Array): Uint8Array {
	return value.byteOffset === 0 && value.buffer.byteLength === value.byteLength && value.buffer instanceof ArrayBuffer
		? new Uint8Array(value.buffer)
		: Uint8Array.from(value);
}

/** Hash complete input with the host's SHA-2 and encode the result. Text is encoded as UTF-8. */
export function digest(
	host: ProviderType,
	name: AlgorithmType,
	input: InputType,
	encoding: EncodingType,
): Uint8Array | string {
	algorithm(name);
	if (encoding !== 'bytes' && encoding !== 'hex' && encoding !== 'base64url') {
		throw new TypeError('Unsupported digest encoding.');
	}
	const hash = host.createHash(name).update(data(input));
	return encoding === 'bytes' ? bytes(hash.digest()) : hash.digest(encoding);
}

/** Incremental state over one native Hash. `node:crypto` frees its memory when the object is collected. */
export function state(hash: HashType): StateType {
	return {
		update(input) {
			hash.update(input);
			return this;
		},
		digest: () => bytes(hash.digest()),
		clone: () => state(hash.copy()),
		destroy() {},
	};
}
