import * as record from '@okikio/record'

import type {
	CsvDelimiter,
	CsvEncoding,
	CsvParseOptions,
	CsvStreamOptions,
} from './types.ts'

const DEFAULTS = Object.freeze({
	maximumBytes: 64 * 1024 * 1024,
	maximumCharacters: 64 * 1024 * 1024,
	maximumRows: 1_000_000,
	maximumColumns: 512,
	maximumCellCharacters: 1_000_000,
	headerScanRows: 25,
	maximumPeekBytes: 256 * 1024,
})

const PARSE_KEYS = Object.freeze({
	fileName: true,
	delimiter: true,
	headerRow: true,
	encoding: true,
	maximumBytes: true,
	maximumCharacters: true,
	maximumRows: true,
	maximumColumns: true,
	maximumCellCharacters: true,
	headerScanRows: true,
} as const)

const STREAM_KEYS = Object.freeze({ ...PARSE_KEYS, maximumPeekBytes: true } as const)

/** Resolved collecting-parser options after defaults, limits, and unknown-key validation are applied. */
export interface ResolvedCsvOptions {
	readonly fileName?: string
	readonly delimiter: CsvDelimiter | 'auto'
	readonly headerRow: number | 'auto'
	readonly encoding: 'auto' | Exclude<CsvEncoding, 'utf-8-bom'>
	readonly maximumBytes: number
	readonly maximumCharacters: number
	readonly maximumRows: number
	readonly maximumColumns: number
	readonly maximumCellCharacters: number
	readonly headerScanRows: number
}

/** Resolved streaming-parser options, including the bounded prefix used before streaming continues. */
export interface ResolvedCsvStreamOptions extends Omit<ResolvedCsvOptions, 'maximumCharacters'> {
	readonly maximumPeekBytes: number
}

/** Resolve one positive safe-integer limit from caller input or the package default. */
function limit(value: unknown, fallback: number, name: string): number {
	if (value === undefined) return fallback
	if (!Number.isSafeInteger(value) || (value as number) < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`)
	}
	return value as number
}

/** Reject unknown option keys before any option value is consumed. */
function assertKeys(value: Readonly<Record<string, unknown>>, allowed: Readonly<Record<string, true>>, name: string): void {
	for (const key of Object.keys(value)) {
		if (!Object.hasOwn(allowed, key)) throw new TypeError(`${name} contains unknown option ${JSON.stringify(key)}.`)
	}
}

/** Validate and snapshot options shared by collecting and streaming parsing. */
function resolve(
	options: CsvParseOptions | CsvStreamOptions,
	allowed: Readonly<Record<string, true>>,
	name: string,
): ResolvedCsvOptions {
	record.assert(options, name)
	assertKeys(options, allowed, name)

	const fileName = options.fileName
	if (fileName !== undefined && typeof fileName !== 'string') {
		throw new TypeError('fileName must be a string.')
	}

	const delimiter = options.delimiter ?? 'auto'
	if (delimiter !== 'auto' && delimiter !== ',' && delimiter !== ';' && delimiter !== '\t') {
		throw new TypeError('delimiter must be "auto", ",", ";", or a tab character.')
	}

	const headerRow = options.headerRow ?? 'auto'
	if (headerRow !== 'auto' && (!Number.isSafeInteger(headerRow) || headerRow < 1)) {
		throw new RangeError('headerRow must be "auto" or a positive safe integer.')
	}

	const encoding = options.encoding ?? 'auto'
	if (encoding !== 'auto' && encoding !== 'utf-8' && encoding !== 'windows-1252') {
		throw new TypeError('encoding must be "auto", "utf-8", or "windows-1252".')
	}

	return Object.freeze({
		...(fileName !== undefined ? { fileName } : {}),
		delimiter,
		headerRow,
		encoding,
		maximumBytes: limit(options.maximumBytes, DEFAULTS.maximumBytes, 'maximumBytes'),
		maximumCharacters: limit(
			'maximumCharacters' in options ? options.maximumCharacters : undefined,
			DEFAULTS.maximumCharacters,
			'maximumCharacters',
		),
		maximumRows: limit(options.maximumRows, DEFAULTS.maximumRows, 'maximumRows'),
		maximumColumns: limit(options.maximumColumns, DEFAULTS.maximumColumns, 'maximumColumns'),
		maximumCellCharacters: limit(
			options.maximumCellCharacters,
			DEFAULTS.maximumCellCharacters,
			'maximumCellCharacters',
		),
		headerScanRows: limit(options.headerScanRows, DEFAULTS.headerScanRows, 'headerScanRows'),
	})
}

/** Normalize collecting parse policy before any source data is inspected. */
export function parse(options: CsvParseOptions = {}): ResolvedCsvOptions {
	return resolve(options, PARSE_KEYS, 'CSV parse options')
}

/** Normalize streaming parse policy before the first asynchronous source read. */
export function stream(options: CsvStreamOptions = {}): ResolvedCsvStreamOptions {
	const resolved = resolve(options, STREAM_KEYS, 'CSV stream options')
	return Object.freeze({
		...(resolved.fileName !== undefined ? { fileName: resolved.fileName } : {}),
		delimiter: resolved.delimiter,
		headerRow: resolved.headerRow,
		encoding: resolved.encoding,
		maximumBytes: resolved.maximumBytes,
		maximumRows: resolved.maximumRows,
		maximumColumns: resolved.maximumColumns,
		maximumCellCharacters: resolved.maximumCellCharacters,
		headerScanRows: resolved.headerScanRows,
		maximumPeekBytes: Math.min(
			limit(options.maximumPeekBytes, DEFAULTS.maximumPeekBytes, 'maximumPeekBytes'),
			resolved.maximumBytes,
		),
	})
}
