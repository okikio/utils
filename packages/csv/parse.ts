import { parse as parseCsvRecords } from '@std/csv/parse'

import { rank } from './dialect.ts'
import { decodeBytes, decodeText, type DecodedCsvSource } from './encoding.ts'
import * as csvOptions from './options.ts'
import type { ResolvedCsvOptions } from './options.ts'
import { buildColumns, createRow, isBlankRow, selectHeader } from './structure.ts'
import {
	CsvParseError,
	type CsvDelimiter,
	type CsvDocument,
	type CsvRow,
	type CsvParseOptions,
} from './types.ts'


/** Parse one decoded source using one exact delimiter and map grammar failures into the public error type. */
function parseRecords(text: string, delimiter: CsvDelimiter): string[][] {
	try {
		return parseCsvRecords(text, { separator: delimiter, fieldsPerRecord: -1 }) as string[][]
	} catch (cause) {
		throw new CsvParseError(
			'invalid-csv',
			cause instanceof Error ? `Invalid CSV: ${cause.message}` : 'Invalid CSV input.',
		)
	}
}

/** Try the requested delimiter or ranked supported delimiters until one produces a non-blank record. */
function parseUsingDialect(text: string, requested: CsvParseOptions['delimiter']): {
	readonly delimiter: CsvDelimiter
	readonly records: string[][]
} {
	const candidates = requested && requested !== 'auto' ? [requested] : rank(text)
	let lastError: CsvParseError | undefined

	for (const delimiter of candidates) {
		try {
			const records = parseRecords(text, delimiter)
			if (records.some((record) => !isBlankRow(record))) return { delimiter, records }
		} catch (cause) {
			if (cause instanceof CsvParseError) lastError = cause
		}
	}

	throw lastError ?? new CsvParseError(
		'invalid-csv',
		'The source is not a valid comma-, semicolon-, or tab-delimited document.',
	)
}

/**
 * Build one collecting CSV document from already decoded text.
 *
 * This is the shared collecting path after byte decoding. It enforces the
 * decoded-character limit, chooses the delimiter and header, applies the same
 * structural row policy as streaming parsing, and freezes parser-owned output.
 *
 * @internal
 */
function parseDecoded(source: DecodedCsvSource, options: ResolvedCsvOptions): CsvDocument {
	if (source.text.length === 0) throw new CsvParseError('empty-file', 'The CSV file is empty.')

	if (source.text.length > options.maximumCharacters) {
		throw new CsvParseError(
			'source-too-large',
			`The decoded CSV source exceeds the configured ${options.maximumCharacters.toLocaleString()} character limit.`,
		)
	}

	const { delimiter, records } = parseUsingDialect(source.text, options.delimiter ?? 'auto')
	const headerIndex = selectHeader(records, options)
	const header = records[headerIndex]
	if (!header || header.every((value) => value.trim().length === 0)) {
		throw new CsvParseError('missing-header', 'The CSV document does not contain a usable header row.')
	}

	if (header.length > options.maximumColumns) {
		throw new CsvParseError(
			'too-many-columns',
			`The CSV contains ${header.length} columns; the configured limit is ${options.maximumColumns}.`,
		)
	}

	const diagnostics = [...source.diagnostics]
	if (headerIndex > 0) {
		diagnostics.push({
			code: 'preamble-skipped',
			message: `${headerIndex} logical record(s) were skipped before the selected header.`,
		})
	}

	const columns = buildColumns(header, diagnostics)
	const rows: CsvRow[] = []

	for (let index = headerIndex + 1; index < records.length; index += 1) {
		const values = records[index] ?? []
		if (isBlankRow(values)) continue
		if (rows.length >= options.maximumRows) {
			throw new CsvParseError('too-many-rows', `The CSV exceeds the configured ${options.maximumRows.toLocaleString()} row limit.`)
		}

		const row = createRow(values, index + 1, columns, options.maximumColumns, options.maximumCellCharacters)
		diagnostics.push(...row.diagnostics)
		rows.push(row)
	}

	if (rows.length === 0) {
		diagnostics.push({ code: 'header-only', message: 'The CSV contains a header but no data rows.' })
	}

	return Object.freeze({
		...(options.fileName ? { fileName: options.fileName } : {}),
		encoding: source.encoding,
		delimiter,
		lineEnding: source.lineEnding,
		headerRow: headerIndex + 1,
		columns,
		rows: Object.freeze(rows),
		preamble: Object.freeze(records.slice(0, headerIndex).map((record) => Object.freeze([...record]))),
		diagnostics: Object.freeze(diagnostics.map((diagnostic) => Object.freeze(diagnostic))),
	})
}

/**
 * Parses decoded CSV text without coercing identifiers, dates, numbers, or formulas.
 *
 * @example
 * ```ts
 * const document = csv.parse('Company,Website\nNorthstar,https://northstar.example')
 * console.log(document.columns[1]?.normalizedName) // "website"
 * ```
 */
export function parse(text: string, options: CsvParseOptions = {}): CsvDocument {
	const resolved = csvOptions.parse(options)
	return parseDecoded(decodeText(text), resolved)
}

/** Parses original CSV bytes with strict UTF-8 detection and bounded structural limits. */
export function parseBytes(bytes: Uint8Array, options: CsvParseOptions = {}): CsvDocument {
	const resolved = csvOptions.parse(options)
	if (bytes.byteLength > resolved.maximumBytes) {
		throw new CsvParseError(
			'source-too-large',
			`The CSV source exceeds the configured ${resolved.maximumBytes.toLocaleString()} byte limit.`,
		)
	}
	return parseDecoded(decodeBytes(bytes, resolved.encoding), resolved)
}
