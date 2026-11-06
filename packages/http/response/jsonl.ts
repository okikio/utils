/** One native Response owns bounded JSONL serialization and exposes body outcome separately from source cleanup. @module */
import * as json from '@okikio/collection/record/json';
import * as readers from '@okikio/streams/reader';
import type { CleanupOutcome, ReaderOptions } from '@okikio/streams/reader';

/** Native body delivery outcome. A cancelled read can finish before its source's cancellation hook settles. */
export interface JsonlCompletionType {
	/** Body terminal state, distinct from eventual underlying source cleanup. */
	readonly outcome: 'completed' | 'cancelled' | 'errored';
	/** Serialized bytes enqueued before termination; this is not proof that a remote client received them. */
	readonly bytes: number;
	/** Exact cancellation or serialization/read failure value. */
	readonly reason?: unknown;
	/** Eventual actual input cleanup outcome, retained even when cancellation must release its lock promptly. */
	readonly cleanup: Promise<CleanupOutcome>;
}
/** Explicit serialization limits and native response metadata. No schema or destination is inferred. */
export interface JsonlOptions extends ReaderOptions {
	/** Total serialized UTF-8 bytes, including all LF terminators. */
	readonly maximumBytes: number;
	/** Complete encoded record bytes, including LF. */
	readonly maximumRecordBytes: number;
	/** Maximum emitted JSON values. A cap+1 source value rejects the body. */
	readonly maximumItems: number;
	/** Per-record finite JSON traversal. Accessors, cycles and non-JSON values reject without invoking toJSON. */
	readonly projection: Required<json.Options>;
	/** Request method used to suppress body construction for HEAD. Defaults to GET. */
	readonly method?: string;
	/** Native Response status. Defaults to 200; bodyless statuses never acquire source ownership. */
	readonly status?: number;
	/** Copied native metadata; Content-Type is NDJSON and any Content-Length is removed. */
	readonly headers?: HeadersInit;
}
/** Only responses created here are tracked; there is no patching of arbitrary native Response objects. */
const completions = new WeakMap<Response, Promise<JsonlCompletionType>>();
/** Observe this factory's terminal body outcome without wrapping or replacing its Response identity. */
export function jsonlCompletion(response: Response): Promise<JsonlCompletionType> {
	const completion = completions.get(response);
	if (completion === undefined) throw new TypeError('Response was not created by jsonl().');
	return completion;
}

/**
 * Stream one JSON value per line in a native Response.
 *
 * Each pull reads and serializes one source item. Item, record-byte, total-byte
 * and traversal limits reject oversized output. Business validation belongs
 * upstream; this serializer only accepts finite JSON data.
 *
 * Construction owns the source reader, even before the first pull. Cancellation
 * releases its lock promptly; jsonlCompletion() exposes eventual source cleanup.
 * For HEAD and statuses 204/205/304, no reader is acquired and the unused source
 * remains caller-owned. Metadata is checked before ownership is acquired.
 *
 * Observe the exact returned Response before wrapping it with middleware. A
 * later serialization failure errors the body; it cannot replace sent headers.
 */
export function jsonl(source: ReadableStream<unknown>, options: JsonlOptions): Response {
	options = Object.freeze({ ...options });
	for (const value of [options.maximumBytes, options.maximumRecordBytes, options.maximumItems]) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new RangeError('JSONL limits require nonnegative safe integers.');
		}
	}
	if (options.maximumRecordBytes < 1) throw new RangeError('JSONL records require room for an LF.');
	json.copy(null, options.projection);
	const projection = Object.freeze({ ...options.projection });
	const headers = new Headers(options.headers);
	headers.set('content-type', 'application/x-ndjson; charset=utf-8');
	headers.delete('content-length');
	// Validate all native metadata before retaining a source reader.
	const metadata = new Response(null, { status: options.status ?? 200, headers });
	const completion = Promise.withResolvers<JsonlCompletionType>();
	if (options.method?.toUpperCase() === 'HEAD' || [204, 205, 304].includes(metadata.status)) {
		completion.resolve(
			Object.freeze({ outcome: 'completed', bytes: 0, cleanup: Promise.resolve({ status: 'released' as const }) }),
		);
		completions.set(metadata, completion.promise);
		return metadata;
	}
	// From here onward the response owns the reader. Body termination must close
	// that owner, while reporting cancellation separately from eventual cleanup.
	const owner = readers.open(source, options);
	let bytes = 0, items = 0, terminal = false;
	const encoder = new TextEncoder();
	/** First terminal actor owns completion. Observation cannot alter the native body result. */
	const finish = (outcome: JsonlCompletionType['outcome'], reason?: unknown): void => {
		if (terminal) return;
		terminal = true;
		completion.resolve(
			Object.freeze({ outcome, bytes, ...(outcome === 'completed' ? {} : { reason }), cleanup: owner.cleanup }),
		);
	};
	const body = new ReadableStream<Uint8Array>({
		/**
		 * Read and encode one record only when the response consumer asks for it.
		 * With a zero high-water mark this wrapper does not build a queue of records
		 * ahead of a slow reader. The source still owns any buffering it does itself.
		 */
		async pull(controller) {
			try {
				const next = await owner.read();
				if (next.done) {
					controller.close();
					finish('completed');
					return;
				}
				if (++items > options.maximumItems) throw new RangeError('JSONL exceeds maximumItems.');
				// Reserve the LF in both record and total wire budgets. JSON traversal
				// refuses getters/cycles rather than invoking user serialization hooks.
				const record = encoder.encode(
					json.stringify(next.value, { ...projection, maximumBytes: options.maximumRecordBytes - 1 }) + '\n',
				);
				if (record.length > options.maximumBytes - bytes) throw new RangeError('JSONL exceeds maximumBytes.');
				bytes += record.length;
				controller.enqueue(record);
			} catch (error) {
				void owner.close(error);
				if (!terminal) {
					controller.error(error);
					finish('errored', error);
				}
			}
		},
		cancel(reason) {
			void owner.close(reason);
			finish('cancelled', reason);
		},
	}, { highWaterMark: 0 });
	const response = new Response(body, { status: metadata.status, statusText: metadata.statusText, headers });
	completions.set(response, completion.promise);
	return response;
}
