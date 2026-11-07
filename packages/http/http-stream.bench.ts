/** STD message framing with explicit bound/ownership costs; JSONL includes native response consumption. */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import { ServerSentEventParseStream } from '@std/http/server-sent-event-parse-stream';
import { readable } from '@okikio/streams';
import * as events from '@okikio/http/events';
import { jsonl, jsonlCompletion } from '@okikio/http/response';
for (const count of [1, 1_000]) {
	const bytes = new TextEncoder().encode(
		Array.from({ length: count }, (_, index) => `id:${index}\ndata:é-${index}\n\n`).join(''),
	);
	for (const size of [1, 65536]) {
		const chunks = Array.from(
			{ length: Math.ceil(bytes.length / size) },
			(_, index) => bytes.slice(index * size, (index + 1) * size),
		);
		/** Read the same chunks to EOF; only the direct candidate needs a separate pipe. */
		const read = async function (bounded: boolean, verify = false): Promise<number> {
			let seen = 0;
			const source = readable(chunks);
			const parser = bounded ? undefined : new ServerSentEventParseStream();
			const joined = parser === undefined ? undefined : source.pipeTo(parser.writable);
			const messages = parser === undefined
				? events.read(source, {
					maximumBytes: bytes.length,
					maximumEventBytes: 64,
					maximumChunkBytes: size,
					maximumEvents: count,
				})
				: parser.readable;
			for await (const message of messages) {
				if (verify && (message.id !== String(seen) || message.data !== `é-${seen}`)) {
					throw new Error('SSE identity, payload or ordering oracle failed.');
				}
				seen++;
			}
			await joined;
			if (verify && (seen !== count || source.locked)) throw new Error('SSE count/ownership oracle failed.');
			return seen;
		};
		await read(true, true);
		await read(false, true);
		group(`SSE ${count} records; ${size} byte chunks`, () => {
			bench('bounded owned parser', async () => do_not_optimize(await read(true)));
			bench('direct STD parser reference without bounds', async () => do_not_optimize(await read(false)));
		});
	}
	const records = Array.from({ length: count }, (_, value) => ({ value }));
	const expected = Array.from({ length: count }, (_, value) => `{"value":${value}}\n`).join('');
	/** Include response construction, body consumption, and the completion join, not oracle generation. */
	const response = async function (verify = false): Promise<number> {
		const native = jsonl(readable(records), {
			maximumBytes: count * 16,
			maximumRecordBytes: 16,
			maximumItems: count,
			projection: { maximumDepth: 2, maximumNodes: 4, maximumStringCodeUnits: 8 },
		});
		const text = await native.text();
		const completion = await jsonlCompletion(native);
		if (verify && (text !== expected || completion.bytes !== text.length)) {
			throw new Error('JSONL completion oracle failed.');
		}
		return text.length;
	};
	await response(true);
	group(`JSONL ${count} values, bounded copy and native completion`, () => {
		bench('construct and fully consume response', async () => do_not_optimize(await response()));
	});
}
await run();
