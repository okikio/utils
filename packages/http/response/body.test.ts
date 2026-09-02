import { describe, it } from 'node:test';
import { expect } from '@std/expect';

import { readText } from './body.ts';

describe('readText', () => {
	it('reads a response within the byte limit', async () => {
		const response = new Response('hello');
		expect(await readText(response, 5)).toBe('hello');
	});

	it('rejects a declared body larger than the byte limit', async () => {
		const response = new Response('ignored', { headers: { 'Content-Length': '12' } });
		await expect(readText(response, 4)).rejects.toThrow('exceeds 4 bytes');
	});

	it('enforces the streamed byte count when Content-Length is missing', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('abc'));
				controller.enqueue(new TextEncoder().encode('def'));
				controller.close();
			},
		});
		await expect(readText(new Response(body), 5)).rejects.toThrow('exceeds 5 bytes');
	});

	it('counts bytes rather than UTF-16 characters', async () => {
		const response = new Response('😀');
		expect(await readText(response, 4)).toBe('😀');
	});

	it('rejects invalid limits before reading', async () => {
		await expect(readText(new Response('body'), -1)).rejects.toThrow(RangeError);
		await expect(readText(new Response('body'), 1.5)).rejects.toThrow(RangeError);
	});
});
