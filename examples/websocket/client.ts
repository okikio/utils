/** A native WebSocket client usable on Deno, Node and Bun. @module */

/** Send one name, await one reply, then await the close handshake. No reconnect or replay is implied. */
export async function greet(url: string | URL): Promise<string> {
	const socket = new WebSocket(url);
	const closed = new Promise<void>((resolve) => socket.addEventListener('close', () => resolve(), { once: true }));
	try {
		return await new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Greeting timed out.')), 5000);
			/**
			 * End the reply wait and clear its timeout. A later close/error event
			 * cannot replace the first outcome because a Promise settles once.
			 */
			const finish = (value: string | Error) => {
				clearTimeout(timer);
				if (value instanceof Error) reject(value);
				else resolve(value);
			};
			// send() is valid after open. It queues bytes; it does not acknowledge
			// that the server used the message, so wait for the application reply.
			socket.addEventListener('open', () => socket.send('Sam'), { once: true });
			socket.addEventListener('message', (event) => finish(String(event.data)), { once: true });
			socket.addEventListener('error', () => finish(new Error('Connection failed.')), { once: true });
			socket.addEventListener('close', () => finish(new Error('Closed before the greeting arrived.')), { once: true });
		});
	} finally {
		socket.close();
		await closed;
	}
}

if (import.meta.main) console.log(await greet('ws://127.0.0.1:8000/socket'));
