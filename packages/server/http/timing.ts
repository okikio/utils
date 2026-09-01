import * as recordCore from '@okikio/record';
import type { Middleware } from './types.ts';
import { withHeaders } from './response.ts';

/** Options used by framework-neutral Server-Timing middleware. */
export interface TimingOptions {
	readonly name?: string;
	readonly description?: string;
	readonly enabled?: (request: Request) => boolean;
}

/** Record total request-handler duration in the standard Server-Timing response header. */
export function timing(options: TimingOptions = {}): Middleware {
	recordCore.assert(options, 'timing options');
	const normalized = recordCore.snapshot(options, 'timing options');
	const name = normalized.name ?? 'total';
	if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(name)) throw new TypeError('Server-Timing metric name is invalid.');
	if (normalized.enabled !== undefined && typeof normalized.enabled !== 'function') throw new TypeError('Server-Timing enabled must be a function when provided.');
	if (normalized.description !== undefined && typeof normalized.description !== 'string') throw new TypeError('Server-Timing description must be a string when provided.');
	const enabled = normalized.enabled;
	const description = normalized.description ?? 'Total Response Time';
	return async (request, next) => {
		if (enabled && !enabled(request)) return await next(request);
		const started = performance.now();
		const result = await next(request);
		const duration = Math.max(0, performance.now() - started);
		const metric = `${name};dur=${duration.toFixed(2)};desc=${JSON.stringify(description)}`;
		return withHeaders(result, { 'Server-Timing': metric });
	};
}
