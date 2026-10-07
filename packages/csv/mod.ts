/**
 * Turn a messy spreadsheet export into bounded text rows with header evidence and diagnostics. Splitting on commas loses quoted commas, multiline cells, duplicate headers and byte-encoding errors.
 *
 * Collect small bounded input with parseBytes(); use parseStream() and fold rows for a large import. Explicit headers avoid guessing when an upstream format is known. preserveBlankRows keeps empty source occurrences when reconciliation depends on row positions; textOnly opts into rejecting non-text input. Cells remain text, including formula-like content. Applications decide whether to reject formulas when exporting to a spreadsheet and whether diagnostics should stop an import. Disposal releases a one-shot stream reader.
 *
 * @example
 * ```ts
 * import * as csv from '@okikio/csv';
 * const document = csv.parse(`Name,Note
 * Ada,"hello, world"
 * `, { headerRow: 1 });
 * console.log(document.columns.map((column) => column.key).join(','));
 * console.log(JSON.stringify(document.rows[0]?.values));
 * ```
 *
 * @module
 */
export { normalizeHeader } from './headers.ts';
export { parse, parseBytes } from './parse.ts';
export { parseStream } from './stream.ts';
export { CsvParseError } from './types.ts';
export type {
	CsvColumn,
	CsvDelimiter,
	CsvDiagnostic,
	CsvDiagnosticCode,
	CsvDocument,
	CsvEncoding,
	CsvLineEnding,
	CsvParseOptions,
	CsvRow,
	CsvStreamDocument,
	CsvStreamMetadata,
	CsvStreamOptions,
} from './types.ts';
