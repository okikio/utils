import * as schema from '@okikio/schema';
import type * as types from './types.ts';

/** Persisted serialization choices. Mixed record endings normalize to the first observed ending. */
export const CsvDialectSchema: schema.ObjectReader<
	{
		readonly version: schema.JsonReader<1, 1>;
		readonly delimiter: schema.JsonReader<',' | ';' | '\t', ',' | ';' | '\t'>;
		readonly encoding: schema.JsonReader<
			'utf-8' | 'utf-8-bom' | 'windows-1252',
			'utf-8' | 'utf-8-bom' | 'windows-1252'
		>;
		readonly lineEnding: schema.JsonReader<
			'crlf' | 'lf' | 'cr' | 'mixed' | 'none',
			'crlf' | 'lf' | 'cr' | 'mixed' | 'none'
		>;
		readonly recordDelimiter: schema.JsonReader<'\r\n' | '\n' | '\r', '\r\n' | '\n' | '\r'>;
		readonly quoting: schema.JsonReader<'all' | 'minimal', 'all' | 'minimal'>;
		readonly finalNewline: schema.JsonReader<boolean, boolean>;
	},
	'reject'
> = schema.object({
	/** Serialization metadata revision; independent of a dataset schema version. */
	version: schema.literal(1),
	/** Observed structural field separator. */
	delimiter: schema.oneOf([',', ';', '\t']),
	/** Explicit decoding choice, including an observed UTF-8 signature. */
	encoding: schema.oneOf(['utf-8', 'utf-8-bom', 'windows-1252']),
	/** Only record separators count; newlines inside quoted cells remain values. */
	lineEnding: schema.oneOf(['crlf', 'lf', 'cr', 'mixed', 'none']),
	/** Separator used when serializing records. */
	recordDelimiter: schema.oneOf(['\r\n', '\n', '\r']),
	/** Quote all fields or only fields that require quoting. */
	quoting: schema.oneOf(['all', 'minimal']),
	/** Whether a record separator followed the final source record. */
	finalNewline: schema.boolean(),
});
/** Versioned, schema-owned CSV serialization metadata. */
export type CsvDialectType = schema.Output<typeof CsvDialectSchema>;

/** Incremental observation of record framing without retaining cells or copying the source. */
export class DialectObserver {
	#quoted = false;
	#quotePending = false;
	#fieldStart = true;
	#allQuoted = true;
	#fields = 0;
	#crPending = false;
	#finalNewline = false;
	#endings = new Set<'\r\n' | '\n' | '\r'>();
	#firstEnding: '\r\n' | '\n' | '\r' | undefined;
	/** Caller-selected separator used by the structural parser. */
	readonly delimiter: types.CsvDelimiter;
	/** Validated source encoding used by the structural decoder. */
	readonly encoding: types.CsvEncoding;
	/** Observe the same parser framing without retaining the source document. */
	constructor(delimiter: types.CsvDelimiter, encoding: types.CsvEncoding) {
		this.delimiter = delimiter;
		this.encoding = encoding;
	}
	/** Observe decoded chunks in order. State spans CRLF pairs and escaped quotes split across chunks. */
	write(text: string): void {
		for (const character of text) {
			if (this.#quotePending) {
				this.#quotePending = false;
				if (character === '"') continue;
				this.#quoted = false;
			}
			if (this.#quoted) {
				if (character === '"') this.#quotePending = true;
				this.#finalNewline = false;
				continue;
			}
			if (this.#crPending) {
				this.#crPending = false;
				this.#ending(character === '\n' ? '\r\n' : '\r');
				if (character === '\n') continue;
			}
			if (character === '\r' || character === '\n') {
				if (this.#fieldStart) this.#allQuoted = false;
				this.#fieldStart = true;
				this.#finalNewline = true;
				if (character === '\r') this.#crPending = true;
				else this.#ending('\n');
			} else if (character === this.delimiter) {
				if (this.#fieldStart) this.#allQuoted = false;
				this.#fieldStart = true;
				this.#finalNewline = false;
			} else {
				if (this.#fieldStart) {
					this.#fields++;
					if (character === '"') this.#quoted = true;
					else this.#allQuoted = false;
					this.#fieldStart = false;
				}
				this.#finalNewline = false;
			}
		}
	}
	/** Retain the first separator for export while also recording whether source separators were mixed. */
	#ending(ending: '\r\n' | '\n' | '\r'): void {
		this.#firstEnding ??= ending;
		this.#endings.add(ending);
	}
	/** Resolve framing at EOF; callers must not treat a prefix snapshot as a complete source dialect. */
	finish(): CsvDialectType {
		if (this.#crPending) this.#ending('\r');
		const ending = this.#firstEnding;
		return Object.freeze({
			version: 1,
			delimiter: this.delimiter,
			encoding: this.encoding,
			lineEnding: this.#endings.size > 1
				? 'mixed'
				: ending === '\r\n'
				? 'crlf'
				: ending === '\n'
				? 'lf'
				: ending === '\r'
				? 'cr'
				: 'none',
			recordDelimiter: ending ?? '\r\n',
			quoting: this.#allQuoted && this.#fields > 0 ? 'all' : 'minimal',
			finalNewline: this.#finalNewline,
		});
	}
}
