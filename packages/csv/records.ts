import { parse } from '#csv-parse';
import { parse as collect } from '#csv-parse/sync';

import type { CsvDelimiter } from './types.ts';

/** Shared maintained parser settings; source cells never coerce. */
function settings(delimiter: CsvDelimiter) {
	return {
		delimiter,
		cast: false,
		columns: false,
		relax_column_count: true,
		// Keep record coordinates until the structural layer applies output policy.
		skip_empty_lines: false,
		trim: false,
	} as const;
}

/** Collect already-bounded text through the same parser used for streams. */
export function records(text: string, delimiter: CsvDelimiter): string[][] {
	return collect(text, settings(delimiter)) as string[][];
}

/** Adapt the maintained browser stream build to Web Streams, retaining pressure and cancellation. */
export function recordStream(delimiter: CsvDelimiter): ReadableWritablePair<string[], string> {
	const configuration = { ...settings(delimiter), readableHighWaterMark: 1 };
	const parser = parse(configuration);
	let reader!: ReadableStreamDefaultController<string[]>;
	let writer!: WritableStreamDefaultController;
	let stopped = false;
	/**
	 * Stop parser delivery once, reject both Web Stream sides and destroy parser buffers on source failure or cancellation.
	 */
	function fail(reason: unknown): void {
		if (stopped) return;
		stopped = true;
		reader.error(reason);
		writer.error(reason);
		parser.destroy();
	}
	parser.pause();
	parser.on('error', fail);
	parser.on('data', (row: string[]) => {
		if (stopped) return;
		reader.enqueue(row);
		if ((reader.desiredSize ?? 0) <= 0) parser.pause();
	});
	parser.on('end', () => {
		if (!stopped) {
			stopped = true;
			reader.close();
		}
	});
	const readable = new ReadableStream<string[]>({
		start(controller) {
			reader = controller;
		},
		pull() {
			if (!stopped) parser.resume();
		},
		cancel(reason) {
			fail(reason ?? new Error('CSV record reader canceled.'));
		},
	});
	const writable = new WritableStream<string>({
		start(controller) {
			writer = controller;
		},
		async write(chunk) {
			// A large peek chunk cannot fill the parser with an unbounded number of records.
			for (let offset = 0; offset < chunk.length;) {
				let end = Math.min(chunk.length, offset + 8192);
				if (end < chunk.length && chunk.charCodeAt(end - 1) >= 0xd800 && chunk.charCodeAt(end - 1) <= 0xdbff) end--;
				const value = chunk.slice(offset, end);
				await new Promise<void>((accept, reject) =>
					parser.write(value, (error?: Error | null) => error ? reject(error) : accept())
				);
				offset = end;
			}
		},
		close() {
			parser.end();
		},
		abort(reason) {
			fail(reason ?? new Error('CSV record source aborted.'));
		},
	});
	return { readable, writable };
}
