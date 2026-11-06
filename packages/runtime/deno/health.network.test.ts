import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as health from './health.ts';

/** Consume every response so server shutdown has no test-owned unfinished response. */
async function probe(origin: string, path: string): Promise<{ status: number; value: unknown; cache: string | null }> {
	const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(1_000) });
	return { status: response.status, value: await response.json(), cache: response.headers.get('cache-control') };
}

describe('native health listener lifecycle', () => {
	it('dependency degradation changes readiness while process liveness stays successful', async () => {
		await using listener = health.open({ port: 0, hostname: '127.0.0.1', signal: new AbortController().signal });
		const origin = `http://127.0.0.1:${listener.address!.port}`;
		assert.deepEqual(await probe(origin, '/ready'), { status: 503, value: { state: 'booting' }, cache: 'no-store' });
		listener.ready();
		assert.deepEqual((await probe(origin, '/ready')).value, { state: 'ready' });
		assert.equal((await probe(origin, '/ready')).status, 200);
		listener.degraded('dependency-unavailable');
		assert.deepEqual(await probe(origin, '/ready'), {
			status: 503,
			value: { state: 'degraded', reason: 'dependency-unavailable' },
			cache: 'no-store',
		});
		assert.deepEqual(await probe(origin, '/live'), { status: 200, value: { status: 'live' }, cache: 'no-store' });
		listener.ready();
		assert.equal((await probe(origin, '/ready')).status, 200);
		listener.stop();
		listener.ready();
		listener.degraded('recovering');
		assert.deepEqual((await probe(origin, '/ready')).value, { state: 'stopping' });
		assert.equal((await probe(origin, '/ready')).status, 503);
		assert.equal((await probe(origin, '/live')).status, 200);
	});

	it('cancellation and repeated async disposal close the listener and release its port', async () => {
		const controller = new AbortController();
		const listener = health.open({ port: 0, hostname: '127.0.0.1', signal: controller.signal });
		try {
			const port = listener.address!.port;
			assert.equal((await probe(`http://127.0.0.1:${port}`, '/live')).status, 200);
			controller.abort(new Error('private dependency payload must not enter a response'));
			assert.equal(listener.status.state, 'stopping');
			assert.strictEqual(listener.close(), listener.close());
			await Promise.all([listener.close(), listener[Symbol.asyncDispose]()]);
			using rebound = Deno.listen({ hostname: '127.0.0.1', port });
			assert.equal(rebound.addr.port, port);
		} finally {
			await listener.close();
		}
	});

	it('explicit disposal closes a live listener before owner cancellation', async () => {
		const controller = new AbortController();
		const listener = health.open({ port: 0, hostname: '127.0.0.1', signal: controller.signal });
		const port = listener.address!.port;
		await listener[Symbol.asyncDispose]();
		assert.equal(controller.signal.aborted, false);
		controller.abort();
		await listener.close();
		using rebound = Deno.listen({ hostname: '127.0.0.1', port });
		assert.equal(rebound.addr.port, port);
	});

	it('probe protocol refuses other methods and never reflects arbitrary reason payloads', async () => {
		await using listener = health.open({ port: 0, hostname: '127.0.0.1', signal: new AbortController().signal });
		const origin = `http://127.0.0.1:${listener.address!.port}`;
		assert.throws(() => listener.degraded('private-error-payload' as health.DegradedReasonType), (error: unknown) => {
			assert.ok(error instanceof TypeError);
			assert.equal(error.message.includes('private-error-payload'), false);
			return true;
		});
		const wrongMethod = await fetch(`${origin}/live`, {
			method: 'POST',
			body: 'private body',
			signal: AbortSignal.timeout(1_000),
		});
		assert.equal(wrongMethod.status, 405);
		assert.equal(wrongMethod.headers.get('allow'), 'GET');
		assert.equal(await wrongMethod.text(), '');
		const missing = await fetch(`${origin}/missing?private=secret`, { signal: AbortSignal.timeout(1_000) });
		assert.equal(missing.status, 404);
		assert.equal(await missing.text(), '');
		assert.deepEqual(listener.status, { state: 'booting' });
	});

	it('disabled and pre-aborted inputs bind no network', async () => {
		await using disabled = health.open({ signal: new AbortController().signal });
		assert.equal(disabled.address, undefined);
		disabled.ready();
		assert.deepEqual(disabled.status, { state: 'ready' });
		const controller = new AbortController();
		controller.abort();
		await using cancelled = health.open({ port: 0, signal: controller.signal });
		assert.equal(cancelled.address, undefined);
		assert.deepEqual(cancelled.status, { state: 'stopping' });
		for (const port of [-1, 0.5, 65_536, Number.NaN]) {
			assert.throws(() => health.open({ port, signal: controller.signal }), RangeError);
		}
	});

	it('completed polling changes live HTTP readiness through idle success, outage and recovery', async () => {
		await using listener = health.open({ port: 0, hostname: '127.0.0.1', signal: new AbortController().signal });
		const origin = `http://127.0.0.1:${listener.address!.port}`, polled = listener.poller();
		assert.equal((await probe(origin, '/ready')).status, 503);
		polled(true);
		assert.equal((await probe(origin, '/ready')).status, 200);
		polled(false);
		assert.equal((await probe(origin, '/ready')).status, 503);
		assert.equal((await probe(origin, '/live')).status, 200);
		polled(true);
		assert.equal((await probe(origin, '/ready')).status, 200);
	});
});
