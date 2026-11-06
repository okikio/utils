/** Open a loopback HTTP listener for one Fetch application on Deno, Node, or Bun. */
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGreetingMcp } from './server.ts';

/** An open listener and the cleanup operation owned by its caller. */
export interface ListenerType {
	/** Loopback endpoint, including the operating system's selected port. */
	readonly url: URL;
	/** Stop accepting requests, join open responses, then release the MCP host. */
	close(): Promise<void>;
}

/**
 * Open a development listener. Port zero asks the OS for an available port.
 * The caller owns close(), which stops admission before closing the MCP host.
 */
export async function listen(port = 8000): Promise<ListenerType> {
	const host = createGreetingMcp();
	// Deno supplies a Fetch-native listener. Node and Bun use the stream adapter
	// below; the HTTP application and tool registration stay identical.
	if (typeof Deno !== 'undefined') {
		let listener: Deno.HttpServer<Deno.NetAddr>;
		try {
			listener = Deno.serve({ hostname: '127.0.0.1', port, onListen() {} }, (request) => host.app.fetch(request));
		} catch (error) {
			// The caller receives no listener on startup failure, so release its host here.
			await host.close();
			throw error;
		}
		return {
			url: new URL(`http://localhost:${listener.addr.port}/mcp`),
			async close(): Promise<void> {
				try {
					await listener.shutdown();
				} finally {
					await host.close();
				}
			},
		};
	}
	const server = createServer(async (incoming, outgoing) => {
		const cancellation = new AbortController();
		// A disconnected caller must not leave a streaming response producing data.
		outgoing.once('close', () => cancellation.abort());
		try {
			const headers = new Headers();
			// Node stores alternating names and values here. Preserve repeated fields
			// when converting the request to the Web Headers used by the application.
			for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
				headers.append(incoming.rawHeaders[index]!, incoming.rawHeaders[index + 1]!);
			}
			const body = incoming.method === 'GET' || incoming.method === 'HEAD'
				? undefined
				: Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
			// Node requires duplex: 'half' for a streamed request body. This option
			// admits that body; it does not turn HTTP into a WebSocket connection.
			const init: RequestInit & { duplex?: 'half' } = {
				method: incoming.method,
				headers,
				body,
				signal: cancellation.signal,
				...(body ? { duplex: 'half' as const } : {}),
			};
			const response = await host.app.fetch(new Request(`http://localhost${incoming.url}`, init));
			outgoing.statusCode = response.status;
			for (const [name, value] of response.headers) if (name !== 'set-cookie') outgoing.setHeader(name, value);
			const cookies = response.headers.getSetCookie();
			if (cookies.length) outgoing.setHeader('set-cookie', cookies);
			// Wait when the outgoing socket cannot accept more bytes. Collecting the
			// whole body here would delay streamed events and retain them in memory.
			// pipeline also joins stream cleanup if the caller disconnects.
			if (response.body) await pipeline(Readable.from(response.body), outgoing);
			else outgoing.end();
		} catch (error) {
			if (!outgoing.headersSent) {
				outgoing.statusCode = 500;
				outgoing.end('Request failed.');
			} else outgoing.destroy(error instanceof Error ? error : new Error('Request failed.'));
		}
	});
	try {
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(port, '127.0.0.1', () => {
				server.removeListener('error', reject);
				resolve();
			});
		});
	} catch (error) {
		await host.close();
		throw error;
	}
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Expected a TCP listener.');
	return {
		url: new URL(`http://localhost:${address.port}/mcp`),
		async close(): Promise<void> {
			try {
				await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
			} finally {
				await host.close();
			}
		},
	};
}
