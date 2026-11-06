import * as readers from '@okikio/streams/reader';
import type { CleanupOutcome, Reader, ReaderOptions } from '@okikio/streams/reader';
import { DialectObserver } from './source.ts';
import type { CsvDialectType } from './source.ts';
import { buildColumns, createRow, isBlankRow, selectHeader } from './structure.ts';
import { recordStream } from './records.ts';

import { rank } from './dialect.ts';
import { assertTextCharacters, assertTextSource } from './content.ts';
import type { DecodedCsvSource } from './encoding.ts';
import { decodeBytes } from './encoding.ts';
import * as options from './options.ts';
import type { CsvDiagnostic, CsvRow, CsvStreamDocument, CsvStreamOptions } from './types.ts';
import { CsvParseError } from './types.ts';

/** Buffered discovery bytes and the single original source-reader owner. */
interface PeekedStream {
	/** At most the configured discovery prefix; those bytes are replayed exactly once. */
	readonly prefix: Uint8Array;
	/** Original byte reader retained until replay reaches EOF or is cancelled. */
	readonly reader: Reader<Uint8Array>;
	/** Unconsumed suffix of a source chunk that crossed the prefix budget. */
	readonly tail?: Uint8Array;
	/** Whether the original source reached EOF while peeking. */
	readonly done: boolean;
	/** Release the source lock exactly once after EOF or cancellation settled reads. */
	readonly release: () => void;
	/** Cancel outstanding source reads and then release their original reader lock. */
	readonly cancel: (reason: unknown) => Promise<CleanupOutcome>;
}

/**
 * Read at most the discovery budget while retaining the original reader for replay.
 *
 * A chunk crossing the budget has a separate tail; neither its prefix nor tail may be lost or read twice. This owner releases the source lock after EOF or settled cancellation, including discovery failures.
 */
async function peekStream(
	source: ReadableStream<Uint8Array>,
	limit: number,
	settings: ReaderOptions,
	explicit: boolean,
	maximumBytes: number,
): Promise<PeekedStream> {
	const reader = readers.open(source, settings);
	const release = (): void => {
		void reader.close();
	};
	const cancel = (reason: unknown): Promise<CleanupOutcome> => reader.close(reason);
	const chunks: Uint8Array[] = [];
	let length = 0;
	let done = false;
	try {
		while (length < limit) {
			const result = await reader.read();
			if (result.done) {
				done = true;
				break;
			}
			if (!(result.value instanceof Uint8Array)) throw new TypeError('CSV byte streams require Uint8Array chunks.');
			if (length + result.value.byteLength > maximumBytes) {
				throw new CsvParseError(
					'source-too-large',
					`The CSV source exceeds the configured ${maximumBytes} byte limit.`,
				);
			}
			const remaining = limit - length;
			if (result.value.byteLength <= remaining) {
				chunks.push(result.value.slice());
				length += result.value.byteLength;
				// Explicit format choices need only enough bytes to recognize a possible UTF-8 BOM.
				// Do not wait for an arbitrary prefix budget on a live source that already has a header.
				if (explicit && length > 0) {
					const prefix = concatenateBytes(chunks, length);
					if (length >= 3 || prefix[0] !== 0xef || (length >= 2 && prefix[1] !== 0xbb)) {
						return Object.freeze({ prefix, reader, done: false, release, cancel });
					}
				}
				continue;
			}
			chunks.push(result.value.slice(0, remaining));
			length += remaining;
			return Object.freeze({
				prefix: concatenateBytes(chunks, length),
				reader,
				release,
				cancel,
				tail: result.value.slice(remaining),
				done: false,
			});
		}
		return Object.freeze({ prefix: concatenateBytes(chunks, length), reader, done, release, cancel });
	} catch (error) {
		void cancel(error);
		throw error;
	}
}

/**
 * Copy the bounded discovery chunks into an exactly sized byte prefix; the crossing chunk tail stays separate.
 */
