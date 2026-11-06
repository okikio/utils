import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as endpoint from '@okikio/server/endpoint';
import * as middleware from '@okikio/server/middleware';
import * as resilience from '@okikio/capability/resilience';
import * as response from '@okikio/http/response';
import * as webhook from '@okikio/http/webhook';
import * as standardWebhook from '@okikio/http/webhook/standard';
import * as resource from '@okikio/capability/resource';
import * as service from './mod.ts';
import { Message, MessageSchema, schema } from './fixtures/runtime.ts';

describe('service request admission', () => {
	it('rejects oversized bodies before validation while preserving allowed raw request bytes', async () => {
		const RawRequest = schema<Request>((value) => {
			if (!(value instanceof Request)) throw new TypeError('Expected the raw Request.');
			return value;
		});
		const Echo = endpoint.post({
			id: 'runtime.echo',
			path: '/echo',
			raw: RawRequest,
			resiliency: resilience.bodyLimit(4),
			responses: [Message],
		});
		const definition = service.define({ id: 'echo', path: '/', endpoints: [Echo] });
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(Echo, async ({ input }) =>
					response.create(Message, {
						message: await input.raw.text(),
					}))],
				resources: resource.implementations(),
			})),
			{ host: Object.freeze({}) },
		);

		const allowed = await runtime.fetch(new Request('http://localhost/echo', { method: 'POST', body: '1234' }));
		expect(allowed.status).toBe(200);
		expect(await allowed.json()).toEqual({ message: '1234' });
		const rejected = await runtime.fetch(new Request('http://localhost/echo', { method: 'POST', body: '12345' }));
		expect(rejected.status).toBe(413);
	});

	it('rejects malformed Content-Length as an invalid request before validation', async () => {
		const RawRequest = schema<Request>((value) => {
			if (!(value instanceof Request)) throw new TypeError('Expected the raw Request.');
			return value;
		});
		const Echo = endpoint.post({
			id: 'runtime.invalid-content-length',
			path: '/invalid-content-length',
			raw: RawRequest,
			resiliency: resilience.bodyLimit(16),
			responses: [Message],
		});
		const definition = service.define({ id: 'invalid-content-length', path: '/', endpoints: [Echo] });
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(Echo, () => response.create(Message, { message: 'unexpected' }))],
				resources: resource.implementations(),
			})),
			{ host: Object.freeze({}) },
		);
		const result = await runtime.fetch(
			new Request('http://localhost/invalid-content-length', {
				method: 'POST',
				headers: { 'content-length': 'not-a-number' },
				body: '1234',
			}),
		);
		expect(result.status).toBe(400);
		expect((await result.json() as { type: string }).type).toBe('urn:utils:server:invalid-request');
	});

	it('propagates caller cancellation during bounded body reads without invoking the handler', async () => {
		const RawRequest = schema<Request>((value) => {
			if (!(value instanceof Request)) throw new TypeError('Expected the raw Request.');
			return value;
		});
		const Echo = endpoint.post({
			id: 'runtime.cancelled-body',
			path: '/cancelled-body',
			raw: RawRequest,
			resiliency: resilience.bodyLimit(16),
			responses: [Message],
		});
		let handlerCalls = 0;
		const definition = service.define({ id: 'cancelled-body', path: '/', endpoints: [Echo] });
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(Echo, () => {
					handlerCalls += 1;
					return response.create(Message, { message: 'unexpected' });
				})],
				resources: resource.implementations(),
			})),
			{ host: Object.freeze({}) },
		);

		const controller = new AbortController();
		const body = new ReadableStream<Uint8Array>({
			start(stream) {
				stream.enqueue(new TextEncoder().encode('12'));
			},
		});
		const request = new Request(
			'http://localhost/cancelled-body',
			{
				method: 'POST',
				body,
				signal: controller.signal,
				duplex: 'half',
			} as RequestInit & { duplex: 'half' },
		);
		const pending = runtime.fetch(request);
		await Promise.resolve();
		const reason = new DOMException('Caller cancelled the request.', 'AbortError');
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		expect(handlerCalls).toBe(0);
	});

	it('authenticates exact webhook bytes before ordinary JSON parsing and validation', async () => {
		const VerifyWebhook = middleware.define({
			id: 'runtime.verify-webhook',
			description: 'Verify exact webhook bytes.',
		});
		const protocol = standardWebhook.create({ secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw' });
		const Receive = endpoint.post({
			id: 'runtime.webhook',
			path: '/webhook',
			json: MessageSchema,
			responses: [Message],
			middleware: [middleware.beforeValidation(VerifyWebhook)],
		});
		const definition = service.define({ id: 'webhook-runtime', path: '/', endpoints: [Receive] });
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(Receive, async ({ input }) => response.create(Message, input.json))],
				middleware: [middleware.handler(VerifyWebhook, async ({ request }, next) => {
					const verified = await webhook.verifyRequest(request, protocol, { now: new Date(1_000_000) });
					if (!verified.ok) throw new Error(`webhook rejected: ${verified.code}`);
					return await next();
				})],
				resources: resource.implementations(),
			})),
			{ host: Object.freeze({}) },
		);
		const body = '{"message":"signed"}';
		const headers = await protocol.sign({ id: 'evt_signed', timestamp: 1000, body });
		const result = await runtime.fetch(
			new Request('http://localhost/webhook', {
				method: 'POST',
				headers: { ...headers, 'Content-Type': 'application/json' },
				body,
			}),
		);
		expect(result.status).toBe(200);
		expect(await result.json()).toEqual({ message: 'signed' });
	});
});
