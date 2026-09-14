import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as response from '@okikio/http/response';
import * as server from '@okikio/server/http';

test('HTTP host composes middleware, safe errors, HEAD fallback, and body ownership', async () => {
	const observed: string[] = [];
	let cancelled = false;
	const app = server.create({
		routes: [
			server.route('GET', '/accounts/:id', (request) => {
				observed.push(`route:${new URL(request.url).pathname}`);
				return Response.json({ id: new URL(request.url).pathname.split('/').at(-1) });
			}),
			server.route('GET', '/stream', () => new Response(new ReadableStream<Uint8Array>({
				cancel() {
					cancelled = true;
				},
			}))),
			server.route('GET', '/fault', () => {
				throw new Error('database password should not appear in the HTTP response');
			}),
		],
		middleware: [
			server.catchErrors({ onError(error) { observed.push(`error:${error.message}`); } }),
				server.requestId({ header: 'x-request-id', trustIncoming: true }),
			server.securityHeaders(),
		],
	});

	const account = await app.fetch(new Request('https://service.invalid/accounts/acme', {
		headers: { 'x-request-id': 'request-42' },
	}));
	assert.equal(account.status, 200);
	assert.equal(account.headers.get('x-request-id'), 'request-42');
	assert.equal(account.headers.get('x-content-type-options'), 'nosniff');
	assert.deepEqual(await account.json(), { id: 'acme' });

	const head = await app.fetch(new Request('https://service.invalid/stream', { method: 'HEAD' }));
	assert.equal(head.status, 200);
	assert.equal(head.body, null);
	assert.equal(cancelled, true);

	const fault = await app.fetch(new Request('https://service.invalid/fault'));
	assert.equal(fault.status, 500);
	const problem = await fault.json() as Record<string, unknown>;
	assert.equal(problem.title, 'Internal server error');
	assert.equal(JSON.stringify(problem).includes('password'), false);
	assert.ok(observed.includes('error:database password should not appear in the HTTP response'));

	let discarded = false;
	const abandoned = new Response(new ReadableStream<Uint8Array>({
		cancel() {
			discarded = true;
		},
	}));
	await response.discard(abandoned);
	assert.equal(discarded, true);
});
