import { parse } from '@std/csv/parse';
import type { CsvDelimiter } from './types.ts';

/** One complete record and the original newlines inside its quoted cells. */
interface FrameType {
	text: string;
	newlines: string[];
}

/**
 * Find record boundaries without interpreting cells. The standard parser owns field syntax and quote validation.
 *
 * std/csv skips empty physical lines, supports LF/CRLF framing, and normalizes quoted CRLF to LF. Our document contract
 * preserves empty records, also accepts CR framing, and preserves cell text. Frame one record at a time and remember
 * its quoted newlines so these differences do not change uploaded values. State spans arbitrary source chunks.
 */
class Framer {
	/** Incomplete logical record; a source chunk may end anywhere inside it. */
	#text = '';
	/** A quoted cell can contain delimiters and line endings that must not start another record. */
	#quoted = false;
	/** A CR outside quotes already ended the record; suppress its optional following LF, even in the next chunk. */
	#skipLf = false;
	/** Original quoted line endings, restored after the standard parser normalizes them. */
	#newlines: string[] = [];
	/** Retain unfinished records across chunks; quote toggles frame records, while STD validates quote syntax. */
	*write(text: string): Generator<FrameType> {
		for (const character of text) {
			if (this.#skipLf) {
				this.#skipLf = false;
				if (character === '\n') continue;
			}
			if (character === '"') this.#quoted = !this.#quoted;
			if (!this.#quoted && (character === '\r' || character === '\n')) {
				this.#skipLf = character === '\r';
				const frame = { text: this.#text, newlines: this.#newlines };
				this.#text = '';
				this.#newlines = [];
				yield frame;
			} else {
				if (character === '\n') this.#newlines.push(this.#text.endsWith('\r') ? '\r\n' : '\n');
				this.#text += character;
			}
		}
	}
	/** Flush a nonempty final record without inventing another blank row after a trailing separator. */
	finish(): FrameType | undefined {
		if (this.#text === '') return undefined;
		const frame = { text: this.#text, newlines: this.#newlines };
		this.#text = '';
		this.#newlines = [];
		return frame;
	}
}

/** Parse fields with std/csv, then restore only the quoted newlines that its reader normalizes. */
function read(frame: FrameType, delimiter: CsvDelimiter): string[] {
	const rows = parse(frame.text === '' ? '""' : frame.text, { separator: delimiter });
	if (rows.length !== 1) throw new SyntaxError('Expected one complete CSV record.');
	let index = 0;
	return rows[0]!.map((cell) => cell.replace(/\n/g, () => frame.newlines[index++]!));
}

/** Collect already-bounded text with the same standard parser and framing contract used for streams. */
export function records(text: string, delimiter: CsvDelimiter): string[][] {
	const framer = new Framer();
	const rows = Array.from(framer.write(text), (frame) => read(frame, delimiter));
	const last = framer.finish();
	if (last !== undefined) rows.push(read(last, delimiter));
	return rows;
}

/** Pull one record at a time. Cancellation releases the pending source read and the current chunk iterator. */
export function recordStream(delimiter: CsvDelimiter): ReadableWritablePair<string[], string> {
	const input = new TransformStream<string, string>();
	const reader = input.readable.getReader();
	const framer = new Framer();
	let pending: Generator<FrameType> | undefined;
	let released = false;
	/** Discard the current chunk iterator and release its input lock once after terminal read/cancel. */
	const release = () => {
		if (released) return;
		released = true;
		pending?.return(undefined);
		pending = undefined;
		reader.releaseLock();
	};
	return {
		writable: input.writable,
		readable: new ReadableStream<string[]>({
			/** Satisfy one downstream read at a time; do not parse all rows in a large chunk ahead of demand. */
			async pull(controller) {
				try {
					while (true) {
						const next = pending?.next();
						if (next !== undefined && !next.done) {
							controller.enqueue(read(next.value, delimiter));
							return;
						}
						// Only ask for more input after exhausting the current chunk
						// iterator. A slow row consumer therefore stops further source reads.
						const chunk = await reader.read();
						if (chunk.done) {
							const last = framer.finish();
							if (last !== undefined) controller.enqueue(read(last, delimiter));
							controller.close();
							release();
							return;
						}
						pending = framer.write(chunk.value);
					}
				} catch (error) {
					controller.error(error);
					await reader.cancel(error).catch(() => undefined);
					release();
				}
			},
			async cancel(reason) {
				await reader.cancel(reason);
				release();
			},
		}),
	};
}
