/** Real loopback HTTP bridge shared by transport tests and socket benchmarks. @module */
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

/** Own the socket listener, stream with backpressure, and propagate response disconnects. */
export async function listen(handler: (request: Request) => Promise<Response>) {
	const server = createServer(async (incoming, outgoing) => {
		const disconnected = new AbortController();
		outgoing.on('close', () => {
			if (!outgoing.writableFinished) disconnected.abort();
		});
		try {
			const chunks: Buffer[] = [];
			for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
			const headers = new Headers();
			for (const [name, value] of Object.entries(incoming.headers)) {
				if (Array.isArray(value)) { for (const item of value) headers.append(name, item); }
				else if (value !== undefined) headers.set(name, value);
			}
			const request = new Request(`http://localhost${incoming.url}`, {
				method: incoming.method,
				headers,
				body: Buffer.concat(chunks),
				signal: disconnected.signal,
			});
			const result = await handler(request);
			outgoing.writeHead(result.status, Object.fromEntries(result.headers));
			outgoing.flushHeaders();
			if (result.body) {
				for await (const chunk of result.body) {
					if (!outgoing.write(chunk)) await once(outgoing, 'drain', { signal: disconnected.signal });
				}
			}
			outgoing.end();
		} catch {
			if (!outgoing.headersSent) outgoing.writeHead(500);
			outgoing.end();
		}
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	return {
		url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/attempt`,
		async [Symbol.asyncDispose]() {
			// Stop admission before closing sockets; this ordering also preserves Bun's Node-server lifecycle.
			await new Promise<void>((resolve, reject) => {
				server.close((error) => error ? reject(error) : resolve());
				server.closeAllConnections();
			});
		},
	};
}
