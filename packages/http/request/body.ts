import { DefaultRequestParsingLimits, limits } from './limits.ts';
import { requireContentType } from './content.ts';
import { parseContentLength } from './length.ts';
import type { FormWireRecord, RequestParsingOptions } from './types.ts';
import { RequestTransportError } from './types.ts';

import * as streams from '@okikio/streams/reader';
import type { CleanupOutcome } from '@okikio/streams/reader';

/** A Request has one body owner; additional decoders reuse its bounded byte result. */
const bodyReads = new WeakMap<Request, Promise<Uint8Array>>();
/** Source cancellation can outlive read rejection, especially when a caller supplied a tee branch. */
const bodyCleanups = new WeakMap<Request, Promise<CleanupOutcome>>();

/**
 * Observe cleanup for the body read started by this module.
 *
 * Read rejection can finish before source cancellation. For example, cloning a
 * Request splits its stream into two readers, and cancellation may wait while
 * the other reader remains open. Await this separately when joining cleanup.
 * If this module has not opened a reader, return a completed placeholder; that
 * is not evidence that an unrelated reader consumed the body.
 */
export function bodyCleanup(request: Request): Promise<CleanupOutcome> {
	return bodyCleanups.get(request) ?? Promise.resolve({ status: 'completed' });
}

/**
 * Read a complete request body within a byte budget.
 *
 * The first call owns the reader and caches its result. Later calls share that
 * read, check their own limit, and receive independent copies of the bytes.
 * A smaller later limit can reject even after the first call succeeded.
 *
 * Abort or overflow releases the reader lock promptly. Source cancellation can
 * still be pending; bodyCleanup() reports its eventual result separately.
 * This function buffers accepted bytes. It is not a streaming upload API.
 */
export async function readBody(
	request: Request,
	options: RequestParsingOptions = DefaultRequestParsingLimits,
): Promise<Uint8Array> {
	request.signal.throwIfAborted();
	const policy = limits(options);
	const declared = request.headers.has('transfer-encoding')
		? undefined
		: parseContentLength(request.headers.get('content-length'));
	if (declared !== undefined && declared > policy.maximumBodyBytes) throw bodyTooLarge(policy.maximumBodyBytes);
	let pending = bodyReads.get(request);
	if (pending === undefined) {
		pending = readBytes(request, policy.maximumBodyBytes);
		bodyReads.set(request, pending);
	}
	const bytes = await pending;
	if (bytes.byteLength > policy.maximumBodyBytes) throw bodyTooLarge(policy.maximumBodyBytes);
	return new Uint8Array(bytes);
}

/** Acquire one shared reader and release its lock on every success, rejection or abort path. */
async function readBytes(request: Request, maximum: number): Promise<Uint8Array> {
	if (request.body === null) return new Uint8Array();
	const owner = streams.open(request.body, { signal: request.signal });
	bodyCleanups.set(request, owner.cleanup);
	const chunks: Uint8Array[] = [];
	let total = 0;
	let reason: unknown;
	try {
		while (true) {
			const { done, value } = await owner.read();
			if (done) break;
			total += value.byteLength;
			if (total > maximum) throw bodyTooLarge(maximum);
			// A producer may reuse its chunk buffer. Copy before the next read so
			// later mutation cannot alter bytes we already admitted.
			chunks.push(new Uint8Array(value));
		}
		const output = new Uint8Array(total);
		let offset = 0;
		// Accepted chunks are already bounded and detached from the producer.
		// Combine them only after the complete read so decoders see one stable body.
		for (const chunk of chunks) {
			output.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return output;
	} catch (error) {
		reason = error;
		throw error;
	} finally {
		owner.close(reason);
	}
}

/**
 * Decode a complete bounded JSON body after checking its media type.
 * Malformed UTF-8 or JSON becomes an invalid-json transport issue. The returned
 * value is still unknown: validate its fields before application work.
 */
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

/**
 * Decode a complete bounded form, retaining repeated values and File objects.
 *
 * Native form parsing runs after the byte budget admits the whole body. Field
 * count validation runs after that parse; it does not prevent every allocation
 * the native parser makes. Validate text versus File at the application boundary.
 */
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
 * Create the body-too-large issue without copying any rejected request bytes into diagnostics.
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
