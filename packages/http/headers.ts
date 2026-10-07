/** Fields that belong to one connection, plus the widely used Proxy-Connection field. */
const hopHeaders = [
	'connection',
	'proxy-connection',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
];

/** RFC 9110 token syntax; invalid Connection options cannot name a HTTP field. */
const fieldToken = /^[!#$%&'*+\-.0-9A-Z^_`a-z|~]+$/;

/**
 * Copy the HTTP fields that can pass from one connection to the next.
 *
 * The `Connection` header can name other fields that apply only to the incoming
 * connection. This function removes those fields and the fixed connection fields.
 * Invalid option tokens are ignored. Valid options are still removed, so a
 * malformed upstream list cannot prevent forwarding its other response fields.
 * It preserves separate `Set-Cookie` values and does not change the input.
 * The caller still decides which credentials, cache fields and content metadata
 * the next connection can receive.
 *
 * For a proxy that must keep upstream cookies, copy the headers first. Then
 * remove metadata for an encoding that Fetch has already decoded.
 *
 * @example
 * ```ts
 * const upstream = new Headers({ 'content-encoding': 'gzip' });
 * upstream.append('set-cookie', 'session=one; Path=/; HttpOnly');
 * upstream.append('set-cookie', 'session-data=two; Path=/; HttpOnly');
 * const headers = forward(upstream);
 * headers.delete('content-encoding');
 * ```
 */
export function forward(input: Headers): Headers {
	// Native Headers already validates field syntax and retains separate cookies.
	// Copy that representation directly instead of allocating validated field tuples.
	const headers = new Headers(input);
	for (const name of input.get('connection')?.split(',') ?? []) {
		const option = name.trim();
		if (fieldToken.test(option)) headers.delete(option);
	}
	for (const name of hopHeaders) headers.delete(name);
	return headers;
}