function concatenateBytes(chunks: readonly Uint8Array[], length: number): Uint8Array {
	const output = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

/**
 * Replay the discovery prefix and crossing tail once, then continue the original reader on demand.
 *
 * EOF releases the source lock. Cancellation stops pending source reads before releasing that same lock; downstream parsing does not become a second source owner.
 */
function replayStream(peeked: PeekedStream): ReadableStream<Uint8Array> {
	let prefixPending = peeked.prefix.byteLength > 0;
	let tail = peeked.tail;
	return new ReadableStream<Uint8Array>({
		/**
		 * Emit the buffered prefix or tail before requesting another source chunk, releasing the source reader at EOF.
		 */
		async pull(controller) {
			if (prefixPending) {
				prefixPending = false;
				controller.enqueue(peeked.prefix);
				if (peeked.done) {
					peeked.release();
					controller.close();
				}
				return;
			}
			if (tail !== undefined) {
				const value = tail;
				tail = undefined;
				controller.enqueue(value);
				return;
			}
			const result = await peeked.reader.read();
			if (result.done) {
				peeked.release();
				controller.close();
			} else controller.enqueue(result.value);
		},
		cancel(reason) {
			void peeked.cancel(reason);
		},
	});
}

/**
 * Count original source bytes across all replayed chunks and reject before forwarding a chunk over budget.
 */
function byteLimit(maximumBytes: number): TransformStream<Uint8Array, Uint8Array> {
	let total = 0;
	return new TransformStream({
		/**
		 * Count this chunk against the aggregate byte budget before allowing the decoder to consume it.
		 */
		transform(chunk, controller) {
			total += chunk.byteLength;
			if (total > maximumBytes) {
				throw new CsvParseError(
					'source-too-large',
					`The CSV source exceeds the configured ${maximumBytes.toLocaleString()} byte limit.`,
				);
			}
			controller.enqueue(chunk);
		},
	});
}

/**
 * Parse a byte stream into one owned, one-shot, backpressure-aware CSV stream.
 *
 * The returned document must be consumed or disposed. Source bytes, rows,
 * columns, and cells are bounded by explicit limits.
 */
export async function parseStream(
	source: ReadableStream<Uint8Array>,
	opts: CsvStreamOptions = {},
): Promise<CsvStreamDocument> {
	const resolved = options.stream(opts);
	const peeked = await peekStream(
		source,
		resolved.maximumPeekBytes,
		{ signal: opts.signal, onCleanup: opts.onCleanup },
		resolved.delimiter !== 'auto' && resolved.encoding !== 'auto',
		resolved.maximumBytes,
	);
	if (peeked.prefix.byteLength === 0) {
		void peeked.cancel('Empty CSV source.');
		throw new CsvParseError('empty-file', 'The CSV file is empty.');
	}

	let decoded: DecodedCsvSource;
	try {
		if (resolved.textOnly) assertTextSource(peeked.prefix);
		decoded = decodeBytes(peeked.prefix, resolved.encoding, !peeked.done);
		if (resolved.textOnly) assertTextCharacters(decoded.text);
	} catch (error) {
		void peeked.cancel(error);
		throw error;
	}
	const delimiter = resolved.delimiter !== 'auto' ? resolved.delimiter : rank(decoded.text)[0];
	if (!delimiter) {
		void peeked.cancel('CSV delimiter detection failed.');
		throw new CsvParseError('invalid-csv', 'Unable to detect a supported CSV delimiter.');
	}

	const encoding = decoded.encoding === 'windows-1252' ? 'windows-1252' : 'utf-8';
	const observer = new DialectObserver(delimiter, decoded.encoding);
	let dialect: CsvDialectType | undefined;
	const records = replayStream(peeked)
		.pipeThrough(byteLimit(resolved.maximumBytes))
		.pipeThrough(createTextDecoderStream(encoding, resolved.textOnly))
		.pipeThrough(
			new TransformStream<string, string>({
				transform(text, controller) {
					observer.write(text);
					controller.enqueue(text);
				},
			}),
		)
		.pipeThrough(recordStream(delimiter));
	const recordReader = readers.open(records, { signal: opts.signal });
	let disposed = false;
	let rowsStarted = false;
	let disposal: Promise<void> | undefined;

	try {
		const discovery: string[][] = [];
		// Explicit source rows are independent of the automatic discovery budget.
		const discoveryRows = typeof resolved.headerRow === 'number' ? resolved.headerRow : resolved.headerScanRows;
		while (discovery.length < discoveryRows) {
			const next = await recordReader.read();
			if (next.done) break;
			discovery.push(next.value);
		}
		const headerIndex = selectHeader(discovery, resolved);
		const header = discovery[headerIndex];
		if (!header) throw new CsvParseError('missing-header', 'The CSV document does not contain a usable header row.');
		if (header.length > resolved.maximumColumns) {
			throw new CsvParseError(
				'too-many-columns',
				`The CSV contains ${header.length} columns; the limit is ${resolved.maximumColumns}.`,
			);
		}
		if (resolved.textOnly && header.some((value) => value.length > resolved.maximumCellCharacters)) {
			throw new CsvParseError('cell-too-large', 'A CSV header exceeds the configured cell-character limit.');
		}
		const diagnostics: CsvDiagnostic[] = [...decoded.diagnostics];
		if (headerIndex > 0) {
			diagnostics.push(
				Object.freeze({
					code: 'preamble-skipped',
					message: `${headerIndex} logical record(s) were skipped before the header.`,
				}),
			);
		}
		const columns = buildColumns(header, diagnostics);
		const buffered = discovery.slice(headerIndex + 1);

		/**
		 * Cancel outstanding record and source reads, and release both reader locks exactly once. Eventual source cleanup remains inspectable.
		 *
		 * Set disposed before requesting cancellation. The row generator uses this same owner from its finally block, so explicit disposal and iteration failure share the same idempotent local teardown.
		 */
		const dispose = (reason: unknown = 'CSV stream disposed.'): Promise<void> => {
			if (disposal) return disposal;
			disposed = true;
			void recordReader.close(reason);
			void peeked.cancel(reason);
			disposal = Promise.resolve();
			return disposal;
		};

		/**
		 * Yield buffered discovery records before continuing the record reader, preserving logical source positions.
		 *
		 * Blank-row policy affects emitted occurrences, not source row numbering. The emitted-row budget applies to both paths. Every exit requests source cancellation and releases the reader; cleanup records its eventual result.
		 */
		const rowIterator = async function* (): AsyncGenerator<CsvRow> {
			let logicalRow = headerIndex + 2;
			let emitted = 0;
			try {
				for (const values of buffered) {
					opts.signal?.throwIfAborted();
					if (disposed) return;
					if (resolved.preserveBlankRows || !isBlankRow(values)) {
						if (emitted >= resolved.maximumRows) {
							throw new CsvParseError(
								'too-many-rows',
								`The CSV exceeds the configured ${resolved.maximumRows.toLocaleString()} row limit.`,
							);
						}
						emitted += 1;
						yield createRow(values, logicalRow, columns, resolved.maximumColumns, resolved.maximumCellCharacters);
					}
					logicalRow += 1;
				}
				while (true) {
					opts.signal?.throwIfAborted();
					if (disposed) return;
					const next = await recordReader.read();
					opts.signal?.throwIfAborted();
					if (disposed) return;
					if (next.done) break;
					if (resolved.preserveBlankRows || !isBlankRow(next.value)) {
						if (emitted >= resolved.maximumRows) {
							throw new CsvParseError(
								'too-many-rows',
								`The CSV exceeds the configured ${resolved.maximumRows.toLocaleString()} row limit.`,
							);
						}
						emitted += 1;
						yield createRow(next.value, logicalRow, columns, resolved.maximumColumns, resolved.maximumCellCharacters);
					}
					logicalRow += 1;
				}
				dialect = observer.finish();
			} catch (error) {
				if (disposed && !opts.signal?.aborted) return;
				if (opts.signal?.aborted) throw opts.signal.reason;
				if (error instanceof CsvParseError) throw error;
				throw new CsvParseError(
					'invalid-csv',
					error instanceof Error ? `Invalid CSV: ${error.message}` : 'Invalid CSV input.',
					undefined,
					undefined,
					{ cause: error },
				);
			} finally {
				await dispose();
			}
		};

		let activeIterator: AsyncGenerator<CsvRow> | undefined;
		const rows: AsyncIterable<CsvRow> = Object.freeze({
			/**
			 * Start the single permitted row iterator; a disposed or already-started document cannot be read again.
			 */
			[Symbol.asyncIterator](): AsyncIterator<CsvRow> {
				if (disposed) throw new TypeError('CSV row stream is disposed.');
				if (rowsStarted) throw new TypeError('CSV row streams are one-shot.');
				rowsStarted = true;
				activeIterator = rowIterator();
				return activeIterator;
			},
		});
		return Object.freeze({
			cleanup: peeked.reader.cleanup,
			get dialect() {
				return dialect;
			},
			...(resolved.fileName !== undefined ? { fileName: resolved.fileName } : {}),
			encoding: decoded.encoding,
			delimiter,
			headerRow: headerIndex + 1,
			columns,
			preamble: Object.freeze(discovery.slice(0, headerIndex).map((row) => Object.freeze([...row]))),
			diagnostics: Object.freeze(diagnostics),
			rows,
			/**
			 * Cancel blocked reads before joining iterator return; reversing that order can wait forever on the read being cancelled.
			 */
			async [Symbol.asyncDispose]() {
				await dispose();
				await activeIterator?.return?.(undefined).catch(() => undefined);
			},
		});
	} catch (error) {
		void recordReader.close(error);
		void peeked.cancel(error);
		if (opts.signal?.aborted) throw opts.signal.reason;
		if (error instanceof CsvParseError) throw error;
		throw new CsvParseError(
			'invalid-csv',
			error instanceof Error ? `Invalid CSV: ${error.message}` : 'Invalid CSV input.',
			undefined,
			undefined,
			{ cause: error },
		);
	}
}

/**
 * Decode byte chunks while retaining incomplete multibyte characters between reads.
 *
 * UTF-8 decoding is fatal after its encoding was selected; Windows-1252 follows
 * the explicit legacy path. Final decoder flush catches an incomplete last
 * character, and text-only admission checks both ordinary and flushed text.
 *
 * @internal
 */
function createTextDecoderStream(
	encoding: 'utf-8' | 'windows-1252',
	textOnly: boolean,
): TransformStream<Uint8Array<ArrayBufferLike>, string> {
	const decoder = new TextDecoder(encoding, { fatal: encoding === 'utf-8' });
	return new TransformStream<Uint8Array<ArrayBufferLike>, string>({
		/**
		 * Decode this chunk while retaining incomplete byte sequences; text-only policy also applies to every decoded segment.
		 */
		transform(chunk, controller) {
			const text = decoder.decode(chunk, { stream: true });
			if (textOnly) assertTextCharacters(text);
			if (text.length > 0) controller.enqueue(text);
		},
		/**
		 * Flush incomplete decoder state at EOF so a truncated final UTF-8 character cannot be accepted silently.
		 */
		flush(controller) {
			const text = decoder.decode();
			if (textOnly) assertTextCharacters(text);
			if (text.length > 0) controller.enqueue(text);
		},
	});
}
