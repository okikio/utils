import * as requestWire from '@okikio/http/request';
import * as recordCore from '@okikio/record';

import type { Middleware } from './types.ts';
import { withHeaders } from './response.ts';

/** Options used by request-ID propagation middleware. */
export interface RequestIdOptions {
	readonly header?: string;
	readonly generate?: (request: Request) => string;
}

/** Normalize one request ID, pass it downstream, and return it to the caller. */
export function requestId(options: RequestIdOptions = {}): Middleware {
	recordCore.assert(options, 'request ID options');
	const normalized = recordCore.snapshot(options, 'request ID options');
	const header = normalized.header ?? 'X-Request-ID';
	if (typeof header !== 'string' || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(header)) throw new TypeError('Request ID header must be a valid HTTP field name.');
	if (normalized.generate !== undefined && typeof normalized.generate !== 'function') throw new TypeError('Request ID generate must be a function when provided.');
	const generate = normalized.generate;
	return async (request, next) => {
		const supplied = request.headers.get(header);
		const candidate = supplied && supplied.length > 0 ? supplied : generate?.(request);
		const value = requestWire.requestId(candidate);
		const headers = new Headers(request.headers);
		headers.set(header, value);
		
		const forwarded = supplied === value ? request : new Request(request, { headers });
		return withHeaders(await next(forwarded), { [header]: value });
	};
}
