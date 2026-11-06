import { forward, list } from '../headers.ts';
import * as record from '@okikio/collection/record';

/** Credential forwarding policy for one outbound HTTP request. */
export interface ForwardHeaderOptionsType {
	/** Explicit policy for retaining or stripping inbound Cookie headers. */
	readonly requestCookies?: 'preserve' | 'strip';
	/** Explicit policy for retaining or stripping inbound Authorization, including after authentication. */
	readonly requestAuthorization?: 'preserve' | 'strip';
	/** Host-trusted connected client address used when reconstructing forwarding metadata. */
	readonly clientIp?: string;
	/** Exact header names removed before forwarding. */
	readonly remove?: readonly string[];
	/** Header-name prefixes removed before forwarding. */
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
	const remove = new Set(
		list(options.remove ?? [], 'removed forwarding headers').map((name) => name.toLowerCase()),
	);
	const prefixes = list(options.removePrefixes ?? [], 'removed forwarding header prefixes').map((value) =>
		value.toLowerCase()
	);
	const headers = new Headers();

	// Strip spoofable origin/correlation metadata and credentials by default.
	// Reconstruct forwarding fields below from the host-selected URL/address.
	for (const [name, value] of forward(request.headers)) {
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
