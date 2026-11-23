/**
 * SHA-2 on Web Crypto (`crypto.subtle`), and nothing else.
 *
 * Every call is asynchronous, and Web Crypto has no incremental state, so there is no `create`. Only SHA-256,
 * SHA-384 and SHA-512 exist there. HMAC uses the same names with a `key`. Use this entry point in a browser that
 * refuses WebAssembly, or to keep the bundle at a few hundred bytes.
 *
 * ```ts
 * import { hash } from '@okikio/hash/sha2/web';
 *
 * await hash('sha256', 'hello');
 * await hash('sha256', 'hello', { key: new Uint8Array(32) });
 * ```
 *
 * @module
 */
import type { InputType } from '../../_bytes.ts';
import { subtle, type WebOptionsType } from './_subtle.ts';
export type { InputType } from '../../_bytes.ts';
export type { WebOptionsType } from './_subtle.ts';

/** Algorithm names Web Crypto runs in this family. */
export type AlgorithmType = 'sha256' | 'sha384' | 'sha512';

const labels: Readonly<Record<AlgorithmType, string>> = { sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };

/** Hash complete input, or compute HMAC when `options.key` is present. Text is UTF-8. */
export function hash(name: AlgorithmType, input: InputType, options?: WebOptionsType): Promise<Uint8Array> {
	const label = labels[name];
	if (!label) return Promise.reject(new TypeError(`Unknown algorithm: ${String(name)}`));
	return subtle(label, input, options);
}
