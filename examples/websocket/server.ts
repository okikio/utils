/** A native Deno WebSocket host beside a portable Utils HTTP application. @module */
import * as http from '@okikio/server/http';

/** Open a loopback greeting host. The caller must await close() to release sockets and the listener. */
export function listen(port = 8000) {
	const sockets = new Set<WebSocket>();
	const app = http.create({
		routes: [http.route('GET', '/status', () => Response.json({ connections: sockets.size }))],
	});
	const listener = Deno.serve({ hostname: '127.0.0.1', port, onListen() {} }, (request) => {
		if (new URL(request.url).pathname !== '/socket') return app.fetch(request);
		if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
			return new Response('Use a WebSocket client.', { status: 400 });
		}
		// Admit before upgrading: after the switch, ordinary HTTP errors cannot be sent.
		// A browser Origin is checked independently of identity. CLI clients may omit it.
		const origin = request.headers.get('origin');
		if (origin !== null && origin !== 'http://localhost:8000') {
			return new Response('Origin refused.', { status: 403 });
		}
		if (sockets.size >= 2) return new Response('Connection limit reached.', { status: 503 });
		const { socket, response } = Deno.upgradeWebSocket(request);
		sockets.add(socket);
		socket.addEventListener('message', (event) => {
			// The host already received this frame. This application limit bounds the
			// accepted name; it is not a transport-level incoming-memory limit.
			if (typeof event.data !== 'string' || new TextEncoder().encode(event.data).byteLength > 1024) {
				socket.close(1003, 'Send a short text name.');
				return;
			}
			// Never keep queuing replies for a reader that stopped consuming them.
			if (socket.bufferedAmount > 4096) {
				socket.close(1013, 'Reader too slow.');
				return;
			}
			socket.send(`Hello, ${event.data}!`);
		});
		socket.addEventListener('close', () => sockets.delete(socket));
		socket.addEventListener('error', () => socket.close());
		return response;
	});
	return {
		url: new URL(`ws://127.0.0.1:${listener.addr.port}/socket`),
		async close(): Promise<void> {
			// Shutdown owns every accepted connection, including ones with no messages.
			for (const socket of sockets) socket.close(1001, 'Server stopping.');
			await listener.shutdown();
		},
	};
}
