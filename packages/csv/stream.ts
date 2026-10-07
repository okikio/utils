import { buildColumns, isBlankRow, selectHeader } from './structure.ts';
import { recordStream } from './records.ts';

import { rank } from './dialect.ts';
import { assertTextCharacters, assertTextSource } from './content.ts';
import type { DecodedCsvSource } from './encoding.ts';
import { decodeBytes } from './encoding.ts';
import * as options from './options.ts';
import type { CsvColumn, CsvDiagnostic, CsvRow, CsvStreamDocument, CsvStreamOptions } from './types.ts';
import { CsvParseError } from './types.ts';

/** Buffered discovery bytes and the single original source-reader owner. */
interface PeekedStream {
	/** At most the configured discovery prefix; those bytes are replayed exactly once. */
	readonly prefix: Uint8Array;
	/** Original byte reader retained until replay reaches EOF or is cancelled. */
	readonly reader: ReadableStreamDefaultReader<Uint8Array>;
	/** Unconsumed suffix of a source chunk that crossed the prefix budget. */
	readonly tail?: Uint8Array;
	/** Whether the original source reached EOF while peeking. */
	readonly done: boolean;
	/** Release the source lock exactly once after EOF or cancellation settled reads. */
	readonly release: () => void;
	/** Cancel outstanding source reads and then release their original reader lock. */
	readonly cancel: (reason: unknown) => Promise<void>;
}

/**
 * Read at most the discovery budget while retaining the original reader for replay.
 *
 * A chunk crossing the budget has a separate tail; neither its prefix nor tail may be lost or read twice. This owner releases the source lock after EOF or settled cancellation, including discovery failures.
 */
async function peekStream(source: ReadableStream<Uint8Array>, limit: number): Promise<PeekedStream> {
	const reader = source.getReader();
	let released = false;
	const release = (): void => {
		if (released) return;
		reader.releaseLock();
		released = true;
	};
	const cancel = async (reason: unknown): Promise<void> => {
		try {
			if (!released) await reader.cancel(reason);
		} finally {
			release();
		}
	};
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
			const remaining = limit - length;
			if (result.value.byteLength <= remaining) {
				chunks.push(result.value);
				length += result.value.byteLength;
				continue;
			}
			chunks.push(result.value.subarray(0, remaining));
			length += remaining;
			return Object.freeze({
				prefix: concatenateBytes(chunks, length),
				reader,
				release,
				cancel,
				tail: result.value.subarray(remaining),
				done: false,
			});
		}
		return Object.freeze({ prefix: concatenateBytes(chunks, length), reader, done, release, cancel });
	} catch (error) {
		await cancel(error).catch(() => undefined);
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
		cancel: async (reason) => await peeked.cancel(reason),
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
 * Validate row and cell budgets before exposing a source occurrence.
 *
 * Width mismatches become diagnostics, while excessive width or cell size fails
 * the stream. Values remain uncoerced and retain their logical source row.
 *
 * @internal
 */
function createRow(
	values: readonly string[],
	logicalRow: number,
	columns: readonly CsvColumn[],
	maximumColumns: number,
	maximumCellCharacters: number,
): CsvRow {
	if (values.length > maximumColumns) {
		throw new CsvParseError(
			'too-many-columns',
			`Row ${logicalRow} contains ${values.length} columns; the limit is ${maximumColumns}.`,
			logicalRow,
		);
	}
	const diagnostics: CsvDiagnostic[] = [];
	if (values.length !== columns.length) {
		diagnostics.push(Object.freeze({
			code: 'row-width-mismatch',
			message: `Row ${logicalRow} has ${values.length} fields; the header has ${columns.length}.`,
			row: logicalRow,
		}));
	}
	for (let index = 0; index < values.length; index += 1) {
		const value = values[index] ?? '';
		if (value.length > maximumCellCharacters) {
			throw new CsvParseError(
				'cell-too-large',
				`Cell ${logicalRow}:${index + 1} exceeds the configured character limit.`,
				logicalRow,
				index + 1,
			);
		}
		if (/^[=+@]/.test(value) || /^-(?!\d+(?:\.\d+)?$)/.test(value)) {
			diagnostics.push(Object.freeze({
				code: 'spreadsheet-formula',
				message: `Cell ${logicalRow}:${index + 1} begins with a spreadsheet formula marker and was preserved as text.`,
				row: logicalRow,
				column: index + 1,
			}));
		}
	}
	return Object.freeze({
		row: logicalRow,
		values: Object.freeze([...values]),
		diagnostics: Object.freeze(diagnostics),
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
	const peeked = await peekStream(source, resolved.maximumPeekBytes);
	if (peeked.prefix.byteLength === 0) {
		await peeked.cancel('Empty CSV source.').catch(() => undefined);
		throw new CsvParseError('empty-file', 'The CSV file is empty.');
	}

	let decoded: DecodedCsvSource;
	try {
		if (resolved.textOnly) assertTextSource(peeked.prefix);
		decoded = decodeBytes(peeked.prefix, resolved.encoding, !peeked.done);
		if (resolved.textOnly) assertTextCharacters(decoded.text);
	} catch (error) {
		await peeked.cancel(error).catch(() => undefined);
		throw error;
	}
	const delimiter = resolved.delimiter !== 'auto' ? resolved.delimiter : rank(decoded.text)[0];
	if (!delimiter) {
		await peeked.cancel('CSV delimiter detection failed.').catch(() => undefined);
		throw new CsvParseError('invalid-csv', 'Unable to detect a supported CSV delimiter.');
	}

	const encoding = decoded.encoding === 'windows-1252' ? 'windows-1252' : 'utf-8';
	const records = replayStream(peeked)
		.pipeThrough(byteLimit(resolved.maximumBytes))
		.pipeThrough(createTextDecoderStream(encoding, resolved.textOnly))
		.pipeThrough(recordStream(delimiter));
	const recordReader = records.getReader();
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
		 * Cancel outstanding record and source reads, then release both reader locks exactly once.
		 *
		 * Set disposed before awaiting cancellation. The row generator uses this same owner from its finally block, so explicit disposal and iteration failure join the same cleanup promise.
		 */
		const dispose = (reason: unknown = 'CSV stream disposed.'): Promise<void> => {
			if (disposal) return disposal;
			disposed = true;
			disposal = (async () => {
				await recordReader.cancel(reason).catch(() => undefined);
				await peeked.cancel(reason).catch(() => undefined);
				recordReader.releaseLock();
			})();
			return disposal;
		};

		/**
		 * Yield buffered discovery records before continuing the record reader, preserving logical source positions.
		 *
		 * Blank-row policy affects emitted occurrences, not source row numbering. The emitted-row budget applies to both paths. Every exit joins source cancellation and releases the single reader owner.
		 */
		const rowIterator = async function* (): AsyncGenerator<CsvRow> {
			let logicalRow = headerIndex + 2;
			let emitted = 0;
			try {
				for (const values of buffered) {
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
					const next = await recordReader.read();
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
			} catch (error) {
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
		await recordReader.cancel(error).catch(() => undefined);
		await peeked.cancel(error).catch(() => undefined);
		recordReader.releaseLock();
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
