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
