import * as requestWire from '@okikio/http/request';
import * as recordCore from '@okikio/record';

import type { Middleware } from './types.ts';

/** Options used to establish and observe one request correlation value. */
export interface CorrelationOptions extends requestWire.RequestCorrelationOptions {
	readonly observe?: (value: requestWire.RequestCorrelation, request: Request) => void | Promise<void>;
}

/** Establish one memoized W3C/request correlation value without selecting a tracing or logging provider. */
export function correlation(options: CorrelationOptions = {}): Middleware {
	recordCore.assert(options, 'correlation middleware options');
	if (options.observe !== undefined && typeof options.observe !== 'function') throw new TypeError('correlation observe must be a function when provided.');
	const normalized = recordCore.snapshot(options, 'correlation middleware options');
	const { observe, ...correlationOptions } = normalized;
	return async (request, next) => {
		const value = await requestWire.correlation(request, correlationOptions);
		if (observe !== undefined) {
			try { await observe(value, request); } catch { /* observation cannot control request completion */ }
		}
		return await next(request);
	};
}
