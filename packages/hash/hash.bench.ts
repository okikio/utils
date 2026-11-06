/**
 * Compare warm SHA-256 APIs as input grows from 1 KiB to 4 MiB.
 * Native comparisons both copy caller bytes. Streaming additionally owns a reader
 * and incremental state; varying chunk size exposes that coordination cost.
 * Corpus creation and correctness checks are outside timing. Stream construction,
 * reading, finalization and lock release are inside each streaming trial.
 * @module
 */
import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import { digest } from './digest.ts';
import * as sync from './sync.ts';
import * as stream from './stream.ts';

const sizes = [1024, 16384, 262144, 4194304];
const chunks = [1024, 16384, 65536];

/** Numeric dimensions registered below; avoid leaking Mitata's untyped getter into fixture lookup. */
interface ParametersType {
	/** Read one registered byte-count or chunk-size dimension before timing begins. */
	get(name: string): number;
}

/** Each call creates a fresh source; trials never reuse an already-consumed body. */
function source(bytes: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> {
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			if (offset === bytes.length) {
				controller.close();
				return;
			}
			const end = Math.min(offset + chunkSize, bytes.length);
			controller.enqueue(bytes.subarray(offset, end));
			offset = end;
		},
	});
}

// Prepare and verify every parameter combination here: --check never enters
// Mitata's generator bodies and must still test the complete measured corpus.
const fixtures = new Map<number, Uint8Array>();
for (const size of sizes) {
	const bytes = Uint8Array.from({ length: size }, (_, index) => index % 251);
	const expected = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	fixtures.set(size, bytes);
	deepStrictEqual(await digest('sha256', bytes), expected);
	deepStrictEqual(sync.digest('sha256', bytes), expected);
	for (const chunkSize of chunks) {
		const input = source(bytes, chunkSize);
		deepStrictEqual(await stream.read('sha256', input, { maximumBytes: size }), expected);
		strictEqual(input.locked, false);
		const overLimit = source(bytes, chunkSize);
		await rejects(stream.read('sha256', overLimit, { maximumBytes: size - 1 }), RangeError);
		strictEqual(overLimit.locked, false);
	}
}

group('warm SHA-256; corpus preparation excluded', () => {
	bench('owned native digest, $bytes bytes', function* (state: ParametersType) {
		const bytes = fixtures.get(state.get('bytes'))!;
		yield async () => do_not_optimize(await digest('sha256', bytes));
	}).args('bytes', sizes);

	bench('Web Crypto with matching input copy, $bytes bytes', function* (state: ParametersType) {
		const bytes = fixtures.get(state.get('bytes'))!;
		yield async () => do_not_optimize(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice())));
	}).args('bytes', sizes);

	bench('portable synchronous digest, $bytes bytes', function* (state: ParametersType) {
		const bytes = fixtures.get(state.get('bytes'))!;
		yield () => do_not_optimize(sync.digest('sha256', bytes));
	}).args('bytes', sizes);
});

group('bounded SHA-256 stream; source and cleanup included', () => {
	bench('$bytes bytes in $chunk-byte chunks', function* (state: ParametersType) {
		const bytes = fixtures.get(state.get('bytes'))!;
		const chunkSize: number = state.get('chunk');
		yield async () =>
			do_not_optimize(
				await stream.read('sha256', source(bytes, chunkSize), {
					maximumBytes: bytes.length,
				}),
			);
	}).args({ bytes: sizes, chunk: chunks });
});

await run();
