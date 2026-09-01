import { CsvParseStream } from '@std/csv/parse-stream'

import { rank } from './dialect.ts'
import { decodeBytes } from './encoding.ts'
import * as csvOptions from './options.ts'
import type { ResolvedCsvStreamOptions } from './options.ts'
import { buildColumns, createRow, isBlankRow, selectHeader } from './structure.ts'
import {
	CsvParseError,
	type CsvDelimiter,
	type CsvDiagnostic,
	type CsvRow,
	type CsvStreamDocument,
	type CsvStreamOptions,
} from './types.ts'

interface PeekedStream {
	readonly prefix: Uint8Array
	readonly reader: ReadableStreamDefaultReader<Uint8Array>
	readonly tail?: Uint8Array
	readonly done: boolean
}

/**
 * Reads a bounded prefix without losing bytes needed by later consumers of bounded CSV parsing.
 *
 * CSV internals preserve streaming and diagnostics so import code can reject malformed or oversized input without materializing unbounded data.
 *
 * @internal
 */
async function peekStream(source: ReadableStream<Uint8Array>, limit: number): Promise<PeekedStream> {
	const reader = source.getReader()
	const chunks: Uint8Array[] = []
	let length = 0
	let done = false
	try {
		while (length < limit) {
			const result = await reader.read()
			if (result.done) {
				done = true
				break
			}
			const remaining = limit - length
			if (result.value.byteLength <= remaining) {
				chunks.push(result.value)
				length += result.value.byteLength
				continue
			}
			chunks.push(result.value.subarray(0, remaining))
			length += remaining
			return Object.freeze({
				prefix: concatenateBytes(chunks, length),
				reader,
				tail: result.value.subarray(remaining),
				done: false,
			})
		}
		return Object.freeze({ prefix: concatenateBytes(chunks, length), reader, done })
	} catch (error) {
		await reader.cancel(error).catch(() => undefined)
		throw error
	}
}

/**
 * Concatenates the bytes into one bounded value for bounded CSV parsing.
 *
 * @internal
 */
function concatenateBytes(chunks: readonly Uint8Array[], length: number): Uint8Array {
	const output = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) {
		output.set(chunk, offset)
		offset += chunk.byteLength
	}
	return output
}

/**
 * Replays the buffered prefix before continuing the original stream in bounded CSV parsing.
 *
 * CSV internals preserve streaming and diagnostics so import code can reject malformed or oversized input without materializing unbounded data.
 *
 * @internal
 */
function replayStream(peeked: PeekedStream): ReadableStream<Uint8Array> {
	let prefixPending = peeked.prefix.byteLength > 0
	let tail = peeked.tail
	return new ReadableStream<Uint8Array>({
		/**
		 * Pulls the next value only when bounded CSV parsing is ready to accept it.
		 *
		 * CSV internals preserve streaming and diagnostics so import code can reject malformed or oversized input without materializing unbounded data.
		 *
		 * @internal
		 */
		async pull(controller) {
			if (prefixPending) {
				prefixPending = false
				controller.enqueue(peeked.prefix)
				if (peeked.done) controller.close()
				return
			}
			if (tail !== undefined) {
				const value = tail
				tail = undefined
				controller.enqueue(value)
				return
			}
			const result = await peeked.reader.read()
			if (result.done) controller.close()
			else controller.enqueue(result.value)
		},
		cancel: async (reason) => await peeked.reader.cancel(reason),
	})
}

/**
 * Enforces the byte limit before bounded CSV parsing admits more data.
 *
 * CSV internals preserve streaming and diagnostics so import code can reject malformed or oversized input without materializing unbounded data.
 *
 * @internal
 */
function byteLimit(maximumBytes: number): TransformStream<Uint8Array, Uint8Array> {
	let total = 0
	return new TransformStream({
		/**
		 * Transforms data through the transform step used by bounded CSV parsing.
		 *
		 * @internal
		 */
		transform(chunk, controller) {
			total += chunk.byteLength
			if (total > maximumBytes) {
				throw new CsvParseError(
					'source-too-large',
					`The CSV source exceeds the configured ${maximumBytes.toLocaleString()} byte limit.`,
				)
			}
			controller.enqueue(chunk)
		},
	})
}

/**
 * Parse a byte stream into one owned, one-shot, backpressure-aware CSV stream.
 *
 * The returned document must be consumed or disposed. Source bytes, rows,
 * columns, and cells are bounded by explicit limits.
 */
