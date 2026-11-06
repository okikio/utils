import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as proxy from './proxy.ts';

/** Read a bounded protocol field regardless of TCP packet segmentation. */
async function read(connection: Deno.Conn, length: number): Promise<Uint8Array> {
	const bytes = new Uint8Array(length);
	let offset = 0;
	while (offset < length) {
		const count = await connection.read(bytes.subarray(offset));
		if (count === null) throw new Error('Proxy fixture connection ended unexpectedly.');
		offset += count;
	}
	return bytes;
}

/** Write the complete fixture response even when the socket accepts a partial write. */
async function write(connection: Deno.Conn, bytes: Uint8Array): Promise<void> {
	let offset = 0;
	while (offset < bytes.length) offset += await connection.write(bytes.subarray(offset));
}

/** Admit only unauthenticated domain-name SOCKS requests used by the local test. */
async function connect(connection: Deno.Conn): Promise<{ hostname: string; port: number }> {
	const greeting = await read(connection, 2);
	expect(greeting[0]).toBe(5);
	expect(await read(connection, greeting[1]!)).toContain(0);
	await write(connection, new Uint8Array([5, 0]));
	expect(await read(connection, 4)).toEqual(new Uint8Array([5, 1, 0, 3]));
	const length = (await read(connection, 1))[0]!;
	const hostname = new TextDecoder().decode(await read(connection, length));
	const portBytes = await read(connection, 2);
	await write(connection, new Uint8Array([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
	return { hostname, port: portBytes[0]! * 256 + portBytes[1]! };
}

describe('Deno private proxy transport', () => {
	it('passes the destination domain through SOCKS and preserves the request host', async () => {
		const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 });
		using transport = proxy.create({ url: `socks5h://127.0.0.1:${listener.addr.port}`, bypass: [] });
		let connection: Deno.Conn | undefined;
		const serving = (async () => {
			connection = await listener.accept();
			expect(await connect(connection)).toEqual({ hostname: 'localhost', port: 80 });
			let header = '';
			while (!header.endsWith('\r\n\r\n')) {
				if (header.length > 4096) throw new Error('Unexpected fixture request header size.');
				header += String.fromCharCode((await read(connection, 1))[0]!);
			}
			expect(header.toLowerCase()).toContain('host: localhost\r\n');
			await write(
				connection,
				new TextEncoder().encode('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok'),
			);
		})();
		const requesting = (async () => {
			const response = await transport.fetch('http://localhost/status', { signal: AbortSignal.timeout(1_000) });
			expect(await response.text()).toBe('ok');
		})().finally(() => {
			listener.close();
			connection?.close();
		});
		await Promise.all([serving, requesting]);
	});

	it('keeps HTTPS as a TLS handshake with the original server name', async () => {
		const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 });
		using transport = proxy.create({ url: `socks5h://127.0.0.1:${listener.addr.port}`, bypass: [] });
		let connection: Deno.Conn | undefined;
		const serving = (async () => {
			connection = await listener.accept();
			expect(await connect(connection)).toEqual({ hostname: 'localhost', port: 443 });
			const record = await read(connection, 5);
			expect(record[0]).toBe(22); // TLS handshake, never a plaintext HTTP request.
			const length = record[3]! * 256 + record[4]!;
			if (length > 16_384) throw new Error('Unexpected TLS fixture record size.');
			const hello = await read(connection, length);
			expect(hello[0]).toBe(1); // ClientHello.
			expect(new TextDecoder().decode(hello)).toContain('localhost');
			connection.close();
			connection = undefined;
		})();
		// The fixture deliberately supplies no certificate. Native TLS validation
		// remains active; the test observes the real SNI-bearing ClientHello only.
		const requesting = expect(transport.fetch('https://localhost/status', { signal: AbortSignal.timeout(1_000) }))
			.rejects.toBeDefined()
			.finally(() => {
				listener.close();
				connection?.close();
			});
		await Promise.all([serving, requesting]);
	});
});
