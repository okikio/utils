import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as response from './mod.ts';

describe('response byte cleanup', () => {
	it('retains delayed source cleanup failure after prompt overflow rejection', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const error = new Error('Source teardown failed.');
		const value = new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array([1, 2]));
				},
				async cancel() {
					await gate;
					throw error;
				},
			}),
		);
		try {
			await expect(response.readBytes(value, 1)).rejects.toBeInstanceOf(RangeError);
			expect(value.body!.locked).toBe(false);
		} finally {
			release();
		}
		expect(await response.bodyCleanup(value)).toEqual({ status: 'failed', error });
	});

	it('retains cancellation failure when Content-Length rejects before acquiring a reader', async () => {
		const value = new Response(
			new ReadableStream<Uint8Array>({
				cancel() {
					throw undefined;
				},
			}),
			{ headers: { 'content-length': '2' } },
		);
		await expect(response.readBytes(value, 1)).rejects.toBeInstanceOf(RangeError);
		expect(await response.bodyCleanup(value)).toEqual({ status: 'failed', error: undefined });
		expect(value.body!.locked).toBe(false);
	});
});
