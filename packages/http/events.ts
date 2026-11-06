/** Bounded SSE wire messages composed with STD's browser-compatible parser and writer. @module */
import { ServerSentEventParseStream } from '@std/http/server-sent-event-parse-stream';
import { ServerSentEventStream } from '@std/http/server-sent-event-stream';
import * as readers from '@okikio/streams/reader';
import type { ReaderOptions } from '@okikio/streams/reader';
import { iterable } from '@okikio/streams';
import * as schema from '@okikio/schema';

/** One wire message. Comments and reconnect metadata are exposed; no EventSource/reconnect loop is owned. */
export interface MessageType {
	/** Comment lines joined with LF, excluding their colon. */
	readonly comment?: string;
	/** Explicit event name. Absent does not add a synthetic message event. */
	readonly event?: string;
	/** Data lines joined with LF. */
	readonly data?: string;
	/** Explicit ID update, including an empty reset. No implicit carry from earlier messages. */
	readonly id?: string;
	/** Safe nonnegative reconnect milliseconds. The caller decides whether to reconnect. */
	readonly retry?: number;
}
/** Byte and message budgets include comments, unknown fields and incomplete final input. */
export interface ReadOptions extends ReaderOptions {
	/** Total admitted original or serialized bytes. */
	readonly maximumBytes: number;
	/** Maximum provider-owned input allocation admitted to the parser. */
	readonly maximumChunkBytes: number;
	/** Original bytes between blank-line boundaries, including all field/line separators and an initial BOM. */
	readonly maximumEventBytes: number;
	/** Returned wire messages, including comment-only and metadata-only messages. */
	readonly maximumEvents: number;
}
/** Bounds for the serialized representation. Input messages remain caller-owned. */
export interface WriteOptions extends ReaderOptions {
	/** Total admitted original or serialized bytes. */
	readonly maximumBytes: number;
	readonly maximumEventBytes: number;
	readonly maximumEvents: number;
}
/** Reject policy before acquiring the borrowed source reader. */
function limits(options: WriteOptions): void {
	for (const value of [options.maximumBytes, options.maximumEventBytes, options.maximumEvents]) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new RangeError('SSE limits require nonnegative safe integers.');
		}
	}
}

/**
 * Bridge an owned source reader into a standard-library transform.
 *
 * The bridge has no input queue, but the downstream transform can still request
 * source items ahead of the consumer. Each item passes admission before the
 * transform sees it. Keeping the reader owner here
 * lets consumer return, abort or failure request cancellation of the real source,
 * rather than merely closing an intermediate transform.
 *
 * Closing releases the reader promptly. onCleanup reports eventual source
 * cancellation separately, because that cancellation may itself remain pending.
 */
async function* transform<Input, Output>(
	source: ReadableStream<Input>,
	provider: TransformStream<Input, Output>,
	options: ReaderOptions,
	admit: (value: Input) => Input,
	end: () => void = () => {},
): AsyncGenerator<Output> {
	const owner = readers.open(source, options);
	const input = new ReadableStream<Input>({
		async pull(controller) {
			try {
				const next = await owner.read();
				if (next.done) {
					end();
					controller.close();
				} else controller.enqueue(admit(next.value));
			} catch (error) {
				controller.error(error);
			}
		},
		cancel(reason) {
			void owner.close(reason);
		},
	}, { highWaterMark: 0 });
	try {
		for await (const value of iterable(input.pipeThrough(provider))) yield value;
	} finally {
		void owner.close('SSE consumer ended.');
	}
}

/**
 * Decode bounded server-sent event messages from response bytes.
 *
 * Limits count original bytes before decoding, including ignored fields and
 * partial messages. The standard-library parser handles UTF-8 replacement, an
 * initial byte-order mark and CR/LF line endings split across chunks.
 *
 * Results include comment-only and metadata-only messages and a nonempty final
 * message without its terminating blank line. Callers retain the last applied
 * event ID and own reconnecting; this function does not act as browser EventSource.
 * Use the request signal to interrupt a stalled read as well as a byte budget.
 */
