/** Upstream Hono proxy inputs, full asserted projections, and explicit gateway policy differences. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { vectors } from './fixtures/hono-proxy/corpus.ts';
import type { ProxyExpectation } from './fixtures/hono-proxy/corpus.ts';
import { createHonoProxy, createUtilsProxy } from './fixtures/hono-proxy/implementations.ts';
import type { ProxyApi, Transport } from './fixtures/hono-proxy/implementations.ts';
import { createUpstream } from './fixtures/hono-proxy/upstream.ts';

/** Assert every originally inspected header and outcome while always consuming the response body. */
async function verify(result: Response, requests: readonly Request[], expected: ProxyExpectation): Promise<void> {
	const body = await result.text();
	expect(result.status).toBe(expected.status);
	for (const [name, value] of Object.entries(expected.headers ?? {})) expect(result.headers.get(name)).toBe(value);
	if (expected.body !== undefined) expect(body).toBe(expected.body);
	if (expected.request === null) {
		expect(requests).toHaveLength(0);
		return;
	}
	expect(requests).toHaveLength(1);
	expect(requests[0]!.url).toBe(expected.request.url);
	for (const [name, value] of Object.entries(expected.request.headers ?? {})) {
		expect(requests[0]!.headers.get(name)).toBe(value);
	}
}

describe('pinned Hono proxy upstream vectors', () => {
	for (const vector of vectors) {
		for (const candidate of ['hono', 'utils'] as const) {
			it(`${vector.title}: ${candidate}`, async () => {
				const upstream = createUpstream();
				const api = candidate === 'hono'
					? createHonoProxy(vector.mode, upstream.fetch)
					: createUtilsProxy(vector.mode, upstream.fetch);
				const result = await api.fetch(
					new Request(`https://gateway.invalid${vector.path}`, {
						method: vector.method ?? 'GET',
						headers: vector.headers,
						body: vector.body,
					}),
				);
				await verify(result, upstream.requests, vector[candidate]);
			});
		}
	}

	for (const candidate of ['hono', 'utils'] as const) {
		it(`client disconnect: ${candidate}`, { timeout: 15_000 }, async (test) => {
			const controller = new AbortController();
			const entered = Promise.withResolvers<void>();
			const aborted = Promise.withResolvers<void>();
			const lateCancelled = Promise.withResolvers<unknown>();
			const stopped = Promise.withResolvers<void>();
			const stop = () => {
				controller.abort('client disconnect');
				aborted.resolve();
				stopped.reject(test.signal.reason);
			};
			test.signal.addEventListener('abort', stop, { once: true });
			let upstreamEntered = false;
			const transport: Transport = async (request) => {
				const reader = request.body!.getReader();
				const cancel = () => aborted.resolve();
				request.signal.addEventListener('abort', cancel, { once: true });
				try {
					const first = await reader.read();
					expect(new TextDecoder().decode(first.value)).toBe('test');
					upstreamEntered = true;
					entered.resolve();
					await aborted.promise;
					await reader.cancel(request.signal.reason);
					// The upstream Hono mock returns the literal abort reason as a
					// response. Gateway caller-cancellation remains authoritative.
					return new Response(
						new ReadableStream<Uint8Array>({
							start(controller) {
								controller.enqueue(new TextEncoder().encode(String(request.signal.reason)));
								controller.close();
							},
							cancel(reason) {
								lateCancelled.resolve(reason);
							},
						}),
					);
				} finally {
					request.signal.removeEventListener('abort', cancel);
					reader.releaseLock();
				}
			};
			const api = candidate === 'hono' ? createHonoProxy('raw', transport) : createUtilsProxy('raw', transport);
			const pending = api.fetch(
				new Request('https://gateway.invalid/proxy/disconnect', {
					method: 'POST',
					body: 'test',
					signal: controller.signal,
				}),
			);
			const outcome = pending.then(
				(value) => ({ status: 'fulfilled', value } as const),
				(reason: unknown) => ({ status: 'rejected', reason } as const),
			);
			const entryOutcome = outcome.then(async (settled) => {
				if (upstreamEntered) return;
				if (settled.status === 'rejected') throw settled.reason;
				await settled.value.body?.cancel();
				throw new Error('Proxy completed before entering the upstream abort gate.');
			}).then(
				() => ({ status: 'fulfilled' } as const),
				(reason: unknown) => ({ status: 'rejected', reason } as const),
			);
			const entrySignal = entered.promise.then(() => ({ status: 'fulfilled' } as const));
			let primary: Readonly<{ reason: unknown }> | undefined;
			let cancellation: Awaited<typeof entryOutcome> | undefined;
			let joinedEntry: Awaited<typeof entryOutcome> | undefined;
			try {
				const entry = await Promise.race([entrySignal, entryOutcome, stopped.promise]);
				if (entry && entry.status === 'rejected') {
					throw entry.reason;
				}
				controller.abort('client disconnect');
				const settled = await outcome;
				if (candidate === 'hono') {
					expect(settled.status).toBe('fulfilled');
					if (settled.status !== 'fulfilled') throw settled.reason;
					expect(await settled.value.text()).toBe('client disconnect');
				} else {
					expect(settled).toEqual({ status: 'rejected', reason: 'client disconnect' });
					expect(await Promise.race([lateCancelled.promise, stopped.promise])).toBe('client disconnect');
				}
			} catch (reason: unknown) {
				// A box distinguishes no failure from a thrown undefined value.
				primary = { reason };
			} finally {
				controller.abort('client disconnect');
				aborted.resolve();
				entered.resolve();
				const settled = await outcome;
				cancellation = await (settled.status === 'fulfilled' && !settled.value.bodyUsed
					? settled.value.body?.cancel('test cleanup') ?? Promise.resolve()
					: Promise.resolve()).then(
						() => ({ status: 'fulfilled' } as const),
						(reason: unknown) => ({ status: 'rejected', reason } as const),
					);
				joinedEntry = await entryOutcome;
				await entrySignal;
				test.signal.removeEventListener('abort', stop);
				stopped.resolve();
				lateCancelled.resolve(undefined);
			}
			// Completion ownership is settled before choosing which failure to report.
			if (primary !== undefined) throw primary.reason;
			if (cancellation?.status === 'rejected') throw cancellation.reason;
			if (joinedEntry?.status === 'rejected') throw joinedEntry.reason;
		});
	}
});

