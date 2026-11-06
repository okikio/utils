/** Binary object transport shares the existing bounded HTTP reader. @module */
import { test } from 'node:test';
import { expect } from '@std/expect';
import * as body from './body.ts';

test('binary artifact bytes are preserved and incomplete cancellation does not block refusal', async () => {
	const original = new Uint8Array([0, 255, 128, 10]);
	expect(await body.readBytes(new Response(original), 4)).toEqual(original);
	let cancelled = false;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(5));
		},
		cancel() {
			cancelled = true;
			return new Promise<void>(() => undefined);
		},
	});
	await expect(body.readBytes(new Response(stream), 4)).rejects.toThrow('exceeds 4 bytes');
	expect(cancelled).toBe(true);
});

test('caller cancellation releases a stalled binary response without accepting partial bytes', async () => {
	const controller = new AbortController();
	let cancelled = false;
	const stream = new ReadableStream<Uint8Array>({
		pull() {
			return new Promise<void>(() => undefined);
		},
		cancel() {
			cancelled = true;
		},
	});
	const read = body.readBytes(new Response(stream), 4, controller.signal);
	controller.abort(new Error('fixture_cancelled'));
	await expect(read).rejects.toThrow('fixture_cancelled');
	expect(cancelled).toBe(true);
});
