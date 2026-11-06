/** Bounded JSON input and JSON Lines framing through borrowed Web Streams. @module */
import { bytes } from './bytes.ts';
import * as schema from '@okikio/schema';
import { split } from './frame.ts';
import { lines as textLines } from './mod.ts';

/** Read a single strict UTF-8 JSON value. Shape validation belongs to the caller's schema. */
export async function read(
	source: ReadableStream<Uint8Array>,
	maximumBytes: number,
	signal?: AbortSignal,
): Promise<unknown> {
	return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bytes(source, maximumBytes, signal)));
}

/** Explicit document, line and record budgets for incremental JSON Lines input. */
export interface Options {
	/** Maximum original bytes across the complete input, including line endings. */
	readonly maximumBytes: number;
	/** Maximum bytes in one line, excluding LF but including a preceding CR. */
	readonly maximumLineBytes: number;
	/** Maximum records, including values such as null and false. Blank lines are invalid. */
	readonly maximumItems: number;
	/** Cancellation stops pending reads and releases the source reader. */
	readonly signal?: AbortSignal;
}

/**
 * Parse strict UTF-8 JSON Lines incrementally with bounded total input and record size.
 * Early return cancels the input. Previously yielded records remain partial work
 * when a later line fails; only successful EOF proves the complete document was read.
 */
export async function* lines(source: ReadableStream<Uint8Array>, options: Options): AsyncGenerator<unknown> {
	for (const value of [options.maximumBytes, options.maximumLineBytes, options.maximumItems]) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new RangeError('JSON Lines budgets must be positive safe integers.');
		}
	}
	let count = 0;
	for await (
		const line of textLines(source, {
			maximumBytes: options.maximumBytes,
			maximumLineBytes: options.maximumLineBytes,
			signal: options.signal,
			fatal: true,
		})
	) {
		if (++count > options.maximumItems) throw new RangeError('JSON Lines exceeds the record budget.');
		yield JSON.parse(line);
	}
}

/**
 * Encode one JSON value with an LF terminator and a byte limit, without coercing undefined.
 * Values are caller-owned trusted data: JSON.stringify can call toJSON or accessors.
 * The byte limit bounds accepted output; it does not bound serialization's temporary allocation.
 */
export function encode(value: unknown, maximumBytes = 65536): Uint8Array {
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
		throw new RangeError('JSON output budget must be a positive safe integer.');
	}
	const text = JSON.stringify(value);
	if (text === undefined) throw new TypeError('JSON output requires a serializable value.');
	const output = new TextEncoder().encode(text + '\n');
	if (output.byteLength > maximumBytes) throw new RangeError('JSON output exceeds the byte budget.');
	return output;
}

/** Write one bounded JSON Line. The caller owns the writer, backpressure, close and abort. */
export async function write(
	writer: Pick<WritableStreamDefaultWriter<Uint8Array>, 'write'>,
	value: unknown,
	maximumBytes = 65536,
): Promise<void> {
	await writer.write(encode(value, maximumBytes));
}

/** Exact original frame start, including preceding CR/LF and UTF-8 bytes; record numbers are one-based. */
export type DecodedRecordType<Value> =
	| Readonly<{ readonly record: number; readonly byteOffset: number; readonly kind: 'value'; readonly value: Value }>
	| Readonly<{ readonly record: number; readonly byteOffset: number; readonly kind: 'syntax' }>
	| Readonly<
		{
			readonly record: number;
			readonly byteOffset: number;
			readonly kind: 'schema';
			readonly issues: NonNullable<schema.ValidationResult<Value>['issues']>;
			readonly truncated: boolean;
		}
	>;

/** Retain the exact record and failure category without including a secret-bearing JSON source or vendor message. */
export class JsonRecordError extends Error {
	readonly record: number;
	readonly byteOffset: number;
	readonly kind: 'syntax' | 'schema';
	/** Locate the failed record without retaining JSON text or an application validator message. */
	constructor(record: number, byteOffset: number, kind: 'syntax' | 'schema') {
		super(`JSONL ${kind} failure at record ${record}, byte ${byteOffset}.`);
		this.name = 'JsonRecordError';
		this.record = record;
		this.byteOffset = byteOffset;
		this.kind = kind;
	}
}

/** Validate JSONL once per record. Yield bounded per-record evidence or fail fast; previous values remain partial work. */
export async function* decode<Input, Output>(
	definition: schema.Schema<Input, Output>,
	source: ReadableStream<Uint8Array>,
	options:
		& Options
		& Readonly<
			{
				readonly maximumChunkBytes: number;
				readonly maximumIssues: number;
				readonly maximumPathLength: number;
				readonly errors: 'throw' | 'yield';
				readonly onCleanup?: import('./reader.ts').ReaderOptions['onCleanup'];
			}
		>,
): AsyncGenerator<DecodedRecordType<Output>> {
	for (const value of [options.maximumItems, options.maximumIssues, options.maximumPathLength]) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new RangeError('JSONL record/issue/path limits must be positive safe integers.');
		}
	}
	if (!['throw', 'yield'].includes(options.errors)) throw new TypeError('Explicit JSONL error policy is required.');
	schema.assert(definition);
	let record = 0;
	let byteOffset = 0;
	for await (
		const frame of split(source, new Uint8Array([10]), {
			maximumBytes: options.maximumBytes,
			maximumChunkBytes: options.maximumChunkBytes,
			maximumFrameBytes: options.maximumLineBytes,
			incomplete: 'emit',
			signal: options.signal,
			onCleanup: options.onCleanup,
		})
	) {
		if (++record > options.maximumItems) throw new RangeError('JSONL exceeds maximumItems.');
		// Count original frame bytes plus LF, not decoded character length; CR stays in its frame.
		const offset = byteOffset;
		byteOffset += frame.length + 1;
		let value: unknown;
		try {
			value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: record !== 1 }).decode(frame));
		} catch (error) {
			if (!(error instanceof SyntaxError) && !(error instanceof TypeError)) throw error;
			if (options.errors === 'throw') throw new JsonRecordError(record, offset, 'syntax');
			yield Object.freeze({ record, byteOffset: offset, kind: 'syntax' });
			continue;
		}
		const result = await schema.validate(definition, value, {
			maximumIssues: options.maximumIssues,
			maximumPathLength: options.maximumPathLength,
		});
		options.signal?.throwIfAborted();
		if (result.issues !== undefined) {
			if (options.errors === 'throw') throw new JsonRecordError(record, offset, 'schema');
			yield Object.freeze({
				record,
				byteOffset: offset,
				kind: 'schema',
				issues: result.issues,
				truncated: result.truncated ?? false,
			});
		} else yield Object.freeze({ record, byteOffset: offset, kind: 'value', value: result.value });
	}
}
