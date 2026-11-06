import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as readiness from './readiness.ts';

describe('Deno TCP readiness adapter', () => {
	it('closes a successful real loopback probe', async () => {
		using listener = Deno.listen({ hostname: '127.0.0.1', port: 0 });
		const accepted = listener.accept();
		await readiness.wait(readiness.targets({ storage: `postgres://127.0.0.1:${listener.addr.port}/app` }), {
			signal: new AbortController().signal,
			timeoutMs: 1_000,
		});
		using connection = await accepted;
		expect(await connection.read(new Uint8Array(1))).toBe(null);
	});
});
