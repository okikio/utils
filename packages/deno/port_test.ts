import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as port from './port.ts';

describe('ephemeral Deno ports', () => {
	it('returns a released TCP port that can be rebound immediately', () => {
		const value = port.get();
		expect(Number.isSafeInteger(value)).toBe(true);
		expect(value).toBeGreaterThan(0);
		const listener = Deno.listen({ hostname: '127.0.0.1', port: value });
		listener.close();
	});
});
