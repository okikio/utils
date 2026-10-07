import { buildColumns, isBlankRow, selectHeader } from './structure.ts';
import { assertTextCharacters, assertTextSource } from './content.ts';
import { records as parseCsvRecords } from './records.ts';

import { rank } from './dialect.ts';
import type { DecodedCsvSource } from './encoding.ts';
import { decodeBytes, decodeText } from './encoding.ts';
import * as options from './options.ts';
import type { ResolvedCsvOptions } from './options.ts';
import type { CsvDelimiter, CsvDiagnostic, CsvDocument, CsvParseOptions, CsvRow } from './types.ts';
import { CsvParseError } from './types.ts';

/**
 * Parse one delimiter without coercion and translate parser failures into the stable invalid-csv code.
 */
function parseRecords(text: string, delimiter: CsvDelimiter): string[][] {
	try {
		return parseCsvRecords(text, delimiter);
	} catch (cause) {
		throw new CsvParseError(
			'invalid-csv',
			cause instanceof Error ? `Invalid CSV: ${cause.message}` : 'Invalid CSV input.',
		);
	}
}

/**
 * Try an explicit delimiter or ranked candidates until a nonblank record supplies evidence.
 *
 * Blank-only input cannot establish an automatic dialect. Preserve the last parser failure when all candidates fail so malformed quoting still has useful diagnostics.
 */
function parseUsingDialect(text: string, requested: CsvParseOptions['delimiter']): {
	delimiter: CsvDelimiter;
	records: string[][];
} {
	const candidates = requested && requested !== 'auto' ? [requested] : rank(text);
	let lastError: CsvParseError | undefined;

	for (const delimiter of candidates) {
		try {
			const records = parseRecords(text, delimiter);
			if (records.some((record) => !isBlankRow(record))) return { delimiter, records };
		} catch (cause) {
			if (cause instanceof CsvParseError) lastError = cause;
		}
	}

	throw lastError ?? new CsvParseError(
		'invalid-csv',
		'The source is not a valid comma-, semicolon-, or tab-delimited document.',
	);
}

/**
 * Reject an oversized source cell and record formula-like prefixes without evaluating or coercing the text.
 *
 * Row and column are one-based source coordinates. Numeric negative values remain ordinary text; the application decides whether a formula warning blocks an import.
 */
function validateCell(
	value: string,
	row: number,
	column: number,
	maximumCellCharacters: number,
	diagnostics: CsvDiagnostic[],
): void {
	if (value.length > maximumCellCharacters) {
		throw new CsvParseError(
			'cell-too-large',
			`Cell ${row}:${column} exceeds the configured ${maximumCellCharacters.toLocaleString()} character limit.`,
			row,
			column,
		);
	}
	if (/^[=+@]/.test(value) || /^-(?!\d+(?:\.\d+)?$)/.test(value)) {
		diagnostics.push({
			code: 'spreadsheet-formula',
			message: `Cell ${row}:${column} begins with a spreadsheet formula marker and was preserved as text.`,
			row,
			column,
		});
	}
}

/**
 * Build one immutable document after source, header, row and cell admission succeeds.
 *
 * Logical row numbers include preamble and skipped blank records. Width mismatches remain observations; explicit budgets reject the document. Source cells, raw headers and diagnostics retain separate ownership so import previews can explain normalization.
 */
function parseDecoded(source: DecodedCsvSource, options: ResolvedCsvOptions): CsvDocument {
	if (options.textOnly) assertTextCharacters(source.text);
	if (source.text.length === 0) throw new CsvParseError('empty-file', 'The CSV file is empty.');

	if (source.text.length > options.maximumCharacters) {
		throw new CsvParseError(
			'source-too-large',
			`The decoded CSV source exceeds the configured ${options.maximumCharacters.toLocaleString()} character limit.`,
		);
	}

	const { delimiter, records } = parseUsingDialect(source.text, options.delimiter ?? 'auto');
	const headerIndex = selectHeader(records, options);
	const header = records[headerIndex];
	if (!header) {
		throw new CsvParseError('missing-header', 'The CSV document does not contain a usable header row.');
	}

	if (options.textOnly && header.some((value) => value.length > options.maximumCellCharacters)) {
		throw new CsvParseError('cell-too-large', 'A CSV header exceeds the configured cell-character limit.');
	}
	if (header.length > options.maximumColumns) {
		throw new CsvParseError(
			'too-many-columns',
			`The CSV contains ${header.length} columns; the configured limit is ${options.maximumColumns}.`,
		);
	}

	const diagnostics = [...source.diagnostics];
	if (headerIndex > 0) {
		diagnostics.push({
			code: 'preamble-skipped',
			message: `${headerIndex} logical record(s) were skipped before the selected header.`,
		});
	}

	const columns = buildColumns(header, diagnostics);
	const rows: CsvRow[] = [];

	for (let index = headerIndex + 1; index < records.length; index += 1) {
		const values = records[index] ?? [];
		if (!options.preserveBlankRows && isBlankRow(values)) continue;
		if (rows.length >= options.maximumRows) {
			throw new CsvParseError(
				'too-many-rows',
				`The CSV exceeds the configured ${options.maximumRows.toLocaleString()} row limit.`,
			);
		}

		const row = index + 1;
		const rowDiagnostics: CsvDiagnostic[] = [];
		if (values.length > options.maximumColumns) {
			throw new CsvParseError(
				'too-many-columns',
				`Row ${row} contains ${values.length} columns; the configured limit is ${options.maximumColumns}.`,
				row,
			);
		}
		if (values.length !== columns.length) {
			rowDiagnostics.push({
				code: 'row-width-mismatch',
				message: `Row ${row} has ${values.length} fields; the header has ${columns.length}.`,
				row,
			});
		}
		for (let column = 0; column < values.length; column += 1) {
			validateCell(values[column] ?? '', row, column + 1, options.maximumCellCharacters, rowDiagnostics);
		}
		const frozenRowDiagnostics = Object.freeze(rowDiagnostics.map((diagnostic) => Object.freeze(diagnostic)));
		diagnostics.push(...frozenRowDiagnostics);
		rows.push(Object.freeze({
			row,
			values: Object.freeze([...values]),
			diagnostics: frozenRowDiagnostics,
		}));
	}

	if (rows.length === 0) {
		diagnostics.push({ code: 'header-only', message: 'The CSV contains a header but no data rows.' });
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
	});
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
export function parse(text: string, opts: CsvParseOptions = {}): CsvDocument {
	const resolved = options.parse(opts);
	return parseDecoded(decodeText(text), resolved);
}

/** Parses original CSV bytes with strict UTF-8 detection and bounded structural limits. */
export function parseBytes(bytes: Uint8Array, opts: CsvParseOptions = {}): CsvDocument {
	const resolved = options.parse(opts);
	if (bytes.byteLength > resolved.maximumBytes) {
		throw new CsvParseError(
			'source-too-large',
			`The CSV source exceeds the configured ${resolved.maximumBytes.toLocaleString()} byte limit.`,
		);
	}
	if (resolved.textOnly) assertTextSource(bytes);
	return parseDecoded(decodeBytes(bytes, resolved.encoding), resolved);
}
