/** Fault injection for plaintext PostgreSQL protocol v3 on owned loopback fixtures. @module */
import { connect, createServer } from 'node:net';
import type { Socket } from 'node:net';

/**
 * Forward plaintext PostgreSQL traffic and drop one selected COMMIT frame.
 * `before` drops the request before the server receives it. `after` drops the
 * successful reply after the server committed, leaving the client unsure of the outcome.
 *
 * This fixture recognizes simple-query COMMIT, not every SQL protocol form.
 * The caller owns arming and disposal. Diagnostics retain fault tags, not login frames.
 */
export async function proxy(host: string, port: number) {
	const sockets = new Set<Socket>();
	// One fault is shared by all connections. The first matching frame consumes it.
	let armed: 'before' | 'after' | undefined;
	const diagnostics: Array<{ source: string; message: string }> = [];
	const events: Array<{ mode: string; tag: string; at: number }> = [];
	const server = createServer((client) => {
		const upstream = connect({ host, port });
		for (const socket of [client, upstream]) {
			sockets.add(socket);
			socket.on('error', (error) => {
				diagnostics.push({ source: socket === client ? 'client' : 'upstream', message: String(error) });
				client.destroy();
				upstream.destroy();
			});
			socket.on('close', () => {
				sockets.delete(socket);
				client.destroy();
				upstream.destroy();
			});
		}
		let startup = true;

		/**
		 * Read complete protocol frames before forwarding or dropping them.
		 * TCP chunks can split a frame or contain several frames. Each direction
		 * keeps its own unfinished bytes; only the frontend has an untagged startup frame.
		 */
		function relay(source: Socket, target: Socket, frontend: boolean) {
			// Bytes after the last complete frame stay here until more data arrives.
			let pending = Buffer.alloc(0);
			source.on('data', (chunk: Buffer) => {
				pending = Buffer.concat([pending, chunk]);
				while (pending.length >= (frontend && startup ? 4 : 5)) {
					// Startup length includes its header. Tagged messages add a one-byte type before the length.
					const initial = frontend && startup;
					const length = initial ? pending.readInt32BE(0) : 1 + pending.readInt32BE(1);
					// This fixture sends small statements/results. Fail closed on malformed or oversized frames.
					if (length < (initial ? 8 : 5) || length > 1024 * 1024) {
						client.destroy();
						upstream.destroy();
						return;
					}
					if (pending.length < length) return;
					const frame = pending.subarray(0, length);
					pending = pending.subarray(length);
					const tag = initial ? '' : frame.subarray(5, -1).toString();
					// Q is Simple Query (81); C is Command Complete (67). Inspect COMMIT at those boundaries.
					const before = frontend && !initial && frame[0] === 81 && /^commit\s*$/iu.test(tag);
					const after = !frontend && frame[0] === 67 && tag === 'COMMIT';
					if ((armed === 'before' && before) || (armed === 'after' && after)) {
						events.push({ mode: armed!, tag, at: Date.now() });
						armed = undefined;
						client.destroy();
						upstream.destroy();
						return;
					}
					if (initial) startup = false;
					// Pause further socket reads while the destination drains its write buffer.
					if (!target.write(frame)) {
						source.pause();
						target.once('drain', () => source.resume());
					}
				}
			});
		}
		relay(client, upstream, true);
		relay(upstream, client, false);
	});
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (address === null || typeof address === 'string') throw new Error('Proxy has no TCP address.');
	return {
		diagnostics,
		url: `postgres://fixture:fixture@127.0.0.1:${address.port}/test`,
		events,
		/** Route new connections to the promoted server; existing connections keep their original peer. */
		target(nextHost: string, nextPort: number) {
			host = nextHost;
			port = nextPort;
		},
		/** Select the next matching COMMIT boundary. A second pending fault is a test error. */
		arm(mode: 'before' | 'after') {
			if (armed !== undefined) throw new Error('A COMMIT fault is already armed.');
			armed = mode;
		},
		/** Close both ends of every connection before waiting for the listening server to stop. */
		async [Symbol.asyncDispose]() {
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
		},
	};
}
