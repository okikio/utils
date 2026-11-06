import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { Temporal } from '@okikio/duration/temporal';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as problem from '@okikio/http/problem';
const Denied = problem.define({
	id: 'test.denied',
	type: 'urn:test:denied',
	status: 403,
	title: 'Forbidden',
	description: 'The test caller was denied.',
});
import * as endpoint from '@okikio/server/endpoint';
import * as service from '../service/mod.ts';
import * as gateway from './mod.ts';

const HostAuthentication = Object.freeze({ id: 'host:caller', kind: 'authentication' });
const ParameterSchema: StandardSchemaV1<unknown, Readonly<Record<string, string>>> = {
	'~standard': { version: 1, vendor: 'fixture', validate: () => ({ value: {} }) },
};

/** Inert owner-normalized data, with no Definition catalog or implementation imports. */
function owner() {
	return {
		manifest: {
			id: 'remote',
			path: '/api/remote',
			requirements: [],
			reachableRequirements: [],
			resources: [],
			routes: [
				{
					id: 'remote:read:get',
					endpointId: 'remote.read',
					operationId: 'remoteRead',
					method: 'GET',
					path: '/api/remote/:id',
					authentication: ['foreign:caller'],
					requirements: [],
					reachableRequirements: [],
					resources: [],
				},
				{
					id: 'remote:write:post',
					endpointId: 'remote.write',
					operationId: 'remoteWrite',
					method: 'POST',
					path: '/api/remote/:id',
					authentication: ['foreign:caller'],
					requirements: [],
					reachableRequirements: [],
					resources: [],
				},
			],
		},
		document: {
			openapi: '3.1.0',
			info: { title: 'Owner', version: '1' },
			servers: [{ url: 'https://private.invalid' }],
			paths: {
				'/api/remote/{id}': {
					servers: [{ url: 'https://private.invalid' }],
					parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
					get: {
						operationId: 'remoteRead',
						security: [{ upstreamBearer: [] as string[] }],
						servers: [{ url: 'https://private.invalid' }],
						responses: {
							'200': {
								description: 'Owner response',
								content: { 'application/json': { schema: { $ref: '#/components/schemas/Record~1value' } } },
							},
						},
					},
					post: {
						operationId: 'remoteWrite',
						security: [{ upstreamBearer: [] }],
						responses: { '201': { description: 'Owner authored response' } },
					},
				},
			},
			components: {
				securitySchemes: { upstreamBearer: { type: 'http', scheme: 'bearer' } },
				schemas: { 'Record/value': { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
			},
		},
	};
}

/** Bind foreign artifact identities to this host and select one route with explicit upstream and body policy. */
function options(): gateway.MountGatewayArtifactOptions {
	return {
		origin: 'https://private.invalid/prefix',
		routes: ['remote:read:get'],
		authentication: { 'foreign:caller': HostAuthentication },
		security: {
			upstreamBearer: { name: 'callerKey', scheme: { type: 'apiKey', in: 'header', name: 'Authorization' } },
		},
		bodyLimit: 16,
		timeout: Temporal.Duration.from({ seconds: 1 }),
	};
}

function compiled(artifact = gateway.mountArtifact(owner(), options())) {
	return gateway.compile(gateway.define({ id: 'edge', services: [], artifacts: [artifact] }));
}

describe('portable gateway artifact admission', () => {
	it('snapshots authoritative schemas, explicitly admits one route and replaces downstream security documentation', async () => {
		const original = owner();
		const mounted = gateway.mountArtifact(original, options());
		original.manifest.routes[0]!.path = '/changed';
		original.document.components.schemas['Record/value'].properties.name.type = 'integer';
		const graph = compiled(mounted);
		expect(graph.routes).toHaveLength(1);
		expect(graph.routes[0]!.authenticate).toEqual([HostAuthentication]);
		expect(gateway.match(graph, new Request('https://edge.invalid/api/remote/123', { method: 'POST' })))
			.toBeUndefined();
		const document = await gateway.openapi(graph, {
			title: 'Caller',
			version: '1',
			servers: [{ url: 'https://edge.invalid' }],
		});
		expect(document.paths['/api/remote/{id}']!.post).toBeUndefined();
		expect(document.paths['/api/remote/{id}']!.get).toMatchObject({
			operationId: 'remoteRead',
			security: [{ callerKey: [] }],
		});
		expect(document.components?.securitySchemes).toEqual({
			callerKey: { type: 'apiKey', in: 'header', name: 'Authorization' },
		});
		const components = document.components as Readonly<Record<string, unknown>>;
		expect(components.schemas).toEqual({
			'remote:Record/value': { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
		});
		expect(JSON.stringify(document)).toContain('#/components/schemas/remote:Record~1value');
		expect(JSON.stringify(document)).not.toContain('private.invalid');
		expect(JSON.stringify(document)).not.toContain('upstreamBearer');
		expect(Object.isFrozen(mounted.document.paths)).toBe(true);
		const operation = document.paths['/api/remote/{id}']!.get as Readonly<Record<string, unknown>>;
		expect(Object.keys(operation.responses as object)).toEqual(
			expect.arrayContaining(['200', '400', '413', '503', '504']),
		);
	});

	it('uses existing forwarding and authentication adapters with zero dispatch for denied callers', async () => {
		const graph = compiled();
		expect(() => gateway.create(graph)).toThrow('authentication runtime');
		let dispatches = 0;
		const runtime = gateway.create(graph, {
			adapters: {
				authenticate(requirements, state) {
					expect(requirements).toEqual([HostAuthentication]);
					if (state.request.headers.get('authorization') !== 'Bearer caller') {
						return problem.create(Denied);
					}
					return { headers: { 'x-verified-principal': 'fixture' } };
				},
			},
			fetch: (input) => {
				dispatches++;
				const request = input as Request;
				expect(request.url).toBe('https://private.invalid/prefix/api/remote/123?q=1');
				expect(request.headers.get('authorization')).toBeNull();
				expect(request.headers.get('cookie')).toBeNull();
				expect(request.headers.get('x-verified-principal')).toBe('fixture');
				return Promise.resolve(new Response('{"name":"Owner"}', { headers: { 'content-type': 'application/json' } }));
			},
		});
		const denied = await runtime.fetch(new Request('https://edge.invalid/api/remote/123'));
		expect(denied.status).toBe(403);
		await denied.body?.cancel();
		expect(dispatches).toBe(0);
		const admitted = await runtime.fetch(
			new Request('https://edge.invalid/api/remote/123?q=1', {
				headers: { authorization: 'Bearer caller', cookie: 'session=caller' },
			}),
		);
		expect(await admitted.json()).toEqual({ name: 'Owner' });
		expect(dispatches).toBe(1);
	});

	for (const admission of [[], ['unknown'], ['remote:read:get', 'remote:read:get']]) {
		it(`rejects malformed or unknown route admission ${JSON.stringify(admission)}`, () => {
			expect(() => gateway.mountArtifact(owner(), { ...options(), routes: admission })).toThrow();
		});
	}

	for (
		const authentication of [{}, { 'foreign:caller': [] }, {
			'foreign:caller': HostAuthentication,
			unknown: HostAuthentication,
		}] as readonly gateway.MountGatewayArtifactOptions['authentication'][]
	) {
		it(`rejects unbound, empty or unknown host authentication mappings ${JSON.stringify(authentication)}`, () => {
			expect(() => gateway.mountArtifact(owner(), { ...options(), authentication })).toThrow();
		});
	}

	it('rejects missing and mismatched caller security mapping instead of accepting owner bearer placeholders', () => {
		expect(() => gateway.mountArtifact(owner(), { ...options(), security: {} })).toThrow('mapping');
		const anonymous = owner();
		anonymous.document.paths['/api/remote/{id}'].get.security = [];
		expect(() => gateway.mountArtifact(anonymous, options())).toThrow('authentication drifts');
	});

	it('rejects incomplete HTTP, API-key, OAuth and OpenID caller mechanisms', () => {
		for (
			const scheme of [
				{ type: 'http' },
				{ type: 'http', scheme: 'invalid token' },
				{ type: 'apiKey', name: 'key' },
				{ type: 'apiKey', name: '', in: 'header' },
				{ type: 'oauth2' },
				{ type: 'oauth2', flows: { authorizationCode: { scopes: {} } } },
				{ type: 'openIdConnect' },
				{ type: 'openIdConnect', openIdConnectUrl: 'relative/path' },
			]
		) {
			expect(() =>
				gateway.mountArtifact(owner(), { ...options(), security: { upstreamBearer: { name: 'caller', scheme } } })
			).toThrow();
		}
	});

	it('accepts complete caller mechanisms and rejects unbound OAuth scopes', () => {
		for (
			const scheme of [
				{ type: 'http', scheme: 'bearer' },
				{ type: 'apiKey', name: 'Authorization', in: 'header' },
				{
					type: 'oauth2',
					flows: { clientCredentials: { tokenUrl: 'https://identity.invalid/token', scopes: { read: 'Read' } } },
				},
				{ type: 'openIdConnect', openIdConnectUrl: 'https://identity.invalid/.well-known/openid-configuration' },
			]
		) {
			expect(
				gateway.mountArtifact(owner(), { ...options(), security: { upstreamBearer: { name: 'caller', scheme } } })
					.routes,
			).toHaveLength(1);
		}
		const source = owner();
		source.document.paths['/api/remote/{id}'].get.security = [{ upstreamBearer: ['unbound'] }];
		expect(() =>
			gateway.mountArtifact(source, {
				...options(),
				security: {
					upstreamBearer: {
						name: 'caller',
						scheme: {
							type: 'oauth2',
							flows: { clientCredentials: { tokenUrl: 'https://identity.invalid/token', scopes: {} } },
						},
					},
				},
			})
		).toThrow('undeclared OAuth scopes');
	});

	it('rejects manifest/document drift and duplicate stable route or operation identities', () => {
		const path = owner();
		path.manifest.routes[0]!.path = '/api/remote/other';
		expect(() => gateway.mountArtifact(path, options())).toThrow('drift');
		const operation = owner();
		operation.document.paths['/api/remote/{id}'].get.operationId = 'wrong';
		expect(() => gateway.mountArtifact(operation, options())).toThrow('drift');
		const duplicate = owner();
		duplicate.manifest.routes.push({ ...duplicate.manifest.routes[0]! });
		expect(() => gateway.mountArtifact(duplicate, options())).toThrow('duplicate');
		const malformed = owner();
		malformed.manifest.routes[0]!.method = 'UNKNOWN';
		expect(() => gateway.mountArtifact(malformed, options())).toThrow('malformed');
	});

	it('rejects unqualified, dangling and remote schema references', () => {
		for (const reference of ['#/$defs/Missing', '#/components/schemas/Missing', 'https://private.invalid/schema']) {
			const source = owner();
			source.document.paths['/api/remote/{id}'].get.responses['200'].content['application/json'].schema.$ref =
				reference;
			expect(() => gateway.mountArtifact(source, options())).toThrow();
		}
		const source = owner();
		expect(() =>
			gateway.mountArtifact({
				...source,
				document: {
					...source.document,
					components: {
						...source.document.components,
						schemas: {
							...source.document.components.schemas,
							Scoped: { $id: 'https://schema.invalid', type: 'object' },
						},
					},
				},
			}, options())
		).toThrow('$id');
	});

	it('rejects wrong path parameter names, noncanonical templates and escaped path attacks', () => {
		const parameter = owner();
		parameter.document.paths['/api/remote/{id}'].parameters[0]!.name = 'wrong';
		expect(() => gateway.mountArtifact(parameter, options())).toThrow('parameter');
		for (const path of ['/api/remote/../private', '/api/remote//id', '/api/remote/%2Fprivate', '/api/remote/id/']) {
			const source = owner();
			source.manifest.routes[0]!.path = path;
			expect(() => gateway.mountArtifact(source, options())).toThrow('malformed');
		}
	});

	it('rejects non-JSON values and accessors without executing them', () => {
		let reads = 0;
		const source = owner();
		Object.defineProperty(source.document, 'private', {
			enumerable: true,
			get() {
				reads++;
				throw new Error('getter executed');
			},
		});
		expect(() => gateway.mountArtifact(source, options())).toThrow('data properties');
		expect(reads).toBe(0);
		expect(() =>
			gateway.mountArtifact({ ...owner(), document: { ...owner().document, function: () => {} } }, options())
		).toThrow('JSON');
	});

	it('rejects unbound resource and custom requirements rather than silently dropping authority', () => {
		for (const field of ['requirements', 'reachableRequirements', 'resources', 'resourceGraph', 'workflows']) {
			const source = owner();
			expect(() =>
				gateway.mountArtifact(
					{ ...source, manifest: { ...source.manifest, [field]: [{ id: 'unbound:authority' }] } },
					options(),
				)
			).toThrow('host capability binding');
			expect(() =>
				gateway.mountArtifact({
					...source,
					manifest: {
						...source.manifest,
						routes: source.manifest.routes.map((route) => ({ ...route, [field]: [{ id: 'unbound:authority' }] })),
					},
				}, options())
			).toThrow('host capability binding');
		}
	});

	it('rejects route, global operation and cross-method parameter-template conflicts with local definitions', () => {
		for (
			const input of [
				{
					method: 'GET',
					path: '/api/remote/:id',
					operationId: 'localRead',
					diagnostic: 'conflicts with an existing gateway route',
				},
				{
					method: 'POST',
					path: '/different',
					operationId: 'remoteRead',
					diagnostic: 'conflicts with an existing gateway operation',
				},
				{
					method: 'POST',
					path: '/api/remote/:other',
					operationId: 'localWrite',
					diagnostic: 'changes existing path parameter names',
				},
			] as const
		) {
			const local = service.define({
				id: 'local',
				path: '/',
				endpoints: [endpoint.define({
					id: 'local.endpoint',
					path: input.path,
					...(input.path.includes(':') ? { param: ParameterSchema } : {}),
					operations: [
						endpoint.operation.define({
							id: 'local.operation',
							method: input.method.toLowerCase() as 'get' | 'post',
							operationId: input.operationId,
							rawResponse: true,
						}),
					],
				})],
			});
			expect(service.validate(local).valid).toBe(true);
			expect(() =>
				gateway.compile(
					gateway.define({
						id: 'mixed',
						services: [gateway.mount(local, { origin: 'https://local.invalid' })],
						artifacts: [gateway.mountArtifact(owner(), options())],
					}),
				)
			).toThrow(input.diagnostic);
		}
	});

	it('rejects duplicate service ownership and fabricated unchecked artifact mounts', () => {
		const artifact = gateway.mountArtifact(owner(), options());
		expect(() => gateway.compile(gateway.define({ id: 'duplicate', services: [], artifacts: [artifact, artifact] })))
			.toThrow('mounted more than once');
		expect(() => gateway.define({ id: 'fake', services: [], artifacts: [{ ...artifact }] })).toThrow('mountArtifact');
	});

	it('rejects a repeated compiled route identity across distinct services and disjoint templates', () => {
		const original = owner();
		const source = {
			manifest: {
				...original.manifest,
				id: 'second',
				path: '/other',
				routes: original.manifest.routes.map((route) => ({
					...route,
					path: '/other/:id',
					operationId: `${route.operationId}Second`,
				})),
			},
			document: {
				...original.document,
				paths: {
					'/other/{id}': {
						...original.document.paths['/api/remote/{id}'],
						get: { ...original.document.paths['/api/remote/{id}'].get, operationId: 'remoteReadSecond' },
						post: { ...original.document.paths['/api/remote/{id}'].post, operationId: 'remoteWriteSecond' },
					},
				},
			},
		};
		const first = gateway.mountArtifact(original, options());
		const second = gateway.mountArtifact(source, options());
		expect(() => gateway.compile(gateway.define({ id: 'edge', services: [], artifacts: [first, second] }))).toThrow(
			'gateway route identity',
		);
	});
});

describe('artifact document versions', () => {
	it('requires explicit OpenAPI 3.2 output before composing a 3.2 artifact', async () => {
		const source = owner();
		source.document.openapi = '3.2.0';
		const artifact = gateway.mountArtifact(source, options());
		const compiled = gateway.compile(gateway.define({ id: 'edge', artifacts: [artifact] }));
		await expect(gateway.openapi(compiled, { title: 'Edge', version: '1' })).rejects.toThrow(TypeError);
		expect((await gateway.openapi(compiled, { title: 'Edge', version: '1', specVersion: '3.2.0' })).openapi).toBe(
			'3.2.0',
		);
	});
});
