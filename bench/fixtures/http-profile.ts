/** Diagnostic HTTP workload owners for middleware scaling, first dispatch and client disconnect. @module */
import { deepStrictEqual } from 'node:assert';
import { Hono } from 'hono';
import { create, route } from '@okikio/server/http';
import type { Middleware } from '@okikio/server/http';
import { createHonoRouting } from '../../tests/fixtures/http-parity/hono.ts';
import { createUtilsRouting } from '../../tests/fixtures/http-parity/utils.ts';
import { createHonoProxy, createUtilsProxy } from '../../tests/fixtures/hono-proxy/implementations.ts';
import type { Transport } from '../../tests/fixtures/hono-proxy/implementations.ts';

export type Candidate = 'utils' | 'hono';
/** Setup is owned by open(), and run() consumes or cancels every finite body it produces. */
export interface HttpProfileCase {
	readonly id: string;
	readonly scope: string;
	readonly open: (candidate: Candidate) => {
		readonly run: () => Promise<unknown>;
		readonly expected: unknown;
		readonly units: number;
		readonly close: () => Promise<void>;
	};
}

/** Scale real onion dispatch, with an independent expected count and one terminal call. */
function middleware(count: number): HttpProfileCase {
	return {
		id: `middleware-${count}`,
		scope: 'Fresh request, real onion middleware and fully consumed response. Count includes both before/after visits.',
		open(candidate) {
			let visits = 0, terminal = 0;
			let fetch: (request: Request) => Promise<Response>;
			if (candidate === 'hono') {
				const app = new Hono();
				for (let n = 0; n < count; n++) {
					app.use('*', async (_ctx, next) => {
						visits++;
						await next();
						visits++;
					});
				}
				app.get('/work', () => {
					terminal++;
					return new Response('done');
				});
				fetch = async (request) => await app.fetch(request);
			} else {
				const layers: Middleware[] = Array.from({ length: count }, () => async (request, next) => {
					visits++;
					const value = await next(request);
					visits++;
					return value;
				});
				const app = create({
					routes: [route('GET', '/work', () => {
						terminal++;
						return new Response('done');
					})],
					middleware: layers,
				});
				fetch = async (request) => await app.fetch(request);
			}
			return {
				async run() {
					visits = 0;
					terminal = 0;
					const result = await fetch(new Request('https://profile.invalid/work'));
					return { status: result.status, body: await result.text(), visits, terminal };
				},
				expected: { status: 200, body: 'done', visits: count * 2, terminal: 1 },
				units: 1,
				close: async () => {},
			};
		},
	};
}

/** Cancel only after the mock has read the original POST bytes. The late-body policy remains candidate-specific. */
function disconnect(): HttpProfileCase {
	return {
		id: 'proxy-client-disconnect',
		scope:
			'Pinned POST test bytes and client disconnect reason; Utils rejects and cancels a late response, Hono returns the mock response.',
		open(candidate) {
			let entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
			let lateCancelled = false;
			let upstreamEntered = false;
			const transport: Transport = async (request) => {
				deepStrictEqual(await request.text(), 'test');
				upstreamEntered = true;
				entered.resolve();
				await release.promise;
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new TextEncoder().encode(String(request.signal.reason)));
							controller.close();
						},
						cancel(reason) {
							deepStrictEqual(reason, 'client disconnect');
							lateCancelled = true;
						},
					}),
				);
			};
			const app = candidate === 'hono' ? createHonoProxy('raw', transport) : createUtilsProxy('raw', transport);
			return {
				async run() {
					entered = Promise.withResolvers<void>();
					release = Promise.withResolvers<void>();
					lateCancelled = false;
					upstreamEntered = false;
					const controller = new AbortController();
					const pending = app.fetch(
						new Request('https://gateway.invalid/proxy/disconnect', {
							method: 'POST',
							body: 'test',
							signal: controller.signal,
						}),
					).then(
						(value) => ({ value } as const),
						(reason: unknown) => ({ reason } as const),
					);
					try {
						await Promise.race([
							entered.promise,
							pending.then(async (outcome) => {
								if (upstreamEntered) return;
								if ('value' in outcome) await outcome.value.body?.cancel();
								throw new Error('Proxy completed before the abort gate.');
							}),
						]);
						controller.abort('client disconnect');
						release.resolve();
						const outcome = await pending;
						return 'value' in outcome
							? { body: await outcome.value.text(), lateCancelled }
							: { reason: outcome.reason, lateCancelled };
					} finally {
						controller.abort('client disconnect');
						release.resolve();
						await pending;
					}
				},
				expected: candidate === 'hono'
					? { body: 'client disconnect', lateCancelled: false }
					: { reason: 'client disconnect', lateCancelled: true },
				units: 1,
				close: async () => {},
			};
		},
	};
}

/** Each callback compiles/registers a table and consumes its first response, unlike warmed route profiles. */
function construction(count: number): HttpProfileCase {
	return {
		id: `construct-routes-${count}`,
		scope: 'Route registration/preparation plus first request and joined owner close; input table size is explicit.',
		open(candidate) {
			return {
				async run() {
					const app = candidate === 'hono' ? createHonoRouting(count) : createUtilsRouting(count);
					try {
						const result = await app.fetch(new Request('https://service.invalid/fixed/0'));
						return { status: result.status, body: await result.json() };
					} finally {
						await app.close();
					}
				},
				expected: { status: 200, body: { kind: 'static', slot: 0 } },
				units: 1,
				close: async () => {},
			};
		},
	};
}

/** Return every diagnostic scenario; these supplement the canonical Mitata inventory rather than replacing it. */
export function httpProfileCases(): readonly HttpProfileCase[] {
	return [...[0, 1, 4, 16, 64].map(middleware), disconnect(), ...[16, 256, 4096].map(construction)];
}
