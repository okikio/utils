import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as endpoint from '@okikio/server/endpoint';
import * as effect from '@okikio/effect';
import * as middleware from '@okikio/server/middleware';
import * as query from '@okikio/query';
import * as resilience from '@okikio/resilience';
import * as response from '@okikio/http/response';
import * as webhook from '@okikio/http/webhook';
import * as standardWebhook from '@okikio/http/webhook/standard';
import * as resource from '@okikio/resource';
import * as permissions from '@okikio/permission';
import * as service from './mod.ts';

function schema<Output>(
	validate: (value: unknown) => Output,
): StandardSchemaV1<unknown, Output> {
	return Object.freeze({
		'~standard': Object.freeze({
			version: 1,
			vendor: 'test',
			validate(value: unknown) {
				try {
					return { value: validate(value) };
				} catch (error) {
					return { issues: [{ message: error instanceof Error ? error.message : String(error) }] };
				}
			},
		}),
	});
}

const MessageSchema = schema<{ readonly message: string }>((value) => {
	if (typeof value !== 'object' || value === null || typeof (value as { message?: unknown }).message !== 'string') {
		throw new TypeError('Expected a message object.');
	}
	return Object.freeze({ message: (value as { message: string }).message });
});
const Message = response.ok(MessageSchema, {
	id: 'runtime:message',
	description: 'Runtime test response.',
});

