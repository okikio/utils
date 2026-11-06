/** Verify trusted TLS and nginx failure boundaries against a real container provider. @module */
import { after, before, describe, it } from 'node:test';
import { expect } from '@std/expect';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { open } from '../fixtures/duplex/proxy.ts';
import { call } from '../fixtures/duplex/caller.ts';
import { until } from './fixtures/evidence.ts';

type Edge = Awaited<ReturnType<typeof open>>;
let edge: Edge;
const output = resolve(process.env.UTILS_DUPLEX_OUTPUT ?? '.tmp/artifacts/tests/duplex-proxy');
before(async () => {
	edge = await open();
});
after(async () => {
	if (!edge) return;
	try {
		await mkdir(output, { recursive: true });
		await writeFile(
			resolve(output, 'proxy.json'),
			JSON.stringify({ ...(await edge.diagnostics()), metrics: await edge.host.metrics() }, null, 2),
		);
		await writeFile(resolve(output, 'nginx.conf'), edge.configuration);
	} finally {
		await edge[Symbol.asyncDispose]();
	}
});

/** Read actual provider state with a deadline rather than treating client completion as a cleanup receipt. */
async function phase(id: string, name: 'started' | 'waiting' | 'cleanup' | 'closed' | 'failed') {
	await until(async () => (await edge.host.metrics())[name].includes(id), `TLS attempt ${id}: ${name}`, 12000);
}
/** Each unique identity is reusable by metrics without carrying the per-run credential into retained receipts. */
function input(mode: 'authority' | 'wait' = 'authority', cleanup: 'automatic' | 'manual' | 'failure' = 'automatic') {
	return { id: crypto.randomUUID(), mode, cleanup, calls: 8 };
}

describe('duplex through a trusted TLS nginx edge', { concurrency: false, timeout: 180000 }, () => {
	it('streams all original authority calls before returning a validated container result', async () => {
		const value = input();
		await using caller = call({ url: `${edge.origin}/attempt`, ca: edge.ca, token: edge.host.token, input: value });
		const result = (await caller.done).find((value) => value.type === 'result')!;
		expect(result.result).toEqual({ type: 'success', value: { id: value.id, pid: (await edge.host.metrics()).pid } });
		expect(result.receipts).toEqual({
			heartbeats: Array.from({ length: 8 }, (_, index) => ({ id: value.id, index })),
			permissions: [value.id],
			effects: [{ id: value.id }],
		});
		await phase(value.id, 'closed');
	});

	for (const scenario of ['missing CA', 'wrong hostname'] as const) {
		it(`rejects ${scenario} before dispatching any provider work`, async () => {
			const value = input();
			const url = new URL('/attempt', edge.origin);
			if (scenario === 'wrong hostname') url.hostname = 'localhost';
			await using caller = call({
				url: String(url),
				...(scenario === 'wrong hostname' ? { ca: edge.ca } : {}),
				token: edge.host.token,
				input: value,
			});
			const result = (await caller.done).find((value) => value.type === 'result')!;
			expect(result.result?.type).toBe('lost');
			expect(result.diagnostic).toMatch(
				scenario === 'wrong hostname'
					? /ERR_TLS_CERT_ALTNAME_INVALID/u
					: /UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|SELF_SIGNED_CERT_IN_CHAIN/u,
			);
			expect((await edge.host.metrics()).started).not.toContain(value.id);
			expect(caller.messages.filter((value) => value.type === 'heartbeat')).toEqual([]);
		});
	}

	it('does not dispatch invalid start credentials or follow a credential-bearing redirect', async () => {
		for (const route of ['/attempt', '/redirect']) {
			const value = input();
			await using caller = call({
				url: `${edge.origin}${route}`,
				ca: edge.ca,
				token: route === '/attempt' ? 'invalid' : edge.host.token,
				input: value,
			});
			expect((await caller.done).find((value) => value.type === 'result')?.result?.type).toBe('lost');
			expect((await edge.host.metrics()).started).not.toContain(value.id);
		}
	});

	it('keeps caller and provider ownership pending until cancellation cleanup is released', async () => {
		const value = input('wait', 'manual');
		await using caller = call({ url: `${edge.origin}/attempt`, ca: edge.ca, token: edge.host.token, input: value });
		try {
			await phase(value.id, 'waiting');
			await caller.cancel();
			await phase(value.id, 'cleanup');
			expect(caller.settled).toBe(false);
			expect(caller.messages.some((value) => value.type === 'result')).toBe(false);
			expect((await edge.host.metrics()).active).toContain(value.id);
		} finally {
			await edge.host.release(value.id);
		}
		expect((await caller.done).find((value) => value.type === 'result')?.result?.type).toBe('cancelled');
		await phase(value.id, 'closed');
	});

	it('propagates physical socket disconnect without releasing a held provider scope', async () => {
		const value = input('wait', 'manual');
		await using caller = call({
			url: `${edge.origin}/attempt`,
			ca: edge.ca,
			token: edge.host.token,
			input: value,
			scenario: 'disconnect',
		});
		try {
			await caller.done;
			await phase(value.id, 'cleanup');
			expect((await edge.host.metrics()).active).toContain(value.id);
		} finally {
			await edge.host.release(value.id);
		}
		await phase(value.id, 'closed');
	});

	it('authenticates reply and cancel posts independently through the proxy', async () => {
		const value = input('wait', 'manual');
		await using caller = call({
			url: `${edge.origin}/attempt`,
			ca: edge.ca,
			token: edge.host.token,
			input: value,
			scenario: 'controls',
		});
		try {
			const messages = await caller.done;
			expect(messages.find((value) => value.type === 'controls')?.statuses).toEqual([401, 401]);
			await phase(value.id, 'cleanup');
			expect((await edge.host.metrics()).active).toContain(value.id);
		} finally {
			await edge.host.release(value.id);
		}
		await phase(value.id, 'closed');
	});

	it('reports lost when an idle proxy closes the response and still retains cleanup ownership', async () => {
		const value = input('wait', 'manual');
		await using caller = call({ url: `${edge.origin}/idle`, ca: edge.ca, token: edge.host.token, input: value });
		try {
			await phase(value.id, 'waiting');
			expect((await caller.done).find((value) => value.type === 'result')?.result?.type).toBe('lost');
			await phase(value.id, 'cleanup');
			expect((await edge.host.metrics()).active).toContain(value.id);
		} finally {
			await edge.host.release(value.id);
		}
		await phase(value.id, 'closed');
	});

	it('detects buffering that prevents the first original authority reply from completing', async () => {
		const value = input();
		await using caller = call({
			url: `${edge.origin}/buffered`,
			ca: edge.ca,
			token: edge.host.token,
			input: value,
			timeoutMs: 1500,
		});
		expect((await caller.done).find((value) => value.type === 'result')?.result?.type).toBe('lost');
		expect(caller.messages.filter((value) => value.type === 'heartbeat')).toEqual([]);
		await phase(value.id, 'closed');
	});

	it('does not certify cancellation when the proxied provider throws during cleanup', async () => {
		const value = input('wait', 'failure');
		await using caller = call({ url: `${edge.origin}/attempt`, ca: edge.ca, token: edge.host.token, input: value });
		await phase(value.id, 'waiting');
		await caller.cancel();
		expect((await caller.done).find((value) => value.type === 'result')?.result?.type).toBe('lost');
		await phase(value.id, 'failed');
		expect((await edge.host.metrics()).active).not.toContain(value.id);
	});
});
