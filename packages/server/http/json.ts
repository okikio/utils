import { readText } from '@okikio/http/response/body';
import * as recordCore from '@okikio/record';
import type { Middleware } from './types.ts';

const PRETTY_JSON_MAX_BYTES = 1024 * 1024;

/** Options used by development-oriented JSON pretty printing. */
export interface PrettyJsonOptionsType {
	readonly space?: number;
	readonly query?: string;
	readonly force?: boolean;
}

/** Pretty-print JSON responses only when explicitly requested or forced. */
export function prettyJson(options: PrettyJsonOptionsType = {}): Middleware {
	recordCore.assert(options, 'pretty JSON options');
	const normalized = recordCore.snapshot(options, 'pretty JSON options');
	const space = normalized.space ?? 2;
	if (!Number.isInteger(space) || space < 0 || space > 10) {
		throw new TypeError('Pretty JSON space must be an integer from 0 through 10.');
	}
	const query = normalized.query ?? 'pretty';
	if (typeof query !== 'string') throw new TypeError('Pretty JSON query must be a string.');
	if (normalized.force !== undefined && typeof normalized.force !== 'boolean') throw new TypeError('Pretty JSON force must be a boolean when provided.');
	const force = normalized.force ?? false;
	return async (request, next) => {
		const response = await next(request);
		if (!force && !new URL(request.url).searchParams.has(query)) return response;
		const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
		if (!contentType.includes('/json') && !contentType.includes('+json')) return response;
		if (response.body === null) return response;
		let value: unknown;
		try {
			value = JSON.parse(await readText(response.clone(), PRETTY_JSON_MAX_BYTES));
		} catch {
			return response;
		}
		const headers = new Headers(response.headers);
		headers.delete('content-length');
		return new Response(JSON.stringify(value, null, space), {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	};
}
