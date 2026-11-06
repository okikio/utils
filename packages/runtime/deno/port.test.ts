import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as port from './port.ts';

describe('ephemeral Deno ports', () => {
	it('releases its temporary listener before handing off a valid TCP port', () => {
		for (let attempt = 0; attempt < 8; attempt++) {
			const value = port.get();
			expect(Number.isSafeInteger(value)).toBe(true);
			expect(value).toBeGreaterThan(0);
			expect(value).toBeLessThanOrEqual(65535);
			try {
				const listener = Deno.listen({ hostname: '127.0.0.1', port: value });
				listener.close();
				return;
			} catch (error) {
				// The API closes its discovery listener; an unrelated process can win the handoff.
				if (!(error instanceof Deno.errors.AddrInUse)) throw error;
			}
		}
		throw new Error('Every discovered port remained occupied after handoff.');
	});
});

it('keeps a reservation occupied, accepts on its actual listener, and releases exactly once', async () => {
	const reserved = port.reserve();
	expect(reserved.closed).toBe(false);
	expect(() => Deno.listen({ hostname: reserved.address.hostname, port: reserved.address.port })).toThrow(
		Deno.errors.AddrInUse,
	);
	const accepted = reserved.listener.accept();
	using client = await Deno.connect({ hostname: reserved.address.hostname, port: reserved.address.port });
	using connection = await accepted;
	await client.write(new Uint8Array([7]));
	const bytes = new Uint8Array(1);
	expect(await connection.read(bytes)).toBe(1);
	expect(bytes[0]).toBe(7);
	reserved[Symbol.dispose]();
	reserved[Symbol.dispose]();
	expect(reserved.closed).toBe(true);
	using rebound = Deno.listen({ hostname: reserved.address.hostname, port: reserved.address.port });
	expect(rebound.addr.port).toBe(reserved.address.port);
});
