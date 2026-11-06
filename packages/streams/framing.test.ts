import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as schema from '@okikio/schema';
import * as frame from './frame.ts';
import * as text from './text.ts';
import * as json from './json.ts';
import { collect } from './mod.ts';

const policy = { maximumBytes: 10_000, maximumChunkBytes: 10_000, maximumFrameBytes: 100, incomplete: 'emit' as const };
/** The provider pulls only one prepared chunk at a time, with no eager enqueue loop. */
function source<Value>(chunks: readonly Value[]): ReadableStream<Value> {
	let index = 0;
	return new ReadableStream({
		pull(controller) {
			if (index === chunks.length) controller.close();
			else controller.enqueue(chunks[index++]!);
		},
	}, { highWaterMark: 0 });
}
const utf8 = new TextEncoder();
describe('bounded text and byte framing', () => {
	it('preserves UTF-8 and delimiter results at every split, including repeated delimiter prefixes', async () => {
		const bytes = utf8.encode('é😀aaaboneaaabtwo');
		for (let index = 0; index <= bytes.length; index++) {
			const chunks = [bytes.slice(0, index), new Uint8Array(), bytes.slice(index)];
			expect((await collect(text.decode(source(chunks), { ...policy, fatal: true, ignoreBOM: false }))).join('')).toBe(
				'é😀aaaboneaaabtwo',
			);
			const frames = await collect(frame.split(source(chunks), utf8.encode('aaab'), policy));
			expect(frames.map((bytes) => new TextDecoder().decode(bytes))).toEqual(['é😀', 'one', 'two']);
		}
	});
	it('encodes split surrogate pairs and resolves incomplete byte/UTF-16 EOF explicitly', async () => {
		const chunks = await collect(
			text.encode(source(['\ud83d', '', '\ude00']), { maximumBytes: 4, maximumChunkCodeUnits: 2 }),
		);
		expect(Array.from(chunks[0]!)).toEqual(Array.from(utf8.encode('😀')));
		await expect(collect(text.decode(source([new Uint8Array([0xe2])]), { ...policy, fatal: true, ignoreBOM: false })))
			.rejects.toThrow(TypeError);
		await expect(collect(frame.fixed(source([new Uint8Array([1, 2, 3])]), 2, { ...policy, incomplete: 'reject' })))
			.rejects.toThrow(SyntaxError);
		expect(
			(await collect(frame.fixed(source([new Uint8Array([1, 2, 3])]), 2, policy))).map((value) => Array.from(value)),
		).toEqual([[
			1,
			2,
		], [3]]);
	});
	it('rejects oversized chunks/frames and releases a stalled cancellation without awaiting it', async () => {
		await expect(
			collect(frame.split(source([utf8.encode('long')]), utf8.encode('\n'), { ...policy, maximumFrameBytes: 3 })),
		).rejects.toThrow(RangeError);
		await expect(collect(frame.fixed(source([new Uint8Array(10)]), 2, { ...policy, maximumChunkBytes: 4 }))).rejects
			.toThrow(RangeError);
		let cancel = false;
		const input = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(utf8.encode('a\nb\n'));
			},
			cancel() {
				cancel = true;
				return new Promise(() => {});
			},
		});
		const iterator = frame.split(input, utf8.encode('\n'), policy);
		expect(new TextDecoder().decode((await iterator.next()).value)).toBe('a');
		await iterator.return(undefined);
		expect(input.locked).toBe(false);
		expect(cancel).toBe(true);
	});
	it('reports typed JSONL positions and bounded schema evidence without consuming after early return', async () => {
		const bytes = utf8.encode('"é"\r\nfalse\n{bad');
		const options = {
			maximumBytes: 100,
			maximumChunkBytes: 100,
			maximumLineBytes: 32,
			maximumItems: 8,
			maximumIssues: 1,
			maximumPathLength: 1,
			errors: 'yield' as const,
		};
		const records = await collect(json.decode(schema.string(), source([bytes]), options));
		expect(records.map((record) => [record.kind, record.record, record.byteOffset])).toEqual([['value', 1, 0], [
			'schema',
			2,
			6,
		], ['syntax', 3, 12]]);
		await expect(collect(json.decode(schema.string(), source([bytes]), { ...options, errors: 'throw' }))).rejects
			.toBeInstanceOf(json.JsonRecordError);
	});
});