describe('service runtime', () => {
	it('preserves middleware onion ordering around authentication, validation, request values, and handlers', async () => {
		const events: string[] = [];
		const Query = schema<Readonly<{ readonly value: string }>>((value) => {
			events.push('validation');
			if (typeof value !== 'object' || value === null || (value as { value?: unknown }).value !== 'ok') {
				throw new TypeError('Expected value=ok.');
			}
			return Object.freeze({ value: 'ok' });
		});
		const ReadRuntime = permissions.define({ id: 'runtime:read' });
		const ReadRuntimeRequirement = permissions.require(ReadRuntime);
		const authentication = Object.freeze({ id: 'runtime:session', kind: 'authentication' });
		const WholeRequest = middleware.define({ id: 'runtime.wholeRequest', description: 'Surround the complete application request pipeline.' });
		const BeforeValidation = middleware.define({ id: 'runtime.before-validation', description: 'Before validation.' });
		const AfterValidation = middleware.define({ id: 'runtime.after-validation', description: 'After validation.' });
		const AroundOperation = middleware.define({ id: 'runtime.around-handler', description: 'Around handler.' });
		const trace = (name: string, definition: middleware.MiddlewareDefinition) => middleware.handler(
			definition,
			async (_context, next) => {
				events.push(`${name}:before`);
				const result = await next();
				events.push(`${name}:after`);
				return result;
			},
		);
		const Read = endpoint.get({
			id: 'runtime.read',
			path: '/runtime',
			query: Query,
			authentication,
			requirements: [ReadRuntimeRequirement],
			responses: [Message],
		});
		const definition = service.define({
			id: 'runtime',
			path: '/api',
			middleware: [
				middleware.wholeRequest(WholeRequest),
				middleware.beforeValidation(BeforeValidation),
				middleware.afterValidation(AfterValidation),
				middleware.aroundOperation(AroundOperation),
			],
			endpoints: [Read],
		});
		const implementation = service.implement(definition, {
			endpoints: [endpoint.handler(Read, async () => {
				events.push('handler');
				return response.create(Message, { message: 'ok' });
			})],
			middleware: [
				trace('wholeRequest', WholeRequest),
				trace('before-validation', BeforeValidation),
				trace('after-validation', AfterValidation),
				trace('around-handler', AroundOperation),
			],
			resources: resource.implementations(),
		});
		await using runtime = service.create(service.compile(implementation), {
			host: Object.freeze({}),
			adapters: {
				authenticate: async () => {
					events.push('authentication');
					return Object.freeze({ authentication: Object.freeze({ id: 'session' }) });
				},
				requirements: {
					interpreters: {
						permission: permissions.interpreter({
							maximumChecks: 8,
							async check(_ctx, requests) {
								expect(requests).toHaveLength(1);
								expect(requests[0]?.definition).toBe(ReadRuntime);
								events.push('permission');
								return requests.map(() => Object.freeze({ allowed: true as const }));
							},
						}),
					},
					unknown: 'reject',
				},
			},
		});
		const result = await runtime.fetch(new Request('http://localhost/api/runtime?value=ok'));
		expect(result.status).toBe(200);
		expect(events).toEqual([
			'wholeRequest:before',
			'before-validation:before',
			'authentication',
			'validation',
			'after-validation:before',
			'permission',
			'around-handler:before',
			'handler',
			'around-handler:after',
			'after-validation:after',
			'before-validation:after',
			'wholeRequest:after',
		]);
	});

	it('scopes declared effects without requiring an emitter before an announcement occurs', async () => {
		const Committed = effect.define({
			id: 'runtime.committed',
			description: 'The runtime operation committed one required consequence.',
			value: MessageSchema,
		});
		const Read = endpoint.get({
			id: 'runtime.effects',
			path: '/effects',
			effects: [Committed],
			responses: [Message],
		});
		const definition = service.define({ id: 'effects', path: '/api', endpoints: [Read] });
		const implementation = service.implement(definition, {
			endpoints: [endpoint.handler(Read, async ({ ctx }) => {
				await effect.emit(ctx, Committed, { message: 'accepted' }, { key: 'runtime-effects' });
				return response.create(Message, { message: 'ok' });
			})],
			resources: resource.implementations(),
		});
		const compiled = service.compile(implementation);
		{
			await using unowned = service.create(compiled, { host: Object.freeze({}) });
			expect(unowned.routes).toHaveLength(1);
		}

		const accepted: effect.EffectOccurrence[] = [];
		await using runtime = service.create(compiled, {
			host: Object.freeze({}),
			adapters: {
				effect: {
					async emit(_ctx, occurrence) {
						accepted.push(occurrence);
					},
				},
			},
		});
		const result = await runtime.fetch(new Request('http://localhost/api/effects'));
		expect(result.status).toBe(200);
		expect(accepted).toHaveLength(1);
		expect(accepted[0]?.definition).toBe(Committed);
		expect(accepted[0]?.key).toBe('runtime-effects');
	});

	it('propagates custom request values from authentication to endpoint handlers', async () => {
		interface IdentityValues extends endpoint.EndpointRequestValues {
			readonly session?: Readonly<{ readonly id: string }>;
			readonly membership?: Readonly<{ readonly id: string }>;
		}

		const authentication = Object.freeze({ id: 'runtime:identity-session', kind: 'authentication' });
		const Read = endpoint.get({
			id: 'runtime.values',
			path: '/values',
			authentication,
			responses: [Message],
		});
		const definition = service.define({ id: 'values', path: '/api', endpoints: [Read] });
		const implementation = service.implement(definition, {
			endpoints: [endpoint.handler<typeof Read, endpoint.EmptyEndpointHost, IdentityValues>(
				Read,
				async ({ session, membership }) => {
					expect(session).toEqual({ id: 'session-1' });
					expect(membership).toEqual({ id: 'membership-1' });
					return response.create(Message, { message: `${session?.id}:${membership?.id}` });
				},
			)],
			resources: resource.implementations(),
		});
		await using runtime = service.create<endpoint.EmptyEndpointHost, IdentityValues>(service.compile(implementation), {
			host: Object.freeze({}),
			adapters: {
				authenticate: async () => Object.freeze({
					session: Object.freeze({ id: 'session-1' }),
					membership: Object.freeze({ id: 'membership-1' }),
				}),
			},
		});

		const result = await runtime.fetch(new Request('http://localhost/api/values'));
		expect(result.status).toBe(200);
		expect(await result.json()).toEqual({ message: 'session-1:membership-1' });
	});

	it('rejects an active unconfigured requirement family unless the host explicitly ignores it', async () => {
		const Optional = permissions.define({ id: 'runtime:optional' });
		const OptionalRequirement = permissions.require(Optional);
		const Read = endpoint.get({
			id: 'runtime.optional-requirement',
			path: '/optional-requirement',
			requirements: [OptionalRequirement],
			responses: [Message],
		});
		const definition = service.define({ id: 'runtime-optional', path: '/', endpoints: [Read] });
		const compiled = service.compile(service.implement(definition, {
		endpoints: [endpoint.handler(Read, async () => {
				return response.create(Message, { message: 'ok' });
			})],
			resources: resource.implementations(),
		}));
		expect(compiled.operations[0]?.requirements).toEqual([OptionalRequirement]);
		expect(() => service.create(compiled, { host: Object.freeze({}) })).toThrow(service.ServiceRuntimeConfigurationError);

		await using runtime = service.create(compiled, {
			host: Object.freeze({}),
			adapters: { requirements: { interpreters: Object.freeze({}), unknown: 'ignore' } },
		});
		const result = await runtime.fetch(new Request('http://localhost/optional-requirement'));
		expect(result.status).toBe(200);
	});

	it('keeps a target-bearing permission reachable until the handler activates one concrete check', async () => {
		const AssetTargetSchema = schema<{ readonly assetId: string }>((value) => {
			if (typeof value !== 'object' || value === null || typeof (value as { assetId?: unknown }).assetId !== 'string') {
				throw new TypeError('Expected assetId.');
			}
			return Object.freeze({ assetId: (value as { assetId: string }).assetId });
		});
		const ReadAsset = permissions.define({ id: 'asset:read', target: AssetTargetSchema });
		const checks: readonly permissions.PermissionRequest[][] = [];
		const checker: permissions.PermissionChecker = {
			maximumChecks: 32,
			async check(_ctx, requests) {
				(checks as permissions.PermissionRequest[][]).push([...requests]);
				return requests.map(() => Object.freeze({ allowed: true as const }));
			},
		};
		const Read = endpoint.get({
			id: 'runtime.dynamic-permission',
			path: '/asset',
			requirements: [permissions.require(ReadAsset)],
			responses: [Message],
		});
		const definition = service.define({ id: 'runtime-dynamic-permission', path: '/', endpoints: [Read] });
		const compiled = service.compile(service.implement(definition, {
			endpoints: [endpoint.handler(Read, async ({ ctx }) => {
				expect(checks).toHaveLength(0);
				expect(await permissions.check(ctx, ReadAsset, { assetId: 'asset-42' })).toBe(true);
				return response.create(Message, { message: 'ok' });
			})],
			resources: resource.implementations(),
		}));

		await using runtime = service.create(compiled, {
			host: Object.freeze({}),
			adapters: {
				requirements: {
					interpreters: { permission: permissions.interpreter(checker) },
					unknown: 'reject',
				},
			},
		});
		const result = await runtime.fetch(new Request('http://localhost/asset'));
		expect(result.status).toBe(200);
		expect(checks).toHaveLength(1);
		expect(checks[0]?.[0]).toMatchObject({ definition: ReadAsset, target: { assetId: 'asset-42' } });
	});

	it('actively enforces deadlines even when a handler does not poll the signal', async () => {
		const Slow = endpoint.get({
			id: 'runtime.slow',
			path: '/slow',
			resiliency: resilience.timeout({ milliseconds: 5 }),
			responses: [Message],
		});
		const definition = service.define({ id: 'slow', path: '/', endpoints: [Slow] });
		await using runtime = service.create(service.compile(service.implement(definition, {
			endpoints: [endpoint.handler(Slow, async () => {
				await new Promise<never>(() => {});
				return response.create(Message, { message: 'late' });
			})],
			resources: resource.implementations(),
		})), { host: Object.freeze({}) });
		const result = await runtime.fetch(new Request('http://localhost/slow'));
		expect(result.status).toBe(504);
		expect((await result.json() as { type: string }).type).toBe('urn:utils:server:deadline-exceeded');
	});

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
		await using runtime = service.create(service.compile(service.implement(definition, {
			endpoints: [endpoint.handler(Echo, async ({ input }) => response.create(Message, {
				message: await input.raw.text(),
			}))],
			resources: resource.implementations(),
		})), { host: Object.freeze({}) });

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
		await using runtime = service.create(service.compile(service.implement(definition, {
			endpoints: [endpoint.handler(Echo, () => response.create(Message, { message: 'unexpected' }))],
			resources: resource.implementations(),
		})), { host: Object.freeze({}) });
		const result = await runtime.fetch(new Request('http://localhost/invalid-content-length', {
			method: 'POST',
			headers: { 'content-length': 'not-a-number' },
			body: '1234',
		}));
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
		await using runtime = service.create(service.compile(service.implement(definition, {
			endpoints: [endpoint.handler(Echo, () => {
				handlerCalls += 1;
				return response.create(Message, { message: 'unexpected' });
			})],
			resources: resource.implementations(),
		})), { host: Object.freeze({}) });

		const controller = new AbortController();
		const body = new ReadableStream<Uint8Array>({
			start(stream) { stream.enqueue(new TextEncoder().encode('12')); },
		});
		const request = new Request('http://localhost/cancelled-body', {
			method: 'POST',
			body,
			signal: controller.signal,
			duplex: 'half',
		} as RequestInit & { duplex: 'half' });
		const pending = runtime.fetch(request);
		await Promise.resolve();
		const reason = new DOMException('Caller cancelled the request.', 'AbortError');
		controller.abort(reason);

		await expect(pending).rejects.toBe(reason);
		expect(handlerCalls).toBe(0);
	});

	it('materializes automatic pagination links with query-defined parameter names', async () => {
		const PageQuery = query.define({
			fields: { id: query.field(schema<string>((value) => String(value)), { sortable: true }) },
			order: [query.asc('id', { tiebreaker: true })],
			pagination: query.cursor({ parameters: { cursor: 'after', limit: 'size' }, defaultLimit: 2 }),
		});
		const Page = response.paginated(MessageSchema, {
			id: 'runtime:page',
			description: 'Runtime paginated response.',
		});
		const List = endpoint.get({
			id: 'runtime.list',
			path: '/pages',
			query: PageQuery,
			responses: [Page],
		});
		const definition = service.define({ id: 'pages', path: '/', endpoints: [List] });
		await using runtime = service.create(service.compile(service.implement(definition, {
			endpoints: [endpoint.handler(List, async ({ input }) => {
				if (input.query.pagination.kind !== 'cursor') throw new TypeError('Expected cursor pagination.');
				return response.create(Page, {
				kind: 'cursor',
				items: [{ message: 'first' }],
				...(input.query.pagination.cursor !== undefined
					? { cursor: input.query.pagination.cursor }
					: {}),
				limit: input.query.pagination.limit,
				hasMore: true,
				nextCursor: 'next-page',
				});
			})],
			resources: resource.implementations(),
		})), { host: Object.freeze({}) });

		const result = await runtime.fetch(new Request('http://localhost/pages?after=current&size=2'));
		expect(result.status).toBe(200);
		expect(result.headers.get('link')).toContain('after=next-page');
		expect(result.headers.get('link')).toContain('size=2');
		expect(await result.json()).toMatchObject({
			data: [{ message: 'first' }],
			links: {
				self: 'http://localhost/pages?after=current&size=2',
				next: 'http://localhost/pages?after=next-page&size=2',
			},
		});
	});

	it('preserves repeated response fields through native Response materialization', async () => {
		const Cookies = endpoint.get({ id: 'runtime.cookies', path: '/cookies', responses: [Message] });
		const definition = service.define({ id: 'cookies', path: '/', endpoints: [Cookies] });
		await using runtime = service.create(service.compile(service.implement(definition, {
			endpoints: [endpoint.handler(Cookies, async () => response.create(Message, { message: 'ok' }, {
				headers: [
					['Set-Cookie', 'access=one; Path=/; HttpOnly'],
					['Set-Cookie', 'refresh=two; Path=/; HttpOnly'],
				],
			}))],
			resources: resource.implementations(),
		})), { host: Object.freeze({}) });

		const result = await runtime.fetch(new Request('http://localhost/cookies'));
		const cookies = (result.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
		expect(cookies).toEqual([
			'access=one; Path=/; HttpOnly',
			'refresh=two; Path=/; HttpOnly',
		]);
	});


	it('honors declared conditional responses without hiding an undeclared 304', async () => {
		const Cached = response.ok(MessageSchema, { id: 'runtime.cached', description: 'Cached message.' });
		const NotModified = response.notModified({ id: 'runtime.not-modified' });
		const Read = endpoint.get({ id: 'runtime.read-cached', path: '/cached', responses: [Cached, NotModified] });
		const definition = service.define({ id: 'cached', path: '/', endpoints: [Read] });
		await using runtime = service.create(service.compile(service.implement(definition, {
			endpoints: [endpoint.handler(Read, async () => response.create(Cached, { message: 'cached' }, {
				headers: { ETag: '"version-1"', 'Cache-Control': 'private, max-age=0' },
			}))],
			resources: resource.implementations(),
		})), { host: Object.freeze({}) });
		const result = await runtime.fetch(new Request('http://localhost/cached', {
			headers: { 'If-None-Match': 'W/"version-1"' },
		}));
		expect(result.status).toBe(304);
		expect(result.headers.get('etag')).toBe('"version-1"');
		expect(await result.text()).toBe('');
	});

	it('returns declared 406 and 415 problems for representation negotiation failures', async () => {
		const Create = endpoint.post({ id: 'runtime.create-json', path: '/json', json: MessageSchema, responses: [Message] });
		const definition = service.define({ id: 'formats', path: '/', endpoints: [Create] });
		await using runtime = service.create(service.compile(service.implement(definition, {
			endpoints: [endpoint.handler(Create, async ({ input }) => response.create(Message, input.json))],
			resources: resource.implementations(),
		})), { host: Object.freeze({}) });
		const unsupported = await runtime.fetch(new Request('http://localhost/json', {
			method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hello',
		}));
		expect(unsupported.status).toBe(415);
		const missing = await runtime.fetch(new Request('http://localhost/json', {
			method: 'POST', body: new Uint8Array(new TextEncoder().encode('{\"message\":\"hello\"}')),
		}));
		expect(missing.status).toBe(415);
		const structured = await runtime.fetch(new Request('http://localhost/json', {
			method: 'POST', headers: { 'Content-Type': 'application/vnd.kaiju+json', Accept: 'application/json' }, body: '{\"message\":\"hello\"}',
		}));
		expect(structured.status).toBe(200);
		expect(structured.headers.get('vary')).toBe('Accept');
		const unacceptable = await runtime.fetch(new Request('http://localhost/json', {
			method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/xml' }, body: '{"message":"hello"}',
		}));
		expect(unacceptable.status).toBe(406);
		expect(unacceptable.headers.get('content-type')).toContain('application/problem+json');
		expect(unacceptable.headers.get('vary')).toBe('Accept');
	});

	it('authenticates exact webhook bytes before ordinary JSON parsing and validation', async () => {
		const VerifyWebhook = middleware.define({ id: 'runtime.verify-webhook', description: 'Verify exact webhook bytes.' });
		const protocol = standardWebhook.create({ secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw' });
		const Receive = endpoint.post({ id: 'runtime.webhook', path: '/webhook', json: MessageSchema, responses: [Message], middleware: [middleware.beforeValidation(VerifyWebhook)] });
		const definition = service.define({ id: 'webhook-runtime', path: '/', endpoints: [Receive] });
		await using runtime = service.create(service.compile(service.implement(definition, {
			endpoints: [endpoint.handler(Receive, async ({ input }) => response.create(Message, input.json))],
			middleware: [middleware.handler(VerifyWebhook, async ({ request }, next) => {
				const verified = await webhook.verifyRequest(request, protocol, { now: new Date(1_000_000) });
				if (!verified.ok) throw new Error(`webhook rejected: ${verified.code}`);
				return await next();
			})],
			resources: resource.implementations(),
		})), { host: Object.freeze({}) });
		const body = '{\"message\":\"signed\"}';
		const headers = await protocol.sign({ id: 'evt_signed', timestamp: 1000, body });
		const result = await runtime.fetch(new Request('http://localhost/webhook', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body }));
		expect(result.status).toBe(200);
		expect(await result.json()).toEqual({ message: 'signed' });
	});

	it('encodes consecutive async-iterable text chunks as Web Response bytes without dropping yields', async () => {
		const Html = response.html({ id: 'runtime:stream-html', description: 'Streaming HTML.' });
		const Stream = endpoint.get({ id: 'runtime.stream-html', path: '/stream-html', responses: [Html] });
		async function* content() { yield 'one'; yield 'two'; yield 'three'; }
		const definition = service.define({ id: 'stream-html-runtime', path: '/', endpoints: [Stream] });
		await using runtime = service.create(service.compile(service.implement(definition, {
			endpoints: [endpoint.handler(Stream, async () => response.create(Html, content()))],
			resources: resource.implementations(),
		})), { host: Object.freeze({}) });
		const result = await runtime.fetch(new Request('http://localhost/stream-html'));
		expect(result.status).toBe(200);
		expect(await result.text()).toBe('onetwothree');
	});

	it('does not let an arbitrary Error.code become a public protocol problem identity', async () => {
		class CodedError extends Error { readonly code = 'USER_CONTROLLED'; }
		const Fail = endpoint.get({ id: 'runtime.coded-error', path: '/coded-error', responses: [Message] });
		const definition = service.define({ id: 'coded-error-runtime', path: '/', endpoints: [Fail] });
		await using runtime = service.create(service.compile(service.implement(definition, {
			endpoints: [endpoint.handler(Fail, async () => { throw new CodedError('private implementation message'); })],
			resources: resource.implementations(),
		})), { host: Object.freeze({}) });
		const result = await runtime.fetch(new Request('http://localhost/coded-error'));
		expect(result.status).toBe(500);
		const text = await result.text();
		expect(text).not.toContain('USER_CONTROLLED');
		expect(text).not.toContain('private implementation message');
		expect(text).toContain('urn:utils:server:internal');
	});

	it('fails closed for adapter-owned resilience and invokes an explicit supporting adapter', async () => {
		const Reliable = endpoint.post({
			id: 'runtime.reliable',
			path: '/reliable',
			json: MessageSchema,
			resiliency: [
				resilience.idempotent(),
				resilience.retry({ maximumAttempts: 2, jitter: false }),
			],
			responses: [Message],
		});
		const definition = service.define({ id: 'reliable', path: '/', endpoints: [Reliable] });
		const compiled = service.compile(service.implement(definition, {
			endpoints: [endpoint.handler(Reliable, async ({ input }) => response.create(Message, input.json))],
			resources: resource.implementations(),
		}));
		expect(() => service.create(compiled, { host: Object.freeze({}) })).toThrow(service.ServiceRuntimeConfigurationError);

		const observed: string[] = [];
		await using runtime = service.create(compiled, {
			host: Object.freeze({}),
			adapters: {
				resilience: {
					supports: () => true,
					async run(policies, state, next) {
						observed.push(...policies.map((policy) => policy.type));
						expect(state.input.json).toEqual({ message: 'safe retry' });
						return await next();
					},
				},
			},
		});
		const result = await runtime.fetch(new Request('http://localhost/reliable', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'operation-1' },
			body: '{"message":"safe retry"}',
		}));
		expect(result.status).toBe(200);
		expect(observed).toEqual(['idempotency', 'retry']);
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
		expect(() => service.create(compiled, { host: Object.freeze({}) })).toThrow(service.ServiceRuntimeConfigurationError);

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
		expect(events[2]).toMatchObject({ status: 200, responseBytes: 22, completion: { outcome: 'completed', bytes: 22 } });
	});

	it('converts request setup failures to the safe internal problem and reports them observationally', async () => {
		const Ping = endpoint.get({ id: 'runtime.setup-failure', path: '/ping', responses: [Message] });
		const Diagnostics = service.observer.define({
			id: 'runtime.setup-diagnostics',
			description: 'Observe setup failures.',
			events: ['failed'],
		});
		const definition = service.define({ id: 'setup-failure', path: '/api', endpoints: [Ping], observers: [Diagnostics] });
		const observed: service.ServiceObserverEvent[] = [];
		await using runtime = service.create(service.compile(service.implement(definition, {
			endpoints: [endpoint.handler(Ping, async () => response.create(Message, { message: 'pong' }))],
			resources: resource.implementations(),
		})), {
			host: Object.freeze({}),
			requestId() {
				throw new Error('request id failed');
			},
			observers: [service.observer.handler(Diagnostics, (event) => { observed.push(event); })],
		});

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
		const definition = service.define({ id: 'trace-failure', path: '/api', endpoints: [Ping], observers: [Diagnostics] });
		const observed: service.ServiceObserverEvent[] = [];
		await using runtime = service.create(service.compile(service.implement(definition, {
			endpoints: [endpoint.handler(Ping, async () => response.create(Message, { message: 'pong' }))],
			resources: resource.implementations(),
		})), {
			host: Object.freeze({}),
			requestId: () => 'request_setup_123',
			traceId() {
				throw new Error('trace id failed');
			},
			observers: [service.observer.handler(Diagnostics, (event) => { observed.push(event); })],
		});

		const result = await runtime.fetch(new Request('http://localhost/api/ping'));
		expect(result.status).toBe(500);
		expect(result.headers.get('x-request-id')).toBe('request_setup_123');
		expect(observed[0]).toMatchObject({
			kind: 'failed',
			requestId: 'request_setup_123',
			error: { name: 'Error', message: 'trace id failed' },
		});
	});

	it('exposes exact routes and returns the framework not-found problem outside them', async () => {
		const Ping = endpoint.get({ id: 'runtime.route', path: '/ping', responses: [Message] });
		const definition = service.define({ id: 'route', path: '/api', endpoints: [Ping] });
		await using runtime = service.create(service.compile(service.implement(definition, {
			endpoints: [endpoint.handler(Ping, async () => response.create(Message, { message: 'pong' }))],
			resources: resource.implementations(),
		})), { host: Object.freeze({}) });

		expect(runtime.routes.map(({ method, path }) => ({ method, path }))).toEqual([{ method: 'GET', path: '/api/ping' }]);
		const ping = await runtime.fetch(new Request('http://localhost/api/ping'));
		const missing = await runtime.fetch(new Request('http://localhost/health'));
		expect(ping.status).toBe(200);
		expect(await ping.json()).toEqual({ message: 'pong' });
		expect(missing.status).toBe(404);
		expect(await missing.json()).toEqual({
			type: 'urn:utils:server:not-found',
			title: 'Not found',
			status: 404,
			instance: '/health',
		});
	});

	it('orders exposed routes for registration-order framework adapters', async () => {
		const Params = schema<Readonly<{ readonly id: string }>>((value) => {
			if (typeof value !== 'object' || value === null || typeof (value as { id?: unknown }).id !== 'string') {
				throw new TypeError('Expected an id parameter.');
			}
			return Object.freeze({ id: (value as { id: string }).id });
		});
		const Item = endpoint.get({ id: 'runtime.item', path: '/items/:id', param: Params, responses: [Message] });
		const Current = endpoint.get({ id: 'runtime.current', path: '/items/me', responses: [Message] });
		const definition = service.define({ id: 'ordered', path: '/api', endpoints: [Item, Current] });
		await using runtime = service.create(service.compile(service.implement(definition, {
			endpoints: [
				endpoint.handler(Item, async () => response.create(Message, { message: 'dynamic' })),
				endpoint.handler(Current, async () => response.create(Message, { message: 'static' })),
			],
			resources: resource.implementations(),
		})), { host: Object.freeze({}) });

		expect(runtime.routes.map(({ method, path }) => `${method} ${path}`)).toEqual([
			'GET /api/items/me',
			'GET /api/items/:id',
		]);
	});

	it('serves isolated one-off HTML routes without changing the Solid renderer', async () => {
		const Html = response.html({ id: 'runtime:html', description: 'One-off HTML response.' });
		const Callback = endpoint.get({ id: 'runtime.callback', path: '/callback', responses: [Html] });
		const definition = service.define({ id: 'callback', path: '/', endpoints: [Callback] });
		await using runtime = service.create(service.compile(service.implement(definition, {
			endpoints: [endpoint.handler(Callback, async () => response.create(Html, '<!doctype html><p>Complete</p>'))],
			resources: resource.implementations(),
		})), { host: Object.freeze({}) });

		const result = await runtime.fetch(new Request('http://localhost/callback'));
		expect(result.headers.get('content-type')).toContain('text/html');
		expect(await result.text()).toContain('<p>Complete</p>');
	});

});