describe('proxy transport boundaries beyond the upstream corpus', () => {
	for (const candidate of ['hono', 'utils'] as const) {
		const create = (transport: Transport, preserveCredentials = false): ProxyApi =>
			candidate === 'hono'
				? createHonoProxy('manual', transport)
				: createUtilsProxy('manual', transport, preserveCredentials);

		it(`${candidate} preserves manual redirect status, location, statusText and separate cookies`, async () => {
			const api = create(async (request) => {
				expect(request.redirect).toBe('manual');
				const headers = new Headers({ location: 'https://example.com/next?ok=1', 'x-response-id': '456' });
				headers.append('set-cookie', 'first=1; Path=/');
				headers.append('set-cookie', 'second=2; Path=/');
				return new Response('redirect body', { status: 302, statusText: 'Moved upstream', headers });
			});
			const result = await api.fetch(new Request('https://gateway.invalid/proxy/redirect'));
			const body = await result.text();
			expect(result.status).toBe(302);
			expect(result.statusText).toBe('Moved upstream');
			expect(result.headers.get('location')).toBe('https://example.com/next?ok=1');
			expect(result.headers.getSetCookie()).toEqual(['first=1; Path=/', 'second=2; Path=/']);
			expect(body).toBe('redirect body');
		});

		it(`${candidate} preserves explicitly admitted authorization and cookies`, async () => {
			const api = create(async (request) => {
				expect(request.headers.get('authorization')).toBe('Bearer 123');
				expect(request.headers.get('cookie')).toBe('session=123');
				return new Response('accepted', { status: 201, statusText: 'Created upstream' });
			}, true);
			const result = await api.fetch(
				new Request('https://gateway.invalid/proxy/status', {
					headers: { Authorization: 'Bearer 123', Cookie: 'session=123' },
				}),
			);
			const body = await result.text();
			expect(result.status).toBe(201);
			expect(result.statusText).toBe('Created upstream');
			expect(body).toBe('accepted');
		});

		it(`${candidate} forwards streaming Unicode request bytes with declared Content-Length`, async () => {
			const encoded = new TextEncoder().encode('snow:雪');
			const api = create(async (request) => {
				expect(request.headers.get('content-length')).toBe('8');
				expect([...new Uint8Array(await request.arrayBuffer())]).toEqual([115, 110, 111, 119, 58, 233, 155, 170]);
				return new Response('accepted');
			});
			const result = await api.fetch(
				new Request(
					'https://gateway.invalid/proxy/body',
					{
						method: 'POST',
						headers: { 'content-length': '8' },
						body: new ReadableStream<Uint8Array>({
							start(controller) {
								controller.enqueue(encoded.subarray(0, 6));
								controller.enqueue(encoded.subarray(6));
								controller.close();
							},
						}),
						duplex: 'half',
					} as RequestInit & { duplex: 'half' },
				),
			);
			expect(await result.text()).toBe('accepted');
		});

		it(
			`${candidate} keeps response streaming and propagates downstream cancellation`,
			{ timeout: 15_000 },
			async (test) => {
				const cancelled = Promise.withResolvers<unknown>();
				const release = Promise.withResolvers<void>();
				const pulls: Promise<void>[] = [];
				let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
				let stopping:
					| Promise<
						| Readonly<{ status: 'fulfilled' }>
						| Readonly<{ status: 'rejected'; reason: unknown }>
					>
					| undefined;
				const stop = () => {
					release.resolve();
					stopping = reader?.cancel(test.signal.reason).then(
						() => ({ status: 'fulfilled' } as const),
						(reason: unknown) => ({ status: 'rejected', reason } as const),
					);
				};
				test.signal.addEventListener('abort', stop, { once: true });
				let position = 0;
				const api = create(async () =>
					new Response(
						new ReadableStream<Uint8Array>({
							pull(controller) {
								if (position++ === 0) controller.enqueue(new TextEncoder().encode('first'));
								else {
									pulls.push(release.promise);
									return release.promise;
								}
							},
							cancel(reason) {
								cancelled.resolve(reason);
								release.resolve();
							},
						}),
					)
				);
				try {
					const result = await api.fetch(new Request('https://gateway.invalid/proxy/stream', { signal: test.signal }));
					reader = result.body!.getReader();
					const chunk = await reader.read();
					expect(new TextDecoder().decode(chunk.value)).toBe('first');
				} finally {
					try {
						await reader?.cancel('consumer stopped');
					} finally {
						release.resolve();
						try {
							await Promise.all(pulls);
							const interrupted = await stopping;
							if (interrupted?.status === 'rejected') expect(interrupted.reason).toBe(test.signal.reason);
						} finally {
							reader?.releaseLock();
							test.signal.removeEventListener('abort', stop);
						}
					}
				}
				expect(await cancelled.promise).toBe('consumer stopped');
			},
		);

		it(`${candidate} records unknown Content-Encoding without claiming Fetch decoded it`, async () => {
			let upstreamCalls = 0;
			const api = create(async (request) => {
				upstreamCalls += 1;
				expect(request.method).toBe('GET');
				return new Response('raw', { headers: { 'Content-Encoding': 'custom-coding', 'Content-Length': '3' } });
			});
			const result = await api.fetch(new Request('https://gateway.invalid/proxy/compressed'));
			const body = await result.text();
			expect(upstreamCalls).toBe(1);
			expect(result.status).toBe(200);
			expect(body).toBe('raw');
			// An unknown coding supplies no evidence that native Fetch decoded bytes.
			// Hono removes encoding metadata for every coding; gateway preserves it.
			expect(result.headers.get('content-encoding')).toBe(candidate === 'hono' ? null : 'custom-coding');
			expect(result.headers.get('content-length')).toBe(candidate === 'hono' ? null : '3');
		});

		it(`${candidate} records gzip representation metadata on a null-body HEAD response`, async () => {
			let upstreamCalls = 0;
			const api = create(async (request) => {
				upstreamCalls += 1;
				expect(request.method).toBe('HEAD');
				expect(request.body).toBeNull();
				return new Response(null, { headers: { 'Content-Encoding': 'gzip', 'Content-Length': '123' } });
			});
			const result = await api.fetch(new Request('https://gateway.invalid/proxy/compressed', { method: 'HEAD' }));
			const body = await result.text();
			expect(upstreamCalls).toBe(1);
			expect(result.status).toBe(200);
			expect(result.body).toBeNull();
			expect(body).toBe('');
			// HEAD describes the representation without transferring compressed bytes.
			expect(result.headers.get('content-encoding')).toBe(candidate === 'hono' ? null : 'gzip');
			expect(result.headers.get('content-length')).toBe(candidate === 'hono' ? null : '123');
		});

		it(`${candidate} records encoding metadata nominated by Connection without hiding the length difference`, async () => {
			const api = create(async () =>
				new Response('ok', {
					headers: { Connection: 'content-encoding', 'Content-Encoding': 'gzip', 'Content-Length': '1' },
				})
			);
			const result = await api.fetch(new Request('https://gateway.invalid/proxy/compressed'));
			const body = await result.text();
			expect(result.status).toBe(200);
			expect(result.headers.get('connection')).toBeNull();
			expect(result.headers.get('content-encoding')).toBeNull();
			// Hono inspects its already filtered header set. Gateway remembers the
			// original encoding and also drops the stale compressed byte length.
			expect(result.headers.get('content-length')).toBe(candidate === 'hono' ? '1' : null);
			expect(body).toBe('ok');
		});
	}
});
