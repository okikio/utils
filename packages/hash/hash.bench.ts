/**
 * Compare warm SHA-256 APIs as input grows from 64 bytes to 4 MiB.
 *
 * The public paths use the host's built-in `node:crypto` where it exists. The Web Crypto and Noble trials measure the
 * fallbacks that a host without it, such as a browser, uses. `node:crypto` called directly is the reference. Streaming
 * additionally owns a reader and incremental state; varying chunk size exposes that coordination cost. Corpus creation
 * and correctness checks are outside timing. Stream construction, reading, finalization and lock release are inside
 * each streaming trial.
 * @module
 */
import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import { digest } from './digest.ts';
import * as sync from './sync.ts';
import * as stream from './stream.ts';
import { portable } from './_portable.ts';
import { web } from './_web.ts';

const sizes = [64, 1024, 16384, 262144, 4194304];
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
	deepStrictEqual(await web('sha256', bytes, 'bytes'), expected);
	deepStrictEqual(sync.digest('sha256', bytes), expected);
	deepStrictEqual(portable('sha256').update(bytes).digest(), expected);
	deepStrictEqual(new Uint8Array(createHash('sha256').update(bytes).digest()), expected);
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
	bench('public async digest, $bytes bytes', function* (state: ParametersType) {
		const bytes = fixtures.get(state.get('bytes'))!;
		yield async () => do_not_optimize(await digest('sha256', bytes));
	}).args('bytes', sizes);

	bench('public sync digest, $bytes bytes', function* (state: ParametersType) {
		const bytes = fixtures.get(state.get('bytes'))!;
		yield () => do_not_optimize(sync.digest('sha256', bytes));
	}).args('bytes', sizes);

	bench('node:crypto createHash reference, $bytes bytes', function* (state: ParametersType) {
		const bytes = fixtures.get(state.get('bytes'))!;
		yield () => do_not_optimize(createHash('sha256').update(bytes).digest());
	}).args('bytes', sizes);

	bench('Web Crypto fallback, $bytes bytes', function* (state: ParametersType) {
		const bytes = fixtures.get(state.get('bytes'))!;
		yield async () => do_not_optimize(await web('sha256', bytes, 'bytes'));
	}).args('bytes', sizes);

	bench('Noble fallback, $bytes bytes', function* (state: ParametersType) {
		const bytes = fixtures.get(state.get('bytes'))!;
		yield () => do_not_optimize(portable('sha256').update(bytes).digest());
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
