import { normalizeHeader } from './headers.ts'
import { CsvParseError, type CsvColumn, type CsvDiagnostic, type CsvRow } from './types.ts'

/** Number of rows used to judge whether a candidate header matches the following record width. */
const HEADER_CONSISTENCY_ROWS = 50

/** Structural header-selection policy shared by collecting and streaming parsing. */
export interface HeaderSelectionOptions {
	/** Explicit one-based header row or automatic structural detection. */
	readonly headerRow: number | 'auto'
	/** Maximum number of records inspected only when header selection is automatic. */
	readonly headerScanRows: number
}

/** Return whether a CSV record contains no non-whitespace source value. */
export function isBlankRow(row: readonly string[]): boolean {
	return row.length === 0 || row.every((value) => value.trim().length === 0)
}

/**
 * Select the one-based source header from a bounded record prefix.
 *
 * An explicit `headerRow` is not constrained by `headerScanRows`. Callers must
 * therefore read enough records to include an explicit row before calling this
 * function. `headerScanRows` limits only automatic discovery.
 */
export function selectHeader(
	records: readonly (readonly string[])[],
	options: HeaderSelectionOptions,
): number {
	if (typeof options.headerRow === 'number') {
		const index = options.headerRow - 1
		if (index >= records.length) {
			throw new CsvParseError('invalid-header-row', 'The configured header row is outside the parsed document.')
		}
		return index
	}

	const limit = Math.min(records.length, options.headerScanRows)
	let selected = -1
	let selectedScore = Number.NEGATIVE_INFINITY
	for (let index = 0; index < limit; index += 1) {
		const candidateScore = scoreHeader(records, index)
		if (candidateScore <= selectedScore) continue
		selected = index
		selectedScore = candidateScore
	}
	if (selected < 0 || !Number.isFinite(selectedScore)) {
		throw new CsvParseError('missing-header', 'The CSV document does not contain a usable header row.')
	}
	return selected
}

/** Build immutable structural columns and append recoverable header diagnostics. */
export function buildColumns(
	headers: readonly string[],
	diagnostics: CsvDiagnostic[],
): readonly CsvColumn[] {
	const occurrences = new Map<string, number>()

	return Object.freeze(headers.map((source, index) => {
		const name = source.replace(/^\ufeff/, '').trim()
		const normalizedName = normalizeHeader(name)
		const baseKey = normalizedName || `column_${index + 1}`
		const occurrence = (occurrences.get(baseKey) ?? 0) + 1
		occurrences.set(baseKey, occurrence)

		if (!name) {
			diagnostics.push(Object.freeze({
				code: 'blank-header',
				message: `Column ${index + 1} has no header and was assigned “${baseKey}”.`,
				column: index + 1,
			}))
		} else if (occurrence > 1) {
			diagnostics.push(Object.freeze({
				code: 'duplicate-header',
				message: `Header “${name}” appears more than once.`,
				column: index + 1,
				header: name,
			}))
		}

		return Object.freeze({
			index,
			name: name || `Column ${index + 1}`,
			key: occurrence === 1 ? baseKey : `${baseKey}__${occurrence}`,
			normalizedName,
		})
	}))
}

/**
 * Validate and freeze one data row under the shared structural limits.
 *
 * This operation preserves every source value as text. Formula-like values are
 * observations only; they are never rewritten or executed.
 */
export function createRow(
	values: readonly string[],
	logicalRow: number,
	columns: readonly CsvColumn[],
	maximumColumns: number,
	maximumCellCharacters: number,
): CsvRow {
	if (values.length > maximumColumns) {
		throw new CsvParseError(
			'too-many-columns',
			`Row ${logicalRow} contains ${values.length} columns; the configured limit is ${maximumColumns}.`,
			logicalRow,
		)
	}

	const diagnostics: CsvDiagnostic[] = []
	if (values.length !== columns.length) {
		diagnostics.push(Object.freeze({
			code: 'row-width-mismatch',
			message: `Row ${logicalRow} has ${values.length} fields; the header has ${columns.length}.`,
			row: logicalRow,
		}))
	}

	for (let index = 0; index < values.length; index += 1) {
		validateCell(values[index] ?? '', logicalRow, index + 1, maximumCellCharacters, diagnostics)
	}

	return Object.freeze({
		row: logicalRow,
		values: Object.freeze([...values]),
		diagnostics: Object.freeze(diagnostics),
	})
}

/** Score one possible header without interpreting product-specific column meaning. */
function scoreHeader(records: readonly (readonly string[])[], index: number): number {
	const row = records[index]
	if (!row) return Number.NEGATIVE_INFINITY
	const nonEmpty = row.filter((value) => value.trim().length > 0)
	if (nonEmpty.length < 1) return Number.NEGATIVE_INFINITY

	const textLike = row.filter(looksLikeHeaderValue).length
	const normalized = nonEmpty.map(normalizeHeader)
	const duplicates = normalized.length - new Set(normalized).size
	const following = records
		.slice(index + 1, index + 1 + HEADER_CONSISTENCY_ROWS)
		.filter((candidate) => !isBlankRow(candidate))
	const consistent = following.length === 0
		? 0
		: following.filter((candidate) => candidate.length === row.length).length / following.length
	const uniqueness = normalized.length === 0 ? 0 : new Set(normalized).size / normalized.length

	return textLike * 8 + consistent * 40 + uniqueness * 20 + Math.min(row.length, 40) - duplicates * 3 - index * 2
}

/** Return whether a source value has the structural shape expected of a header label. */
function looksLikeHeaderValue(value: string): boolean {
	const normalized = value.trim()
	if (!normalized || normalized.length > 160) return false
	if (/https?:\/\//i.test(normalized) || /\S+@\S+/.test(normalized)) return false
	return /[\p{L}_]/u.test(normalized)
}

/** Enforce one cell limit and append recoverable spreadsheet-formula evidence. */
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
		)
	}
	if (!/^[=+@]/.test(value) && !/^-(?!\d+(?:\.\d+)?$)/.test(value)) return

	diagnostics.push(Object.freeze({
		code: 'spreadsheet-formula',
		message: `Cell ${row}:${column} begins with a spreadsheet formula marker and was preserved as text.`,
		row,
		column,
	}))
}
