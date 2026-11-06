import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as endpoint from '@okikio/server/endpoint';
import * as effect from '@okikio/capability/effect';
import * as middleware from '@okikio/server/middleware';
import * as resilience from '@okikio/capability/resilience';
import * as response from '@okikio/http/response';
import * as resource from '@okikio/capability/resource';
import * as permissions from '@okikio/authz/permission';
import * as service from './mod.ts';
import { Message, MessageSchema, schema } from './fixtures/runtime.ts';

describe('service request pipeline', () => {
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
		const WholeRequest = middleware.define({
			id: 'runtime.wholeRequest',
			description: 'Surround the complete application request pipeline.',
		});
		const BeforeValidation = middleware.define({ id: 'runtime.before-validation', description: 'Before validation.' });
		const AfterValidation = middleware.define({ id: 'runtime.after-validation', description: 'After validation.' });
		const AroundOperation = middleware.define({ id: 'runtime.around-handler', description: 'Around handler.' });
		const trace = (name: string, definition: middleware.MiddlewareDefinition) =>
			middleware.handler(
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
				authenticate: async () =>
					Object.freeze({
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
		expect(() => service.create(compiled, { host: Object.freeze({}) })).toThrow(
			service.ServiceRuntimeConfigurationError,
		);

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
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(Slow, async () => {
					await new Promise<never>(() => {});
					return response.create(Message, { message: 'late' });
				})],
				resources: resource.implementations(),
			})),
			{ host: Object.freeze({}) },
		);
		const result = await runtime.fetch(new Request('http://localhost/slow'));
		expect(result.status).toBe(504);
		expect((await result.json() as { type: string }).type).toBe('urn:utils:server:deadline-exceeded');
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
		expect(() => service.create(compiled, { host: Object.freeze({}) })).toThrow(
			service.ServiceRuntimeConfigurationError,
		);

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
		const result = await runtime.fetch(
			new Request('http://localhost/reliable', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'operation-1' },
				body: '{"message":"safe retry"}',
			}),
		);
		expect(result.status).toBe(200);
		expect(observed).toEqual(['idempotency', 'retry']);
	});
});
