/** Typed rows reuse CSV framing and Standard Schema validation; no header guessing or cell coercion occurs here. @module */
import * as schema from '@okikio/schema';
import * as record from '@okikio/collection/record';
import type { CsvRow } from './types.ts';

/** Explicit mapping and accepted-work/report bounds for one row iterator. */
export interface RowOptionsType {
	/** Output field to zero-based source column. Duplicate source headers do not change these positions. */
	readonly columns: Readonly<Record<string, number>>;
	/** Maximum authored mappings, checked before reading the source. */
	readonly maximumColumns: number;
	/** Maximum input rows, including invalid and skipped rows. */
	readonly maximumRows: number;
	/** Maximum returned schema issues per row. Does not bound work inside a third-party validator. */
	readonly maximumIssues: number;
	/** Maximum returned issue path components. */
	readonly maximumPathLength: number;
	/** Throw on invalid rows, omit them, or yield their bounded diagnostics explicitly. */
	readonly onInvalid: 'throw' | 'skip' | 'yield';
	/** Checked before reading and after validation. Cannot interrupt a validator that ignores cancellation. */
	readonly signal?: AbortSignal;
}
/** Schema issue with its mapped one-based source column when the first path component names a mapped field. */
export interface RowIssueType {
	/** Unmodified vendor issue message and bounded path; it can contain source data. Treat it as sensitive. */
	readonly issue: NonNullable<schema.Failure['issues']>[number];
	/** One-based source column, absent for whole-row or unmapped issues. */
	readonly column?: number;
}
/** Original logical record identity survives validation; successful values have the schema's output type. */
export type RowResultType<Value> =
	| Readonly<{ readonly row: number; readonly kind: 'value'; readonly value: Value }>
	| Readonly<{ readonly row: number; readonly kind: 'mapping'; readonly missing: readonly string[] }>
	| Readonly<
		{
			readonly row: number;
			readonly kind: 'schema';
			readonly issues: readonly RowIssueType[];
			readonly truncated: boolean;
		}
	>;

/** Safe thrown row identity/category without source text or vendor diagnostic messages. */
export class CsvRowError extends Error {
	/** One-based logical CSV record, including preamble and header records. */
	readonly row: number;
	/** Missing mapped column differs from a schema rejection. Framing errors retain CsvParseError. */
	readonly kind: 'mapping' | 'schema';
	/** Expose source position and failure category without leaking the rejected cell or vendor message. */
	constructor(row: number, kind: 'mapping' | 'schema') {
		super(`CSV ${kind} failure at logical row ${row}.`);
		this.name = 'CsvRowError';
		this.row = row;
		this.kind = kind;
	}
}

/**
 * Map explicitly selected text cells and validate exactly once per complete row.
 * Earlier outputs remain partial work if a later row or source fails. Early return closes source
 * iteration. When using parseStream, keep its document in an await-using scope even before iteration
 * starts. This function borrows its source; it does not acquire or close a separate document owner.
 */
export async function* rows<Input, Output>(
	definition: schema.Schema<Input, Output>,
	source: Iterable<CsvRow> | AsyncIterable<CsvRow>,
	options: RowOptionsType,
): AsyncGenerator<RowResultType<Output>> {
	for (const value of [options.maximumColumns, options.maximumRows, options.maximumIssues, options.maximumPathLength]) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new RangeError('CSV row limits must be positive safe integers.');
		}
	}
	if (!['throw', 'skip', 'yield'].includes(options.onInvalid)) {
		throw new TypeError('Explicit CSV invalid-row policy is required.');
	}
	schema.assert(definition);
	const authored = record.entries(options.columns);
	if (authored.length > options.maximumColumns) throw new RangeError('CSV mapping exceeds maximumColumns.');
	const entries: [string, number][] = [];
	for (const [field, column] of authored) {
		if (typeof column !== 'number' || !Number.isSafeInteger(column) || column < 0) {
			throw new RangeError('CSV column positions must be non-negative safe integers.');
		}
		entries.push([field, column]);
	}
	const positions = new Map(entries);
	let count = 0;
	for await (const row of source) {
		options.signal?.throwIfAborted();
		if (++count > options.maximumRows) throw new RangeError('CSV input exceeds maximumRows.');
		const input: Record<string, string> = Object.create(null);
		const missing: string[] = [];
		for (const [field, column] of entries) {
			if (column >= row.values.length) missing.push(field);
			else input[field] = row.values[column]!;
		}
		const rowNumber = row.row;
		let output: RowResultType<Output>;
		if (missing.length > 0) {
			output = Object.freeze({ row: rowNumber, kind: 'mapping', missing: Object.freeze(missing) });
		} else {
			const result = await schema.validate(definition, input, {
				maximumIssues: options.maximumIssues,
				maximumPathLength: options.maximumPathLength,
			});
			options.signal?.throwIfAborted();
			if (result.issues === undefined) {
				yield Object.freeze({ row: rowNumber, kind: 'value', value: result.value });
				continue;
			}
			output = Object.freeze({
				row: rowNumber,
				kind: 'schema',
				truncated: result.truncated ?? false,
				issues: Object.freeze(result.issues.map((issue) => {
					const first = issue.path?.[0];
					const key = typeof first === 'object' && first !== null ? first.key : first;
					const column = typeof key === 'string' ? positions.get(key) : undefined;
					return Object.freeze({ issue, ...(column === undefined ? {} : { column: column + 1 }) });
				})),
			});
		}
		if (options.onInvalid === 'throw') throw new CsvRowError(rowNumber, output.kind);
		if (options.onInvalid === 'yield') yield output;
	}
}
