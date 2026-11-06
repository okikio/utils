import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';
import * as resource from '@okikio/capability/resource';
import * as service from './mod.ts';
import { Message, MessageSchema } from './fixtures/runtime.ts';

describe('service private failures and lifecycle observation', () => {
	it('keeps unexpected body-reader diagnostics private while preserving client input failures', async () => {
		const Import = endpoint.post({
			id: 'runtime.private-reader',
			path: '/imports',
			json: MessageSchema,
			responses: [Message],
		});
		const Failures = service.observer.define({
			id: 'runtime.private-reader.failures',
			description: 'Observe internal body-reader faults.',
			events: ['failed'],
		});
		const definition = service.define({
			id: 'private-reader',
			path: '/',
			endpoints: [Import],
			observers: [Failures],
		});
		const failures: service.ServiceObserverEvent[] = [];
		let handled = 0;
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(Import, ({ input }) => {
					handled += 1;
					return response.create(Message, input.json);
				})],
				resources: resource.implementations(),
			})),
			{
				host: {},
				observers: [service.observer.handler(Failures, (event) => {
					failures.push(event);
				})],
			},
		);
		const reason = new Error('Private provider credential: fixture-secret-492.');
		reason.name = 'StorageReadFailure';
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(reason);
			},
		});
		const failed = await runtime.fetch(
			new Request(
				'https://service.invalid/imports',
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body,
					duplex: 'half',
				} as RequestInit & { duplex: 'half' },
			),
		);
		expect(failed.status).toBe(500);
		const text = await failed.text();
		expect(JSON.parse(text)).toMatchObject({ type: 'urn:utils:server:internal', status: 500 });
		expect(text).not.toContain('fixture-secret-492');
		expect(text).not.toContain('StorageReadFailure');
		expect(text).not.toContain('Private provider credential');
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			kind: 'failed',
			endpointId: 'runtime.private-reader',
			error: { name: 'StorageReadFailure', message: 'Private provider credential: fixture-secret-492.' },
		});

		for (
			const value of [
				{ contentType: 'application/json', body: '{', status: 400, type: 'urn:utils:server:invalid-request' },
				{ contentType: 'text/plain', body: 'message', status: 415, type: 'urn:utils:server:unsupported-media-type' },
				{ contentType: 'application/json', body: '{}', status: 400, type: 'urn:utils:server:invalid-request' },
			]
		) {
			const rejected = await runtime.fetch(
				new Request('https://service.invalid/imports', {
					method: 'POST',
					headers: { 'content-type': value.contentType },
					body: value.body,
				}),
			);
			expect(rejected.status).toBe(value.status);
			expect(await rejected.json()).toMatchObject({ type: value.type, status: value.status });
		}
		expect(handled).toBe(0);
		expect(failures).toHaveLength(1);
	});

	it('does not let an arbitrary Error.code become a public protocol problem identity', async () => {
		class CodedError extends Error {
			readonly code = 'USER_CONTROLLED';
		}
		const Fail = endpoint.get({ id: 'runtime.coded-error', path: '/coded-error', responses: [Message] });
		const definition = service.define({ id: 'coded-error-runtime', path: '/', endpoints: [Fail] });
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(Fail, async () => {
					throw new CodedError('private implementation message');
				})],
				resources: resource.implementations(),
			})),
			{ host: Object.freeze({}) },
		);
		const result = await runtime.fetch(new Request('http://localhost/coded-error'));
		expect(result.status).toBe(500);
		const text = await result.text();
		expect(text).not.toContain('USER_CONTROLLED');
		expect(text).not.toContain('private implementation message');
		expect(text).toContain('urn:utils:server:internal');
	});

	it('emits exact request lifecycle events and requires observer handlers by identity', async () => {
		const Read = endpoint.get({ id: 'runtime.observed', path: '/observed', responses: [Message] });
		const Diagnostics = service.observer.define({
			id: 'runtime.request-diagnostics',
			description: 'Observe request lifecycle.',
		});
		const definition = service.define({ id: 'observed', path: '/api', endpoints: [Read], observers: [Diagnostics] });
		const compiled = service.compile(service.implement(definition, {
			endpoints: [endpoint.handler(Read, async () => response.create(Message, { message: 'observed' }))],
			resources: resource.implementations(),
		}));
		expect(() => service.create(compiled, { host: Object.freeze({}) })).toThrow(
			service.ServiceRuntimeConfigurationError,
		);

		const events: service.ServiceObserverEvent[] = [];
		let complete!: () => void;
		const completed = new Promise<void>((resolve) => complete = resolve);
		await using runtime = service.create(compiled, {
			host: Object.freeze({}),
			requestId: () => 'request_observed_1',
			traceId: () => '11111111111111111111111111111111',
			observers: [service.observer.handler(Diagnostics, (event) => {
				events.push(event);
				if (event.kind === 'completed') complete();
			})],
		});
		const result = await runtime.fetch(new Request('http://localhost/api/observed'));
		expect(result.status).toBe(200);
		expect(await result.json()).toEqual({ message: 'observed' });
		await completed;
		expect(events.map((event) => event.kind)).toEqual(['started', 'response', 'completed']);
		expect(events[0]).toMatchObject({
			serviceId: 'observed',
			requestId: 'request_observed_1',
			traceId: '11111111111111111111111111111111',
			method: 'GET',
			path: '/api/observed',
			endpointId: Read.id,
			operationId: Read.operations[0]!.operationId,
		});
		expect(events[2]).toMatchObject({
			status: 200,
			responseBytes: 22,
			completion: { outcome: 'completed', bytes: 22 },
		});
	});

	it('converts request setup failures to the safe internal problem and reports them observationally', async () => {
		const Ping = endpoint.get({ id: 'runtime.setup-failure', path: '/ping', responses: [Message] });
		const Diagnostics = service.observer.define({
			id: 'runtime.setup-diagnostics',
			description: 'Observe setup failures.',
			events: ['failed'],
		});
		const definition = service.define({
			id: 'setup-failure',
			path: '/api',
			endpoints: [Ping],
			observers: [Diagnostics],
		});
		const observed: service.ServiceObserverEvent[] = [];
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(Ping, async () => response.create(Message, { message: 'pong' }))],
				resources: resource.implementations(),
			})),
			{
				host: Object.freeze({}),
				requestId() {
					throw new Error('request id failed');
				},
				observers: [service.observer.handler(Diagnostics, (event) => {
					observed.push(event);
				})],
			},
		);

		const result = await runtime.fetch(new Request('http://localhost/api/ping'));
		expect(result.status).toBe(500);
		expect(result.headers.get('content-type')).toContain('application/problem+json');
		expect(result.headers.get('x-request-id')).toBeNull();
		expect(observed).toHaveLength(1);
		expect(observed[0]).toMatchObject({
			kind: 'failed',
			serviceId: 'setup-failure',
			endpointId: Ping.id,
			error: { name: 'Error', message: 'request id failed' },
		});
	});

	it('preserves established request correlation when later setup fails', async () => {
		const Ping = endpoint.get({ id: 'runtime.trace-failure', path: '/ping', responses: [Message] });
		const Diagnostics = service.observer.define({
			id: 'runtime.trace-diagnostics',
			description: 'Observe trace setup failures.',
			events: ['failed'],
		});
		const definition = service.define({
			id: 'trace-failure',
			path: '/api',
			endpoints: [Ping],
			observers: [Diagnostics],
		});
		const observed: service.ServiceObserverEvent[] = [];
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(Ping, async () => response.create(Message, { message: 'pong' }))],
				resources: resource.implementations(),
			})),
			{
				host: Object.freeze({}),
				requestId: () => 'request_setup_123',
				traceId() {
					throw new Error('trace id failed');
				},
				observers: [service.observer.handler(Diagnostics, (event) => {
					observed.push(event);
				})],
			},
		);

		const result = await runtime.fetch(new Request('http://localhost/api/ping'));
		expect(result.status).toBe(500);
		expect(result.headers.get('x-request-id')).toBe('request_setup_123');
		expect(observed[0]).toMatchObject({
			kind: 'failed',
			requestId: 'request_setup_123',
			error: { name: 'Error', message: 'trace id failed' },
		});
	});
});
