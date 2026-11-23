/**
 * SHA-1 on Web Crypto (`crypto.subtle`), and nothing else.
 *
 * SHA-1 is broken for collision resistance. Use it only to match an existing format, such as Git object names or a
 * WebSocket handshake. Calls are asynchronous and there is no incremental state. HMAC uses a `key`.
 *
 * ```ts
 * import { hash } from '@okikio/hash/legacy/web';
 *
 * await hash('sha1', 'hello');
 * ```
 *
 * @module
 */
import type { InputType } from '../../_bytes.ts';
import { subtle, type WebOptionsType } from './_subtle.ts';
export type { InputType } from '../../_bytes.ts';
export type { WebOptionsType } from './_subtle.ts';

/** Algorithm names Web Crypto runs in this family. */
export type AlgorithmType = 'sha1';

/** Hash complete input, or compute HMAC when `options.key` is present. Text is UTF-8. */
export function hash(name: AlgorithmType, input: InputType, options?: WebOptionsType): Promise<Uint8Array> {
	if (name !== 'sha1') return Promise.reject(new TypeError(`Unknown algorithm: ${String(name)}`));
	return subtle('SHA-1', input, options);
}
