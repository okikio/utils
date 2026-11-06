import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as sync from './sync.ts';
import * as blake from './blake.ts';
import { read } from './stream.ts';

/** Encode literal vectors without obscuring their published text. */
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('stream digest resource ownership', () => {
	it('matches one-shot hashing at the inclusive byte ceiling and releases EOF locks', async () => {
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(text('a'));
				controller.enqueue(text('bc'));
				controller.close();
			},
		});
		expect(await read('sha256', source, { maximumBytes: 3 })).toEqual(sync.digest('sha256', 'abc'));
		expect(source.locked).toBe(false);
		const other = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(text('abc'));
				controller.close();
			},
		});
		expect(await read(() => blake.create(), other, { maximumBytes: 3 })).toEqual(blake.blake3('abc'));
	});
	it('rejects over-limit data and releases locks without awaiting a hanging cancel', async () => {
		let cancelled = false;
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(text('abcd'));
			},
			cancel() {
				cancelled = true;
				return new Promise(() => {});
			},
		});
		await expect(read('sha256', source, { maximumBytes: 3 })).rejects.toThrow(RangeError);
		expect(cancelled).toBe(true);
		expect(source.locked).toBe(false);
	});
	it('interrupts pending reads, disposes state, and exposes late cleanup failure', async () => {
		const abort = new AbortController();
		const failure = new Error('cleanup failed');
		let cleanup: Promise<unknown> | undefined;
		const source = new ReadableStream<Uint8Array>({
			cancel() {
				throw failure;
			},
		});
		const pending = read('sha256', source, {
			maximumBytes: 10,
			signal: abort.signal,
			onCleanup(value) {
				cleanup = value;
			},
		});
		abort.abort(new Error('stop'));
		await expect(pending).rejects.toThrow('stop');
		expect(source.locked).toBe(false);
		expect(await cleanup).toEqual({ status: 'failed', error: failure });
	});
	it('validates bounds and pre-abort before locking a source', async () => {
		const source = new ReadableStream<Uint8Array>();
		await expect(read('sha256', source, { maximumBytes: Infinity })).rejects.toThrow(RangeError);
		expect(source.locked).toBe(false);
		await expect(read('sha256', source, { maximumBytes: 0, signal: AbortSignal.abort() })).rejects.toThrow();
		expect(source.locked).toBe(false);
	});
	it('snapshots the byte ceiling before waiting for source data', async () => {
		let send!: (value: Uint8Array) => void;
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				send = (value) => {
					controller.enqueue(value);
					controller.close();
				};
			},
		});
		const policy = { maximumBytes: 1 };
		const pending = read('sha256', source, policy);
		policy.maximumBytes = 100;
		send(text('abc'));
		await expect(pending).rejects.toThrow(RangeError);
		expect(source.locked).toBe(false);
	});
	it('destroys a transferred state when the source is already locked', async () => {
		const state = sync.create();
		const source = new ReadableStream<Uint8Array>();
		const reader = source.getReader();
		await expect(read(() => state, source, { maximumBytes: 1 })).rejects.toThrow();
		expect(() => state.update(text('x'))).toThrow();
		reader.releaseLock();
		await source.cancel();
	});
	it('preserves source read errors and rejects non-byte chunks', async () => {
		const failure = new Error('read failed');
		const source = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.error(failure);
			},
		});
		await expect(read('sha256', source, { maximumBytes: 1 })).rejects.toBe(failure);
		expect(source.locked).toBe(false);
		const wrong = new ReadableStream<Uint8Array>({
			start(controller) {
				// @ts-expect-error Exercise a malformed JavaScript producer.
				controller.enqueue('x');
			},
		});
		await expect(read('sha256', wrong, { maximumBytes: 1 })).rejects.toThrow(TypeError);
		expect(wrong.locked).toBe(false);
	});
	it('respects release-only ownership on failure and destroys factory state', async () => {
		let cancelled = false;
		let destroyed = false;
		const state = sync.create();
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(text('x'));
			},
			cancel() {
				cancelled = true;
			},
		});
		await expect(read(
			() => ({
				update(input) {
					state.update(input);
					return this;
				},
				digest() {
					return state.digest();
				},
				clone() {
					return state.clone();
				},
				destroy() {
					destroyed = true;
					state.destroy();
				},
			}),
			source,
			{ maximumBytes: 0, preventCancel: true },
		)).rejects.toThrow();
		expect(cancelled).toBe(false);
		expect(destroyed).toBe(true);
		expect(source.locked).toBe(false);
		await source.cancel();
	});
});
