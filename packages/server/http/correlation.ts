import * as requestWire from '@okikio/http/request';
import * as recordCore from '@okikio/collection/record';

import type { Middleware } from './types.ts';

/** Options used to establish and observe one request correlation value. */
export interface CorrelationOptions extends requestWire.RequestCorrelationOptions {
	/** Observe established request correlation without choosing admission or response behavior. */
	readonly observe?: (value: requestWire.RequestCorrelation, request: Request) => void | Promise<void>;
}

/**
 * Establish shared diagnostic IDs before calling the next middleware.
 * Observation failures are contained, but the observer is awaited and must bound
 * its own work. These IDs correlate requests; they do not authenticate a caller.
 */
export function correlation(options: CorrelationOptions = {}): Middleware {
	recordCore.assert(options, 'correlation middleware options');
	if (options.observe !== undefined && typeof options.observe !== 'function') {
		throw new TypeError('correlation observe must be a function when provided.');
	}
	const normalized = recordCore.snapshot(options, 'correlation middleware options');
	const { observe, ...correlationOptions } = normalized;
	return async (request, next) => {
		const value = await requestWire.correlation(request, correlationOptions);
		if (observe !== undefined) {
			try {
				await observe(value, request);
			} catch { /* observer rejection cannot replace the request result */ }
		}
		return await next(request);
	};
}