export async function parseStream(
	source: ReadableStream<Uint8Array>,
	options: CsvStreamOptions = {},
): Promise<CsvStreamDocument> {
	const resolved = csvOptions.stream(options)
	const peeked = await peekStream(source, resolved.maximumPeekBytes)
	if (peeked.prefix.byteLength === 0) {
		await peeked.reader.cancel('Empty CSV source.').catch(() => undefined)
		throw new CsvParseError('empty-file', 'The CSV file is empty.')
	}

	const decoded = decodeBytes(peeked.prefix, resolved.encoding)
	const delimiter = resolved.delimiter !== 'auto'
		? resolved.delimiter
		: rank(decoded.text)[0]
	if (!delimiter) {
		await peeked.reader.cancel('CSV delimiter detection failed.').catch(() => undefined)
		throw new CsvParseError('invalid-csv', 'Unable to detect a supported CSV delimiter.')
	}

	const encoding = decoded.encoding === 'windows-1252' ? 'windows-1252' : 'utf-8'
	const records = replayStream(peeked)
		.pipeThrough(byteLimit(resolved.maximumBytes))
		.pipeThrough(createTextDecoderStream(encoding))
		.pipeThrough(new CsvParseStream({ separator: delimiter, fieldsPerRecord: -1 }))
	const recordReader = records.getReader()
	let disposed = false
	let rowsStarted = false

	try {
		const discovery: string[][] = []
		const discoveryRows = typeof resolved.headerRow === 'number'
			? Math.max(resolved.headerScanRows, resolved.headerRow)
			: resolved.headerScanRows
		while (discovery.length < discoveryRows) {
			const next = await recordReader.read()
			if (next.done) break
			discovery.push(next.value)
		}
		const headerIndex = selectHeader(discovery, resolved)
		const header = discovery[headerIndex]
		if (!header) throw new CsvParseError('missing-header', 'The CSV document does not contain a usable header row.')
		if (header.length > resolved.maximumColumns) {
			throw new CsvParseError(
				'too-many-columns',
				`The CSV contains ${header.length} columns; the limit is ${resolved.maximumColumns}.`,
			)
		}
		const diagnostics: CsvDiagnostic[] = [...decoded.diagnostics]
		if (headerIndex > 0) diagnostics.push(Object.freeze({ code: 'preamble-skipped', message: `${headerIndex} logical record(s) were skipped before the header.` }))
		const columns = buildColumns(header, diagnostics)
		const buffered = discovery.slice(headerIndex + 1)

		/**
		 * Disposes owned state exactly once and releases all module-owned resources.
		 *
		 * @internal
		 */
		async function dispose(reason: unknown = 'CSV stream disposed.'): Promise<void> {
			if (disposed) return
			disposed = true
			await recordReader.cancel(reason).catch(() => undefined)
			recordReader.releaseLock()
		}

		/**
		 * Yield validated rows without retaining the remainder of the source.
		 *
		 * Header-discovery rows are drained first, then records are read only as the
		 * consumer advances the iterator. The `finally` block owns reader cleanup so
		 * normal exhaustion, parser failure, and early consumer termination all release
		 * the same stream resources.
		 *
		 * @internal
		 */
		async function* rowIterator(): AsyncGenerator<CsvRow> {
			let logicalRow = headerIndex + 2
			let emitted = 0
			try {
				for (const values of buffered) {
					if (!isBlankRow(values)) {
						if (emitted >= resolved.maximumRows) throw new CsvParseError('too-many-rows', `The CSV exceeds the configured ${resolved.maximumRows.toLocaleString()} row limit.`)
						emitted += 1
						yield createRow(values, logicalRow, columns, resolved.maximumColumns, resolved.maximumCellCharacters)
					}
					logicalRow += 1
				}
				while (true) {
					const next = await recordReader.read()
					if (next.done) break
					if (!isBlankRow(next.value)) {
						if (emitted >= resolved.maximumRows) throw new CsvParseError('too-many-rows', `The CSV exceeds the configured ${resolved.maximumRows.toLocaleString()} row limit.`)
						emitted += 1
						yield createRow(next.value, logicalRow, columns, resolved.maximumColumns, resolved.maximumCellCharacters)
					}
					logicalRow += 1
				}
			} catch (error) {
				if (error instanceof CsvParseError) throw error
				throw new CsvParseError('invalid-csv', error instanceof Error ? `Invalid CSV: ${error.message}` : 'Invalid CSV input.')
			} finally {
				await dispose()
			}
		}

		let activeIterator: AsyncGenerator<CsvRow> | undefined
		const rows: AsyncIterable<CsvRow> = Object.freeze({
			/**
			 * Returns the native async iterator view used by streaming iteration protocols.
			 *
			 * @internal
			 */
			[Symbol.asyncIterator](): AsyncIterator<CsvRow> {
				if (disposed) throw new TypeError('CSV row stream is disposed.')
				if (rowsStarted) throw new TypeError('CSV row streams are one-shot.')
				rowsStarted = true
				activeIterator = rowIterator()
				return activeIterator
			},
		})
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
			 * Releases owned state and waits for cleanup completion when used with `await using`.
			 *
			 * @internal
			 */
			async [Symbol.asyncDispose]() {
				await activeIterator?.return?.(undefined).catch(() => undefined)
				await dispose()
			},
		})
	} catch (error) {
		await recordReader.cancel(error).catch(() => undefined)
		recordReader.releaseLock()
		if (error instanceof CsvParseError) throw error
		throw new CsvParseError('invalid-csv', error instanceof Error ? `Invalid CSV: ${error.message}` : 'Invalid CSV input.')
	}
}

/**
 * Creates text decoder stream while preserving the module's ownership rules.
 *
 * It keeps CSV discovery and parsing bounded while preserving diagnostics that higher-level import code can act on.
 *
 * @internal
 */
function createTextDecoderStream(
	encoding: 'utf-8' | 'windows-1252',
): TransformStream<Uint8Array<ArrayBufferLike>, string> {
	const decoder = new TextDecoder(encoding)
	return new TransformStream<Uint8Array<ArrayBufferLike>, string>({
		/**
		 * Transforms data through the transform step used by bounded CSV parsing.
		 *
		 * @internal
		 */
		transform(chunk, controller) {
			const text = decoder.decode(chunk, { stream: true })
			if (text.length > 0) controller.enqueue(text)
		},
		/**
		 * Flushes buffered parser state when bounded CSV parsing reaches end of input.
		 *
		 * @internal
		 */
		flush(controller) {
			const text = decoder.decode()
			if (text.length > 0) controller.enqueue(text)
		},
	})
}
