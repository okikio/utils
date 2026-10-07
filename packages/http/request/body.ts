import { DefaultRequestParsingLimits, limits } from './limits.ts';
import { requireContentType } from './content.ts';
import { parseContentLength } from './length.ts';
import type { FormWireRecord, RequestParsingOptions } from './types.ts';
import { RequestTransportError } from './types.ts';

/**
 * Read request bytes once with a hard upper bound and Content-Length precheck.
 *
 * Cancellation settles before the reader lock is released. A body-limit issue
 * remains the primary transport failure if cancellation rejects, with private
 * cleanup diagnostics retained in its cause. Other primary and cleanup failures
 * produce an AggregateError whose cause is the original read or abort failure.
 */
export async function readBody(
	request: Request,
	options: RequestParsingOptions = DefaultRequestParsingLimits,
): Promise<Uint8Array> {
	const policy = limits(options);
	// Transfer-Encoding defines framing when present. Do not trust a simultaneous
	// Content-Length for admission; enforce the actual streamed byte count below.
	const declared = request.headers.has('transfer-encoding')
		? undefined
		: parseContentLength(request.headers.get('content-length'));
	if (declared !== undefined && declared > policy.maximumBodyBytes) throw bodyTooLarge(policy.maximumBodyBytes);
	if (request.body === null) return new Uint8Array();
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	let cancellation: Promise<Readonly<{ failed: false }> | Readonly<{ failed: true; error: unknown }>> | undefined;
	let failed = false;
	let failure: unknown;
	// Observe cancellation immediately, including rejection with undefined. The
	// outcome promise never rejects and is joined by the reader's finally block.
	const cancel = (reason: unknown) => {
		cancellation ??= reader.cancel(reason).then(
			() => ({ failed: false as const }),
			(error: unknown) => ({ failed: true as const, error }),
		);
	};
	const abort = () => {
		cancel(request.signal.reason);
	};
	if (request.signal.aborted) abort();
	else request.signal.addEventListener('abort', abort, { once: true });
	try {
		while (true) {
			if (request.signal.aborted) throw request.signal.reason;
			const { done, value } = await reader.read();
			if (request.signal.aborted) throw request.signal.reason;
			if (done) break;
			total += value.byteLength;
			if (total > policy.maximumBodyBytes) {
				cancel('request body limit exceeded');
				throw bodyTooLarge(policy.maximumBodyBytes);
			}
			chunks.push(value);
		}
	} catch (error) {
		failed = true;
		failure = error;
	} finally {
		request.signal.removeEventListener('abort', abort);
		try {
			const cleanup = cancellation === undefined ? undefined : await cancellation;
			if (cleanup?.failed) {
				if (
					failure instanceof RequestTransportError && failure.issues.some((issue) => issue.code === 'body-too-large')
				) {
					failure = new RequestTransportError(failure.issues, { cause: cleanup.error });
				} else if (failed) {
					failure = new AggregateError([failure, cleanup.error], 'Request body read and cancellation failed.', {
						cause: failure,
					});
				} else {
					failure = cleanup.error;
				}
				failed = true;
			}
		} finally {
			reader.releaseLock();
		}
	}
	if (failed) throw failure;
	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

/** Parse bounded JSON after enforcing application/json or a +json media type. */
export async function parseJson(
	request: Request,
	options: RequestParsingOptions = DefaultRequestParsingLimits,
): Promise<unknown> {
	const contentType = requireContentType(request, ['application/json', 'application/*+json']);
	if (
		contentType.type !== 'application' || (contentType.subtype !== 'json' && !contentType.subtype.endsWith('+json'))
	) {
		throw new RequestTransportError({
			code: 'unsupported-content-type',
			message: `Content-Type ${contentType.essence} is not JSON.`,
			path: ['header', 'content-type'],
		});
	}
	const bytes = await readBody(request, options);
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		return JSON.parse(text);
	} catch (error) {
		throw new RequestTransportError({
			code: 'invalid-json',
			message: error instanceof Error ? `Invalid JSON: ${error.message}` : 'Invalid JSON.',
			path: ['json'],
		});
	}
}

/** Parse a bounded URL-encoded or multipart form while preserving repeated string values. */
export async function parseForm(
	request: Request,
	options: RequestParsingOptions = DefaultRequestParsingLimits,
): Promise<FormWireRecord> {
	requireContentType(request, ['application/x-www-form-urlencoded', 'multipart/form-data']);
	// One immutable policy owns the complete read and decode, even if the caller
	// changes its authored options while the body reader is awaiting a chunk.
	const policy = limits(options);
	const bytes = await readBody(request, policy);
	const copy = new Request(request, { body: new Blob([new Uint8Array(bytes)]) });
	let form: FormData;
	try {
		form = await copy.formData();
	} catch (error) {
		throw new RequestTransportError({
			code: 'invalid-form',
			message: error instanceof Error ? `Invalid form: ${error.message}` : 'Invalid form.',
			path: ['form'],
		});
	}
	const collected: Record<string, (string | File)[]> = Object.create(null);
	let count = 0;
	for (const [name, value] of form.entries()) {
		count += 1;
		(collected[name] ??= []).push(value);
	}
	if (count > policy.maximumFormFields) {
		throw new RequestTransportError({
			code: 'invalid-form',
			message: `At most ${policy.maximumFormFields} form fields are allowed.`,
			path: ['form'],
		});
	}
	const result: Record<string, string | File | readonly (string | File)[]> = Object.create(null);
	for (const [name, values] of Object.entries(collected)) {
		result[name] = values.length === 1 ? values[0]! : Object.freeze(values);
	}
	return Object.freeze(result);
}

/**
 * Creates the typed request-body limit failure with the configured and observed byte counts.
 *
 * @internal
 */
function bodyTooLarge(maximum: number): RequestTransportError {
	return new RequestTransportError({
		code: 'body-too-large',
		message: `Request body exceeds ${maximum} bytes.`,
		path: ['body'],
	});
}