export async function* read(source: ReadableStream<Uint8Array>, options: ReadOptions): AsyncGenerator<MessageType> {
	options = Object.freeze({ ...options });
	limits(options);
	if (!Number.isSafeInteger(options.maximumChunkBytes) || options.maximumChunkBytes < 0) {
		throw new RangeError('Invalid SSE chunk limit.');
	}
	let total = 0, eventBytes = 0, count = 0;
	let lineContent = false, pendingCR = false, initial = true;
	/** At most three prefix bytes are held to distinguish a split initial UTF-8 BOM from ordinary content. */
	const prefix: number[] = [];
	/** Charge one original byte, including separators that the parser later removes. */
	const charge = (): void => {
		if (++eventBytes > options.maximumEventBytes) throw new RangeError('SSE message exceeds maximumEventBytes.');
	};
	/** A blank logical line ends the raw message budget. A pending CR is resolved before the next non-LF byte. */
	const line = (): void => {
		if (!lineContent) eventBytes = 0;
		lineContent = false;
	};
	/** Track blank lines across chunk boundaries; CRLF must count as one line ending. */
	const byte = (value: number): void => {
		if (pendingCR) {
			pendingCR = false;
			if (value === 10) {
				charge();
				line();
				return;
			}
			line();
		}
		charge();
		if (value === 13) pendingCR = true;
		else if (value === 10) line();
		else lineContent = true;
	};
	/** Reject oversized chunks before parsing and maintain the cross-chunk event budget. */
	const admit = (chunk: Uint8Array): Uint8Array => {
		if (!(chunk instanceof Uint8Array)) throw new TypeError('SSE requires byte chunks.');
		if (chunk.length > options.maximumChunkBytes || chunk.length > options.maximumBytes - total) {
			throw new RangeError('SSE input exceeds its byte policy.');
		}
		total += chunk.length;
		for (const value of chunk) {
			if (initial) {
				prefix.push(value);
				if (value === [239, 187, 191][prefix.length - 1]) {
					if (prefix.length < 3) continue;
					for (let index = 0; index < 3; index++) charge();
					prefix.length = 0;
					initial = false;
					continue;
				}
				initial = false;
				for (const held of prefix) byte(held);
				prefix.length = 0;
			} else byte(value);
		}
		return chunk;
	};
	/** At EOF, charge a partial BOM as ordinary bytes and settle a trailing CR. */
	const end = (): void => {
		for (const held of prefix) byte(held);
		prefix.length = 0;
		if (pendingCR) line();
	};
	for await (const message of transform(source, new ServerSentEventParseStream(), options, admit, end)) {
		if (++count > options.maximumEvents) throw new RangeError('SSE exceeds maximumEvents.');
		if (message.retry !== undefined && (!Number.isSafeInteger(message.retry) || message.retry < 0)) {
			throw new RangeError('SSE retry exceeds safe milliseconds.');
		}
		yield Object.freeze(message);
	}
}

/**
 * Serialize bounded messages as SSE bytes, one source item at a time.
 * Message validation precedes serialization; byte admission follows encoding
 * because UTF-8 wire size can exceed text length. Output refusal terminates the
 * body and requests source cleanup. It cannot change headers already sent.
 * Event storage, acknowledgements, retention and reconnection belong to the host.
 */
export async function* write(source: ReadableStream<MessageType>, options: WriteOptions): AsyncGenerator<Uint8Array> {
	options = Object.freeze({ ...options });
	limits(options);
	const TextSchema = schema.string({ maxLength: options.maximumEventBytes });
	const MessageSchema = schema.object({
		comment: schema.optional(TextSchema),
		event: schema.optional(TextSchema),
		data: schema.optional(TextSchema),
		id: schema.optional(TextSchema),
		retry: schema.optional(schema.number({ integer: true, minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
	});
	let count = 0, total = 0;
	/** Check the message count and shape before standard-library serialization. */
	const admit = (value: MessageType): MessageType => {
		if (++count > options.maximumEvents) throw new RangeError('SSE exceeds maximumEvents.');
		const message = MessageSchema.parse(value);
		if (message.id?.includes('\0')) throw new TypeError('SSE IDs cannot contain NUL.');
		return message;
	};
	for await (const bytes of transform(source, new ServerSentEventStream(), options, admit)) {
		if (bytes.length > options.maximumEventBytes || bytes.length > options.maximumBytes - total) {
			throw new RangeError('SSE serialized bytes exceed their policy.');
		}
		total += bytes.length;
		yield bytes;
	}
}
