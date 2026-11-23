import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { create } from './mod.ts';

describe('HTTP streamed operation ownership', () => {
	it('ends an uncooperative fetch at the deadline and discards its late body', async () => {
		let resolve!: (response: Response) => void, cancelled = 0;
		const pending = new Promise<Response>((done) => resolve = done);
		const client = create({ timeoutMs: 20, fetch: () => pending });
		await expect(client.stream({ method: 'GET', path: '/download' })).rejects.toMatchObject({ name: 'TimeoutError' });
		const released = new Promise<void>((done) => {
			resolve(
				new Response(
					new ReadableStream<Uint8Array>({
						cancel() {
							cancelled++;
							done();
						},
					}),
				),
			);
		});
		await released;
		expect(cancelled).toBe(1);
	});
	it('keeps the deadline after headers and cancels an unconsumed body', async () => {
		let cancelled = 0;
		let release!: () => void;
		const released = new Promise<void>((resolve) => release = resolve);
		const client = create({
			timeoutMs: 20,
			fetch: async () =>
				new Response(
					new ReadableStream({
						cancel() {
							cancelled++;
							release();
						},
					}),
				),
		});
		const response = await client.stream({ method: 'GET', path: '/download' });
		await released;
		await expect(response.arrayBuffer()).rejects.toMatchObject({ name: 'TimeoutError' });
		expect(cancelled).toBe(1);
	});
	it('cancels pending upstream consumption when the downstream body is cancelled', async () => {
		let cancelled = 0;
		const input = new AbortController();
		const client = create({
			fetch: async () =>
				new Response(
					new ReadableStream({
						cancel() {
							cancelled++;
						},
					}),
				),
		});
		const response = await client.stream({ method: 'GET', path: '/download', signal: input.signal });
		const reader = response.body!.getReader();
		const pending = reader.read();
		await reader.cancel('client left');
		await pending;
		expect(cancelled).toBe(1);
		input.abort();
	});
	it('awaits normal EOF and keeps errors from an upstream body', async () => {
		let pulls = 0;
		const client = create({
			fetch: async () =>
				new Response(
					new ReadableStream({
						pull(controller) {
							if (pulls++) controller.close();
							else controller.enqueue(new Uint8Array([65]));
						},
					}),
				),
		});
		expect(await (await client.stream({ method: 'GET', path: '/download' })).text()).toBe('A');
		const failing = create({
			fetch: async () =>
				new Response(
					new ReadableStream({
						pull(controller) {
							controller.error(new Error('upstream interrupted'));
						},
					}),
				),
		});
		await expect((await failing.stream({ method: 'GET', path: '/download' })).text()).rejects.toThrow(
			'upstream interrupted',
		);
	});
});
