import * as record from '@okikio/record';

/** Credential forwarding policy for one outbound HTTP request. */
export interface ForwardHeaderOptionsType {
	readonly requestCookies?: 'preserve' | 'strip';
	readonly requestAuthorization?: 'preserve' | 'strip';
	readonly clientIp?: string;
	readonly remove?: readonly string[];
	readonly removePrefixes?: readonly string[];
}

const removedHeaders = new Set([
	'connection',
	'forwarded',
	'host',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
	'x-real-ip',
	'x-request-id',
	'traceparent',
	'tracestate',
]);

/**
 * Build trusted forwarding headers from one untrusted request.
 *
 * Caller-authored forwarding, correlation, hop-by-hop, and selected host-owned
 * fields are removed before the public host and protocol are reconstructed.
 */
export function forwardHeaders(
	request: Pick<Request, 'headers' | 'url'>,
	options: ForwardHeaderOptionsType = {},
): Headers {
	record.assert(options, 'HTTP forwarding header options');
	const remove = new Set(stringList(options.remove ?? [], 'removed forwarding headers').map((name) => name.toLowerCase()));
	const prefixes = stringList(options.removePrefixes ?? [], 'removed forwarding header prefixes').map((value) => value.toLowerCase());
	const headers = new Headers();

	for (const [name, value] of request.headers) {
		const normalized = name.toLowerCase();
		if (removedHeaders.has(normalized) || normalized.startsWith('x-forwarded-')) continue;
		if (remove.has(normalized) || prefixes.some((prefix) => normalized.startsWith(prefix))) continue;
		if (normalized === 'cookie' && options.requestCookies !== 'preserve') continue;
		if (normalized === 'authorization' && options.requestAuthorization !== 'preserve') continue;
		headers.append(name, value);
	}

	const url = new URL(request.url);
	headers.set('x-forwarded-host', url.host);
	headers.set('x-forwarded-proto', url.protocol.slice(0, -1));
	const clientIp = options.clientIp?.trim();
	if (clientIp) headers.set('x-forwarded-for', clientIp);
	return headers;
}

/** Validate one dense list without invoking accessor-backed array elements. @internal */
function stringList(values: readonly string[], name: string): readonly string[] {
	if (!Array.isArray(values)) throw new TypeError(`${name} must be an array of strings.`);
	const result: string[] = [];
	for (let index = 0; index < values.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
		if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string') {
			throw new TypeError(`${name} must contain dense string data elements.`);
		}
		result.push(descriptor.value);
	}
	return Object.freeze(result);
}
