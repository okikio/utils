/** Apply the same origin policy to live service mounts and serialized gateway artifacts. @module */

import type { GatewayOrigin } from './types.ts';

/**
 * Require HTTPS outside loopback, strip query and fragment, and remove a trailing path slash. A
 * supplied URL object is normalized in place; pass a string to retain the caller object unchanged.
 */
export function normalizeOrigin(value: GatewayOrigin): string {
	const url = value instanceof URL ? value : new URL(value);
	if (url.username || url.password) throw new TypeError('Gateway origins may not contain credentials.');
	if (url.protocol !== 'https:' && !isLoopbackHttp(url)) {
		throw new TypeError('Gateway origins must use HTTPS outside loopback development.');
	}
	url.hash = '';
	url.search = '';
	url.pathname = url.pathname.replace(/\/$/, '');
	return url.toString().replace(/\/$/, '');
}

/**
 * Allow plaintext HTTP only for the three explicit loopback host spellings used in local development.
 * This does not resolve DNS or infer whether another hostname is private.
 */
function isLoopbackHttp(url: URL): boolean {
	return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}
