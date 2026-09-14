import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import { expect } from '@std/expect';
import fc from 'fast-check';

import * as request from '@okikio/http/request';
import * as response from '@okikio/http/response';
import * as server from '@okikio/server/http';

/** Build the repeated-query record used as an independent oracle for URLSearchParams inputs. */
function expectedQuery(entries: readonly (readonly [string, string])[]): Readonly<Record<string, string | readonly string[]>> {
	const grouped = new Map<string, string[]>();
	for (const [key, value] of entries) {
		let values = grouped.get(key);
		if (!values) {
			values = [];
			grouped.set(key, values);
		}
		values.push(value);
	}
	return Object.fromEntries([...grouped].map(([key, values]) => [key, values.length === 1 ? values[0]! : values]));
}

test('HTTP host composes middleware, safe errors, HEAD fallback, and body ownership', async () => {
	const observed: string[] = [];
	let cancelled = false;
	const app = server.create({
		routes: [
			server.route('GET', '/accounts/:id', (input) => {
				observed.push(`route:${new URL(input.url).pathname}`);
				return Response.json({ id: new URL(input.url).pathname.split('/').at(-1) });
			}),
			server.route('GET', '/stream', () => new Response(new ReadableStream<Uint8Array>({
				cancel() {
					cancelled = true;
				},
			}))),
			server.route('GET', '/fault', () => {
				throw new Error('database password should not cross the HTTP surface');
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
	assert.ok(observed.includes('error:database password should not cross the HTTP surface'));

	let discarded = false;
	const abandoned = new Response(new ReadableStream<Uint8Array>({
		cancel() {
			discarded = true;
		},
	}));
	await response.discard(abandoned);
	assert.equal(discarded, true);
});

describe('HTTP request contracts', () => {
	it('preserves generated repeated-query values', () => {
		fc.assert(fc.property(
			fc.array(fc.tuple(fc.string({ maxLength: 20 }), fc.string({ maxLength: 40 })), { maxLength: 30 }),
			(entries) => {
				const parameters = new URLSearchParams();
				for (const [key, value] of entries) parameters.append(key, value);
				expect(request.parseQuery(parameters, {
					maximumQueryParameters: 30,
					maximumParameterLength: 20,
					maximumQueryValueLength: 40,
				})).toEqual(expectedQuery(entries));
			},
		), { numRuns: 500 });
	});

	it('accepts the exact body limit and rejects one byte beyond it', async () => {
		const exact = new Request('https://service.invalid/body', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '1234',
		});
		expect(await request.readBody(exact, { maximumBodyBytes: 4 })).toEqual(new TextEncoder().encode('1234'));

		const tooLarge = new Request('https://service.invalid/body', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '12345',
		});
		await expect(request.readBody(tooLarge, { maximumBodyBytes: 4 })).rejects.toThrow(request.RequestTransportError);
	});

	it('distinguishes malformed Content-Length from an oversized body', async () => {
		const malformed = new Request('https://service.invalid/body', {
			method: 'POST',
			headers: { 'content-length': '4.5' },
			body: '1234',
		});
		try {
			await request.readBody(malformed, { maximumBodyBytes: 4 });
			throw new Error('Expected malformed Content-Length to fail.');
		} catch (error) {
			expect(error).toBeInstanceOf(request.RequestTransportError);
			expect((error as request.RequestTransportError).issues[0]?.code).toBe('invalid-content-length');
		}
	});

	it('does not return a partial body after request cancellation', async () => {
		const controller = new AbortController();
		const body = new ReadableStream<Uint8Array>({
			start(stream) {
				stream.enqueue(new TextEncoder().encode('partial'));
			},
		});
		const input: RequestInit & { duplex: 'half' } = {
			method: 'POST',
			body,
			duplex: 'half',
			signal: controller.signal,
		};
		const reading = request.readBody(new Request('https://service.invalid/body', input));
		await Promise.resolve();
		controller.abort(new Error('caller cancelled'));
		await expect(reading).rejects.toThrow('caller cancelled');
	});
});
