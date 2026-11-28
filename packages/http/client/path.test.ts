/** Request paths are admitted once before caller-owned values can change them. @module */
import { it } from 'node:test';
import { expect } from '@std/expect';
import { create } from './mod.ts';
import type { ClientRequest, HttpClient } from './mod.ts';

/** Exercise each response ownership mode and consume its body before the next case. */
async function read(client: HttpClient, mode: 'request' | 'fetch' | 'stream', input: ClientRequest): Promise<string> {
	if (mode === 'request') return await client.request(input, (response) => response.text());
	return await (await client[mode](input)).text();
}

for (const [name, control] of [['tab', '\t'], ['line feed', '\n'], ['carriage return', '\r']] as const) {
	it(`rejects a raw ${name} before Fetch for every response ownership mode`, async () => {
		for (const origin of ['', 'https://api.example.invalid']) {
			let calls = 0;
			const client = create({
				origin,
				fetch: () => {
					calls++;
					return Promise.resolve(new Response('ready'));
				},
			});
			for (const mode of ['request', 'fetch', 'stream'] as const) {
				for (const path of [`/${control}/other.example.invalid`, `/sta${control}tus`, `/status?q=${control}`]) {
					await expect(read(client, mode, { method: 'GET', path })).rejects.toBeInstanceOf(TypeError);
				}
			}
			expect(calls).toBe(0);
		}
	});
}

it('preserves admitted paths and encoded characters for browser and server callers', async () => {
	for (const origin of ['', 'https://api.example.invalid/']) {
		const urls: string[] = [];
		const client = create({
			origin,
			fetch: (input) => {
				urls.push(String(input));
				return Promise.resolve(new Response('ready'));
			},
		});
		const paths = ['/status', '/status?next=%2F%2Fother.example.invalid', '/text%09%0A%0D', '/a//b?q=%23'];
		for (const mode of ['request', 'fetch', 'stream'] as const) {
			for (const path of paths) expect(await read(client, mode, { method: 'GET', path })).toBe('ready');
		}
		expect(urls).toEqual(
			Array.from({ length: 3 }, () => paths.map((path) => origin.replace(/\/$/u, '') + path)).flat(),
		);
	}
});

it('sends the single admitted path when a caller header getter changes the request', async () => {
	for (const origin of ['', 'https://api.example.invalid']) {
		for (const mode of ['request', 'fetch', 'stream'] as const) {
			let path = '/status?view=ready';
			let reads = 0;
			const sent: { url: string; marker: string | null }[] = [];
			const client = create({
				origin,
				fetch: (input, init) => {
					sent.push({ url: String(input), marker: new Headers(init?.headers).get('x-request-marker') });
					return Promise.resolve(new Response('ready'));
				},
			});
			const input: ClientRequest = {
				method: 'GET',
				get path() {
					reads++;
					return path;
				},
				get headers() {
					path = '//other.example.invalid';
					return { 'x-request-marker': 'observed' };
				},
			};
			expect(await read(client, mode, input)).toBe('ready');
			expect(sent).toEqual([{ url: `${origin}/status?view=ready`, marker: 'observed' }]);
			expect(reads).toBe(1);
		}
	}
});
