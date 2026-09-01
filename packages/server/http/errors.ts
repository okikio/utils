import * as problem from '@okikio/http/problem';
import * as recordCore from '@okikio/record';

import { ServerProblems } from '../problems.ts';
import { problemResponse } from './response.ts';
import type { Middleware } from './types.ts';

/** Result a host error mapper may return before the safe fallback problem is used. */
export type ErrorResultType = Response | problem.ProblemResult | undefined;

/** Options used by the framework-neutral all-errors middleware. */
export interface ErrorOptions {
	readonly map?: (error: Error, request: Request) => ErrorResultType | Promise<ErrorResultType>;
	readonly onError?: (error: Error, request: Request, response: Response) => void | Promise<void>;
	readonly problem?: problem.ProblemDefinition;
}

/** Convert one thrown value into the configured safe HTTP response. */
export async function errorResponse(
	thrown: unknown,
	request: Request,
	options: ErrorOptions = {},
): Promise<Response> {
	const normalized = normalizeErrorOptions(options);
	const original = normalizeError(thrown);
	let observed = original;
	let result: ErrorResultType;
	try {
		result = await normalized.map?.(original, request);
	} catch (mappingError) {
		observed = new AggregateError(
			[original, normalizeError(mappingError)],
			'HTTP error mapper failed while materializing another error.',
			{ cause: original },
		);
	}
	if (result === undefined) {
		result = problem.create(normalized.problem ?? ServerProblems.Internal, {
			instance: new URL(request.url).pathname,
			cause: original,
		});
	}
	const httpResponse = result instanceof Response ? result : problemResponse(result);
	try {
		await normalized.onError?.(observed, request, httpResponse);
	} catch {
		// Error observation is non-authoritative and cannot replace completion.
	}
	return httpResponse;
}

/** Catch every synchronous or awaited downstream error before response commitment. */
export function catchErrors(options: ErrorOptions = {}): Middleware {
	const normalized = normalizeErrorOptions(options);
	return async (request, next) => {
		try {
			return await next(request);
		} catch (error) {
			return await errorResponse(error, request, normalized);
		}
	};
}

/** Preserve native Error values and wrap other thrown values without losing their cause. */
function normalizeError(value: unknown): Error {
	return value instanceof Error ? value : new Error('Non-Error value was thrown.', { cause: value });
}

/** Validate and snapshot error middleware policy before asynchronous error handling begins. @internal */
function normalizeErrorOptions(options: ErrorOptions): ErrorOptions {
	recordCore.assert(options, 'error middleware options');
	if (options.map !== undefined && typeof options.map !== 'function') throw new TypeError('error map must be a function when provided.');
	if (options.onError !== undefined && typeof options.onError !== 'function') throw new TypeError('error onError must be a function when provided.');
	return recordCore.snapshot(options, 'error middleware options');
}
