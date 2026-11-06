import { stringify } from '@std/csv/stringify';
import * as source from './source.ts';
import type * as types from './types.ts';

/** Encode one complete scalar with the maintained CSV writer, without buffering its surrounding record. */
export function cell(
	value: string,
	dialect: Pick<source.CsvDialectType, 'delimiter' | 'quoting' | 'recordDelimiter'>,
): string;
/** Encode one scalar using comma and CRLF framing defaults. */
export function cell(value: string): string;
export function cell(
	value: string,
	dialect?: Pick<source.CsvDialectType, 'delimiter' | 'quoting' | 'recordDelimiter'>,
): string {
	// Ask the CSV writer to quote one field, then remove only its record terminator.
	const encoded = stringify([[value]], { separator: dialect?.delimiter ?? ',', headers: false }).slice(0, -2);
	// std/csv ends records with CRLF and has no quote-all option. Bare CR also needs quoting for our CR dialect.
	if (!encoded.startsWith('"') && (dialect?.quoting === 'all' || value.includes('\r'))) {
		return `"${value.replaceAll('"', '""')}"`;
	}
	return encoded;
}

/** Record framing stays separate so arbitrarily wide records need only one complete cell in memory. */
export const comma = ',';
/** CRLF terminator for separately framed output. */
export const recordEnd = '\r\n';

/** Prefix generated spreadsheet formula markers. Source cells must bypass this opt-in presentation policy. */
export function spreadsheet(value: string): string {
	return /^\s*[=+@]/u.test(value) || /^\s*-(?!\d+(?:\.\d+)?$)/u.test(value) ? `'${value}` : value;
}

/** Standard interoperable export choices. Source-format export passes the captured dialect instead. */
export const standard: source.CsvDialectType = Object.freeze({
	version: 1,
	delimiter: ',',
	encoding: 'utf-8',
	lineEnding: 'lf',
	recordDelimiter: '\n',
	quoting: 'minimal',
	finalNewline: true,
});

/** A source character cannot be encoded without loss; callers can offer Standard UTF-8 export. */
export class EncodingError extends Error {
	/** Stable machine-readable failure classification. */
	readonly code = 'unrepresentable-character';
	/** First scalar that cannot be represented without loss. */
	readonly character: string;
	/** Identify the first scalar that strict source encoding refused. */
	constructor(character: string) {
		super(
			`The source Windows-1252 encoding cannot represent U+${
				character.codePointAt(0)!.toString(16).toUpperCase()
			}. Choose Standard CSV (UTF-8).`,
		);
		this.name = 'EncodingError';
		this.character = character;
	}
}

/** WHATWG Windows-1252 decode pairs provide the inverse, including its five retained control-byte mappings. */
function windows1252Map(): ReadonlyMap<string, number> {
	const decoder = new TextDecoder('windows-1252');
	return new Map(Array.from({ length: 256 }, (_, byte) => [decoder.decode(new Uint8Array([byte])), byte]));
}
let windows1252: ReadonlyMap<string, number> | undefined;

/** Encode one bounded scalar strictly. A BOM is emitted separately by the document owner, exactly once. */
export function encode(value: string, encoding: types.CsvEncoding = 'utf-8'): Uint8Array {
	if (encoding !== 'windows-1252') return new TextEncoder().encode(value);
	windows1252 ??= windows1252Map();
	const bytes = new Uint8Array(value.length);
	let offset = 0;
	// Iterate Unicode characters, not UTF-16 halves, so an unrepresentable character fails as one value.
	for (const character of value) {
		const byte = windows1252.get(character);
		if (byte === undefined) throw new EncodingError(character);
		bytes[offset++] = byte;
	}
	return bytes.subarray(0, offset);
}

/** Encode the UTF-8 source signature, or no bytes for sources without that signature. */
export function bom(encoding: types.CsvEncoding): Uint8Array {
	return encoding === 'utf-8-bom' ? new Uint8Array([0xef, 0xbb, 0xbf]) : new Uint8Array();
}

/** Caller limits for one incremental document. The caller owns its destination and input resource. */
export interface SerializeOptions {
	/** Cooperative cancellation checked before each record and byte chunk; early exit closes the input iterator. */
	signal?: AbortSignal;
	/** Maximum bytes emitted, including BOM and separators. @default 67108864 */
	maximumBytes?: number;
	/** Maximum UTF-16 code units in one source scalar. @default 1000000 */
	maximumCellCharacters?: number;
	/** Maximum logical input records, including caller-supplied headers and preamble. @default 1000000 */
	maximumRows?: number;
	/** Maximum emitted byte chunk. One complete bounded cell is encoded at a time. @default 65536 */
	chunkBytes?: number;
}

/**
 * Serialize ordered records incrementally with one source dialect.
 *
 * Supply preamble and header records explicitly. Values are never coerced or
 * formula-rewritten. The iterator emits one BOM, retains the final-newline
 * choice, and releases an async input iterator on failure or early return.
 * A blocked input must observe the borrowed signal itself. Successful EOF is
 * the only complete document receipt; callers discard partial output on error.
 */
export async function* serialize(
	rows: Iterable<readonly string[]> | AsyncIterable<readonly string[]>,
	dialect: source.CsvDialectType = standard,
	opts: SerializeOptions = {},
): AsyncGenerator<Uint8Array> {
	// Caller-owned objects cannot change framing or cancellation authority after the first pull.
	const selected = source.CsvDialectSchema.parse(dialect), signal = opts.signal;
	const maximumBytes = opts.maximumBytes ?? 64 * 1024 * 1024;
	const maximumCellCharacters = opts.maximumCellCharacters ?? 1_000_000;
	const maximumRows = opts.maximumRows ?? 1_000_000;
	const chunkBytes = opts.chunkBytes ?? 65_536;
	for (const value of [maximumBytes, maximumCellCharacters, maximumRows, chunkBytes]) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new RangeError('CSV serialization limits must be positive safe integers.');
		}
	}
	let total = 0;
	/** Charge the complete encoded cell before yielding slices; output chunks do not add another cell buffer. */
	function* chunks(bytes: Uint8Array) {
		total += bytes.byteLength;
		if (total > maximumBytes) throw new RangeError('CSV serialization exceeds its byte limit.');
		for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
			signal?.throwIfAborted();
			yield bytes.subarray(offset, offset + chunkBytes);
		}
	}
	signal?.throwIfAborted();
	yield* chunks(bom(selected.encoding));
	let count = 0;
	for await (const row of rows) {
		signal?.throwIfAborted();
		if (count === maximumRows) throw new RangeError('CSV serialization exceeds its record limit.');
		if (count++) yield* chunks(encode(selected.recordDelimiter, selected.encoding));
		for (let index = 0; index < row.length; index++) {
			const value = row[index]!;
			if (typeof value !== 'string') throw new TypeError('CSV serialization requires uncoerced string values.');
			if (value.length > maximumCellCharacters) {
				throw new RangeError('CSV serialization exceeds its cell-character limit.');
			}
			if (index) yield* chunks(encode(selected.delimiter, selected.encoding));
			yield* chunks(encode(cell(value, selected), selected.encoding));
		}
	}
	if (count && selected.finalNewline) yield* chunks(encode(selected.recordDelimiter, selected.encoding));
}
