/** Measure bounded reader/framing cost separately from native trusted-source UTF-8 conversion. */
import { bench, do_not_optimize, group } from 'mitata';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { run } from './fixtures/bench.ts';
import * as text from '@okikio/streams/text';
import * as frame from '@okikio/streams/frame';
import * as json from '@okikio/streams/json';
import { iterable } from '@okikio/streams';
import * as schema from '@okikio/schema';

/** Lazy chunks share the fixture; readers own only their current chunk and required carry. */
function source(bytes: Uint8Array<ArrayBuffer>, size = 4096): ReadableStream<Uint8Array<ArrayBuffer>> {
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			if (offset >= bytes.length) controller.close();
			else {
				controller.enqueue(bytes.subarray(offset, offset + size));
				offset += size;
			}
		},
	}, { highWaterMark: 0 });
}
for (const size of [1024, 1024 * 1024]) {
	const bytes = Uint8Array.from({ length: size }, (_, index) => 97 + index % 26);
	const policy = { maximumBytes: size, maximumChunkBytes: 4096, maximumFrameBytes: 4096, incomplete: 'emit' as const };
	const framed = async function (verify = false): Promise<number> {
		let count = 0;
		const input = source(bytes);
		const collected = verify ? new Uint8Array(size) : undefined;
		for await (const chunk of frame.fixed(input, 4096, policy)) {
			collected?.set(chunk, count);
			count += chunk.length;
		}
		if (verify) {
			deepStrictEqual(collected, bytes);
			strictEqual(input.locked, false);
		}
		return count;
	};
	const decoded = async function (native = false, verify = false): Promise<number> {
		let count = 0;
		let collected = '';
		// Both candidates construct exactly one source over the same fixture.
		const input = source(bytes);
		const nativeSource: ReadableStream<BufferSource> = input;
		const chunks = native
			? iterable(nativeSource.pipeThrough(new TextDecoderStream('utf-8', { fatal: true })))
			: text.decode(input, { ...policy, fatal: true, ignoreBOM: false });
		for await (const chunk of chunks) {
			if (verify) collected += chunk;
			count += chunk.length;
		}
		if (verify) {
			strictEqual(collected, new TextDecoder().decode(bytes));
			strictEqual(input.locked, false);
		}
		return count;
	};
	if (await framed(true) !== size || await decoded(false, true) !== size || await decoded(true, true) !== size) {
		throw new Error('Stream byte-count oracle failed.');
	}
	group(`UTF-8/framing ${size} bytes, 4 KiB source chunks`, () => {
		bench('bounded fixed framing', async () => {
			do_not_optimize(await framed());
		});
		bench('bounded native decoder iterator', async () => {
			do_not_optimize(await decoded());
		});
		bench('native decoder stream trusted-source reference', async () => {
			do_not_optimize(await decoded(true));
		});
	});
}
const lines = new TextEncoder().encode(Array.from({ length: 1000 }, (_, index) => String(index)).join('\n'));
const NumberSchema = schema.number();
/** Consume the entire fixed JSONL corpus under explicit limits and retain a checksum so decoding work remains observable. */
async function records(verify = false): Promise<number> {
	let sum = 0;
	const values: number[] | undefined = verify ? [] : undefined;
	for await (
		const record of json.decode(NumberSchema, source(lines), {
			maximumBytes: lines.length,
			maximumChunkBytes: 4096,
			maximumLineBytes: 16,
			maximumItems: 1000,
			maximumIssues: 1,
			maximumPathLength: 8,
			errors: 'throw',
		})
	) {
		if (record.kind !== 'value') throw new Error('Unexpected JSONL failure.');
		sum += record.value;
		values?.push(record.value);
	}
	if (verify) deepStrictEqual(values, Array.from({ length: 1000 }, (_, index) => index));
	return sum;
}
if (await records(true) !== 499500) throw new Error('Typed JSONL oracle failed.');
group('typed JSONL: 1000 numbers, bounded records/lines/issues', () => {
	bench('decode and validate once', async () => {
		do_not_optimize(await records());
	});
});
await run();
