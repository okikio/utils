/** Synthetic load host: exercise real HTTP delivery without materializing a feed in memory. @module */
import '@okikio/duration/polyfill';
import * as http from '@okikio/server/http';
import * as endpoint from '@okikio/server/endpoint';
import * as service from '@okikio/server/service';
import * as gateway from '@okikio/server/gateway';
import * as response from '@okikio/http/response';
import * as schema from '@okikio/schema';
import * as events from '@okikio/http/events';
import { readable } from '@okikio/streams';

const Capacity = 8;
const Payload = 'x'.repeat(32 * 1024);
// Keep per-reader counters until this finite fixture exits so the parent can inspect
// stalled production after disconnect. A long-lived service must expire this metadata.
const clients = new Map<string, { generated: number; released: boolean }>();
let active = 0, peak = 0, refused = 0;
let peakRss = 0, peakHeap = 0;
const sampling = setInterval(() => {
	const memory = Deno.memoryUsage();
	peakRss = Math.max(peakRss, memory.rss);
	peakHeap = Math.max(peakHeap, memory.heapUsed);
}, 20);

/** Cancellation owns both the timer and its listener, including cancellation before registration. */
function pause(signal: AbortSignal, milliseconds: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const stop = () => {
			clearTimeout(timer);
			signal.removeEventListener('abort', stop);
			reject(signal.reason);
		};
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', stop);
			resolve();
		}, milliseconds);
		signal.addEventListener('abort', stop, { once: true });
		if (signal.aborted) stop();
	});
}

const app = http.create({
	routes: [
		http.route('GET', '/state', () =>
			Response.json({
				active,
				peak,
				refused,
				peakRss,
				peakHeap,
				runtime: Deno.version,
				memory: Deno.memoryUsage(),
				clients: Object.fromEntries(clients),
			})),
		http.route('POST', '/release', (request) => {
			const client = clients.get(new URL(request.url).searchParams.get('id') ?? '');
			if (client) client.released = true;
			return new Response(null, { status: client ? 204 : 404 });
		}),
		http.route('GET', '/events', (request) => {
			if (active >= Capacity) {
				refused += 1;
				return new Response('All stream slots are occupied.', { status: 503, headers: { 'retry-after': '1' } });
			}
			const url = new URL(request.url);
			const id = url.searchParams.get('id') ?? crypto.randomUUID();
			const count = Number(url.searchParams.get('count') ?? 64);
			if (!Number.isSafeInteger(count) || count < 2 || count > 16384 || clients.has(id)) {
				return new Response('Invalid fixture request.', { status: 400 });
			}
			const client = { generated: 0, released: false };
			clients.set(id, client);
			active += 1; // Reserve before returning headers, rather than waiting for the first body pull.
			peak = Math.max(peak, active);
			const gated = url.searchParams.has('gated');
			const heartbeat = url.searchParams.has('heartbeat');
			async function* messages(): AsyncGenerator<events.MessageType> {
				try {
					for (let index = 1; index <= count; index++) {
						request.signal.throwIfAborted();
						if (gated && index === 2) {
							while (!client.released) {
								await pause(request.signal, 100);
								// Comments keep the connection alive without advancing the applied-event cursor.
								if (heartbeat) yield { comment: 'keep-alive' };
							}
						}
						client.generated += 1;
						yield { id: String(index), data: gated ? `Hello ${index}` : Payload };
					}
				} finally {
					active -= 1;
				}
			}
			const body = readable(events.write(readable(messages()), {
				maximumEvents: 16384,
				maximumBytes: 32 * 1024 * 1024,
				maximumEventBytes: 64 * 1024,
				signal: request.signal,
			}));
			return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
		}),
	],
});
const listener = Deno.serve({
	hostname: Deno.env.get('STREAM_BIND') ?? '127.0.0.1',
	port: 0,
	onListen: ({ port }) => console.log(JSON.stringify({ port })),
}, (request) => {
	const url = new URL(request.url);
	if (!url.pathname.startsWith('/edge/')) return app.fetch(request);
	url.pathname = url.pathname.slice('/edge'.length);
	return edge.fetch(new Request(url, request));
});
const Stream = response.stream(schema.unknown(), { id: 'load.events', description: 'Synthetic event stream.' });
const Events = endpoint.get({ id: 'load.read', path: '/events', responses: [Stream] });
const Api = service.define({ id: 'load.api', path: '/', endpoints: [Events] });
const edge = gateway.create(
	gateway.compile(
		gateway.define({
			id: 'load.edge',
			services: [gateway.mount(Api, { origin: `http://127.0.0.1:${listener.addr.port}` })],
			policies: [gateway.policy({ id: 'load.deadline', endpoints: [Events], timeout: 'PT10S' })],
		}),
	),
);
const stop = () => {
	void listener.shutdown();
};
Deno.addSignalListener('SIGTERM', stop);
try {
	await listener.finished;
} finally {
	clearInterval(sampling);
	Deno.removeSignalListener('SIGTERM', stop);
}
