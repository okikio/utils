import { describe, it } from 'node:test';
import { getEventListeners } from 'node:events';
import { expect } from '@std/expect';
import { ClientContractError, ClientResponseError, ClientTransportError, create, json } from './mod.ts';

describe('HTTP client lifetime and wire boundary', () => {
	it('uses relative browser URLs and configured SSR credentials without sharing or overriding them', async () => {
		const seen: { url: string; cookie: string | null }[] = [];
		const fetch: typeof globalThis.fetch = async (url, init) => {
			seen.push({ url: String(url), cookie: new Headers(init?.headers).get('cookie') });
			return Response.json({ ok: true });
		};
		const browser = create({ fetch });
		const first = create({ origin: 'https://gateway.example', headers: { cookie: 'session=a' }, fetch });
		const second = create({ origin: 'https://gateway.example', headers: { cookie: 'session=b' }, fetch });
		await Promise.all([
			browser.fetch({ path: '/api/v1/items?q=a', method: 'GET' }),
			first.fetch({ path: '/api/v1/items', method: 'GET' }),
			second.fetch({ path: '/api/v1/items', method: 'GET' }),
		]);
		expect(seen).toEqual([{ url: '/api/v1/items?q=a', cookie: null }, {
			url: 'https://gateway.example/api/v1/items',
			cookie: 'session=a',
		}, { url: 'https://gateway.example/api/v1/items', cookie: 'session=b' }]);
		await expect(first.fetch({ path: '/api/v1/items', method: 'GET', headers: { cookie: 'session=other' } })).rejects
			.toThrow('cannot replace');
		expect(seen).toHaveLength(3);
	});
	it('rejects cross-origin paths and invalid deployment configuration before fetching', async () => {
		expect(() => create({ origin: 'https://user:secret@gateway.example' })).toThrow(TypeError);
		expect(() => create({ origin: 'https://gateway.example/other' })).toThrow(TypeError);
		expect(() => create({ timeoutMs: 0 })).toThrow(RangeError);
		const client = create({
			fetch: async () => {
				throw new Error('must not fetch');
			},
		});
		for (const path of ['https://other.example/a', '//other.example/a', '/\\other.example/a', '/a#b']) {
			await expect(client.fetch({ path, method: 'GET' })).rejects.toThrow(TypeError);
		}
	});
	it('preserves caller cancellation before and during fetch, without converting it into an outage', async () => {
		const controller = new AbortController();
		const reason = new DOMException('Query no longer observed.', 'AbortError');
		let fetched = 0;
		const client = create({
			fetch: async (_url, init) => {
				fetched += 1;
				return await new Promise((_resolve, reject) =>
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
				);
			},
		});
		const running = client.fetch({ path: '/api/v1/items', method: 'GET', signal: controller.signal });
		controller.abort(reason);
		await expect(running).rejects.toBe(reason);
		await expect(client.fetch({ path: '/api/v1/items', method: 'GET', signal: controller.signal })).rejects.toBe(
			reason,
		);
		expect(fetched).toBe(1);
	});
	it('cancels a pending bounded body reader and releases its stream lock', async () => {
		const controller = new AbortController();
		let canceled = 0;
		const stream = new ReadableStream<Uint8Array>({
			cancel() {
				canceled += 1;
			},
		});
		const client = create({
			fetch: async () => new Response(stream, { headers: { 'content-type': 'application/json' } }),
		});
		const running = client.request(
			{ path: '/api/v1/items', method: 'GET', signal: controller.signal },
			(response, signal) => json(response, client.maximumResponseBytes, signal),
		);
		await Promise.resolve();
		await Promise.resolve();
		controller.abort(new DOMException('Left collection.', 'AbortError'));
		await expect(running).rejects.toThrow('Left collection');
		expect(canceled).toBe(1);
		expect(stream.locked).toBe(false);
	});
	it('keeps the timeout through body consumption and removes caller listeners after success', async () => {
		let canceled = 0;
		const hanging = create({
			timeoutMs: 5,
			fetch: async () =>
				new Response(
					new ReadableStream({
						cancel() {
							canceled += 1;
						},
					}),
					{ headers: { 'content-type': 'application/json' } },
				),
		});
		await expect(
			hanging.request(
				{ path: '/api/v1/items', method: 'GET' },
				(response, signal) => json(response, hanging.maximumResponseBytes, signal),
			),
		).rejects.toThrow('timed out');
		expect(canceled).toBe(1);
		let outgoing: AbortSignal | undefined;
		const done = create({
			fetch: async (_url, init) => {
				outgoing = init?.signal ?? undefined;
				return Response.json({ ok: true });
			},
		});
		const controller = new AbortController();
		await done.request(
			{ path: '/api/v1/items', method: 'GET', signal: controller.signal },
			(response, signal) => json(response, done.maximumResponseBytes, signal),
		);
		controller.abort();
		expect(outgoing?.aborted).toBe(false);
	});
	it('bounds UTF-8 response bytes and rejects malformed or non-JSON successes', async () => {
		await expect(json(Response.json('😀'), 5)).rejects.toBeInstanceOf(ClientContractError);
		await expect(json(new Response('{bad', { headers: { 'content-type': 'application/json' } }), 100)).rejects
			.toBeInstanceOf(ClientContractError);
		await expect(json(new Response('{}', { headers: { 'content-type': 'text/html' } }), 100)).rejects.toBeInstanceOf(
			ClientContractError,
		);
	});
	it('ends the request timeout while decoding remains pending', { timeout: 1000 }, async () => {
		const pending = Promise.withResolvers<unknown>();
		let signal: AbortSignal | undefined;
		const client = create({ timeoutMs: 5, fetch: async () => Response.json({ ok: true }) });
		const running = client.request({ path: '/items', method: 'GET' }, async (response, current) => {
			signal = current;
			await json(response, client.maximumResponseBytes, current);
			return await pending.promise;
		});
		await expect(running).rejects.toThrow('timed out');
		expect(signal?.reason.name).toBe('TimeoutError');
		expect(getEventListeners(signal!, 'abort')).toHaveLength(0);
		pending.resolve({ ok: true });
		await pending.promise;
	});
	it('preserves cancellation during decoding and observes late decoder outcomes', { timeout: 1000 }, async () => {
		for (const outcome of ['resolve', 'reject'] as const) {
			const controller = new AbortController();
			const pending = Promise.withResolvers<unknown>();
			const started = Promise.withResolvers<void>();
			let signal: AbortSignal | undefined;
			const client = create({ fetch: async () => Response.json({ ok: true }) });
			const running = client.request(
				{ path: '/items', method: 'GET', signal: controller.signal },
				async (response, current) => {
					signal = current;
					await json(response, client.maximumResponseBytes, current);
					started.resolve();
					return await pending.promise;
				},
			);
			await started.promise;
			const reason = new DOMException('Left decoding.', 'AbortError');
			controller.abort(reason);
			await expect(running).rejects.toBe(reason);
			expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
			expect(getEventListeners(signal!, 'abort')).toHaveLength(0);
			if (outcome === 'resolve') pending.resolve('late value');
			else pending.reject(new Error('late decoder failure'));
			// Let the decoder settle. The request must keep its original cancellation result.
			await new Promise<void>((resolve) => setImmediate(resolve));
			await expect(running).rejects.toBe(reason);
		}
	});
	it('retains HTTP policy/status/correlation/retry while ignoring hostile error payloads', async () => {
		try {
			await json(
				Response.json({ type: 'urn:quota', status: 429, title: 'Capacity exceeded' }, {
					status: 429,
					headers: { 'retry-after': '3', 'x-request-id': 'req_1' },
				}),
				1000,
			);
			throw new Error('expected HTTP rejection');
		} catch (error) {
			expect(error).toBeInstanceOf(ClientResponseError);
			if (!(error instanceof ClientResponseError)) throw error;
			expect({ status: error.status, type: error.problemType, requestId: error.requestId, retry: error.retryAfterMs })
				.toEqual({ status: 429, type: 'urn:quota', requestId: 'req_1', retry: 3000 });
		}
		await expect(json(new Response('internal stack/credential', { status: 502 }), 1000)).rejects.toThrow('HTTP 502');
		await expect(json(Response.json({ status: 200, detail: 'false success' }, { status: 403 }), 1000)).rejects.toThrow(
			'HTTP 403',
		);
	});
	it('distinguishes network failure from HTTP and contract errors', async () => {
		const client = create({
			fetch: async () => {
				throw new Error('provider failed');
			},
		});
		await expect(client.fetch({ path: '/api/v1/items', method: 'GET' })).rejects.toBeInstanceOf(ClientTransportError);
	});
});
