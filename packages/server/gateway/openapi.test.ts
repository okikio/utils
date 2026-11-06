import '@okikio/duration/polyfill';
import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import * as problem from '@okikio/http/problem';
import * as response from '@okikio/http/response';
import * as endpoint from '../endpoint/mod.ts';
import * as service from '../service/mod.ts';
import * as gateway from './mod.ts';

/** Supply documentation shape without runtime validation; this cast-only fixture proves projection, not input admission. */
function schema<Output>(
	jsonSchema: Readonly<Record<string, unknown>>,
): StandardSchemaV1<unknown, Output> & StandardJSONSchemaV1 {
	return {
		'~standard': {
			version: 1,
			vendor: 'test',
			validate: (value: unknown) => ({ value: value as Output }),
			jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
		},
	};
}

const ValueSchema = schema<{ ok: boolean }>({
	type: 'object',
	properties: { ok: { type: 'boolean' } },
	required: ['ok'],
});
const Ok = response.ok(ValueSchema, { id: 'projection:ok', description: 'Successful projection example.' });
const Inherited = problem.define({
	id: 'projection:inherited',
	type: 'urn:projection:inherited',
	status: 409,
	title: 'Inherited conflict',
	description: 'Conflict declared by the service.',
});
const Read = endpoint.get({
	id: 'projection.read',
	path: '/items/:id',
	param: schema<{ id: string }>({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }),
	responses: [Ok],
});
const Write = endpoint.post({ id: 'projection.write', path: '/items', json: ValueSchema, responses: [Ok] });
const Callback = endpoint.post({
	id: 'projection.callback',
	path: '/callback',
	internal: true,
	raw: endpoint.input(ValueSchema, { contentType: 'application/octet-stream' }),
	responses: [Ok],
});
const definition = service.define({
	id: 'projection',
	path: '/api/v2',
	endpoints: [Read, Write, Callback],
	problems: [Inherited],
});
const compiledService = service.compile(service.implement(definition, {
	endpoints: [Read, Write, Callback].map((entry) =>
		endpoint.handler(entry, async () => response.create(Ok, { ok: true }))
	),
}));
const options = { title: 'Example', version: '1.0.0', services: [compiledService] };

/** Compile a gateway with one public policy and one internal callback so projection can prove which routes and limits are visible. */
function mounted() {
	return gateway.compile(gateway.define({
		id: 'projection-edge',
		services: [gateway.mount(definition, { origin: 'https://private.example.invalid/prefix', internal: [Callback] })],
		policies: [
			gateway.policy({
				id: 'limits',
				endpoints: [Write],
				bodyLimit: 128,
				timeout: { seconds: 2 },
				redirects: gateway.redirects({ mode: 'reject-cross-origin' }),
			}),
		],
	}));
}

function operations(document: endpoint.OpenApiDocument): readonly string[] {
	return Object.entries(document.paths).flatMap(([path, methods]) =>
		Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`)
	).sort();
}

describe('Gateway OpenAPI mounted contracts', () => {
	it('generates mounted contracts from definitions alone, including a selected mount', async () => {
		const compiled = mounted();
		const document = await gateway.openapi(compiled, { title: options.title, version: options.version });
		expect(document).toEqual(await gateway.openapi(compiled, options));
		expect(await gateway.openapi(compiled, { ...options, services: [definition] })).toEqual(document);
		const contract = service.compileDefinition(definition);
		expect(await gateway.openapi(compiled, { ...options, services: [contract] })).toEqual(document);
		const selections = gateway.define({
			id: 'selected-edge',
			services: [
				gateway.mount(service.select(definition, { id: 'read-write', endpoints: [Read, Write] }), {
					origin: 'https://owner.example.invalid',
				}),
			],
		});
		const edge = gateway.compile(selections, { services: [contract] });
		expect(operations(
			await gateway.openapi(edge, {
				title: options.title,
				version: options.version,
				include: (_route, effective) => {
					expect(effective).not.toHaveProperty('handler');
					return true;
				},
			}),
		)).toEqual(['GET /api/v2/items/{id}', 'POST /api/v2/items']);
	});

	it('matches the reachable operation set, preserving service prefixes and admitted callbacks without private origins', async () => {
		const compiled = mounted();
		const document = await gateway.openapi(compiled, {
			...options,
			servers: [{ url: 'https://public.example.invalid' }],
		});
		expect(operations(document)).toEqual(
			compiled.routes.map((route) => `${route.method} ${route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')}`).sort(),
		);
		expect(document.paths['/api/v2/items/{id}']?.get).toBeDefined();
		expect(document.paths['/prefix/api/v2/items/{id}']).toBeUndefined();
		expect(JSON.stringify(document)).not.toContain('private.example.invalid');
		expect(document.servers).toEqual([{ url: 'https://public.example.invalid' }]);
		expect(Object.isFrozen(document.paths)).toBe(true);
	});

	it('projects exactly a selected mount and narrows audience views without exposing its siblings', async () => {
		const selected = gateway.compile(
			gateway.define({
				id: 'read-edge',
				services: [
					gateway.mount(service.select(definition, { id: 'read-selection', endpoints: [Read] }), {
						origin: 'https://owner.example.invalid',
					}),
				],
			}),
		);
		expect(operations(await gateway.openapi(selected, options))).toEqual(['GET /api/v2/items/{id}']);
		expect(
			operations(
				await gateway.openapi(mounted(), {
					...options,
					includeInternal: false,
					include: (route) => route.endpointId === Write.id,
				}),
			),
		).toEqual(['POST /api/v2/items']);
	});

	it('retains inherited/content-negotiation failures and adds only applicable generic edge failures', async () => {
		const document = await gateway.openapi(mounted(), options);
		const write = document.paths['/api/v2/items']?.post as { responses: Record<string, unknown> };
		const read = document.paths['/api/v2/items/{id}']?.get as { responses: Record<string, unknown> };
		for (const status of ['200', '400', '406', '409', '413', '415', '502', '503', '504']) {
			expect(write.responses[status]).toBeDefined();
		}
		for (const status of ['413', '502', '504']) expect(read.responses[status]).toBeUndefined();
		expect(JSON.stringify(write.responses['409'])).toContain('urn:projection:inherited');
	});

	it('lets the identity owner preserve AND/OR authentication and excludes unused private hop schemes', async () => {
		const compiled = mounted();
		const security: readonly endpoint.OpenApiSecurityRequirement[] = [{ apiKey: [], installation: ['read'] }, {
			session: [],
		}];
		const document = await gateway.openapi(compiled, {
			...options,
			security: {
				schemes: {
					apiKey: { type: 'http', scheme: 'bearer' },
					installation: { type: 'oauth2', flows: {} },
					session: { type: 'apiKey', in: 'cookie', name: 'session' },
					privateAssertion: { type: 'apiKey', in: 'header', name: 'x-internal-assertion' },
				},
				operation(route, effective) {
					expect(route.serviceRouteId).toBe(effective.id);
					return route.endpointId === Read.id ? security : [];
				},
			},
		});
		expect((document.paths['/api/v2/items/{id}']?.get as Record<string, unknown>).security).toEqual(security);
		expect(Object.keys(document.components?.securitySchemes ?? {}).sort()).toEqual([
			'apiKey',
			'installation',
			'session',
		]);
		expect(JSON.stringify(document)).not.toContain('privateAssertion');
		await expect(
			gateway.openapi(compiled, { ...options, security: { schemes: {}, operation: () => [{ absent: [] }] } }),
		).rejects.toThrow('Undeclared OpenAPI security scheme');
	});

	it('rejects missing, conflicting or drifted compiled contracts rather than documenting a stale graph', async () => {
		await expect(gateway.openapi(mounted(), { ...options, services: [{ ...definition }] })).rejects.toThrow(
			'not the exact mounted definition',
		);
		await expect(gateway.openapi(mounted(), { ...options, services: [] })).rejects.toThrow(
			'Missing compiled service contract',
		);
		const drifted = {
			...compiledService,
			operations: compiledService.operations.map((operation) => ({ ...operation, path: '/wrong' })),
		};
		await expect(gateway.openapi(mounted(), { ...options, services: [drifted] })).rejects.toThrow('does not match');
		await expect(gateway.openapi(mounted(), { ...options, services: [compiledService, drifted] })).rejects.toThrow(
			'Conflicting compiled service contracts',
		);
		const clonedDefinition = { ...compiledService, definition: { ...definition } };
		await expect(gateway.openapi(mounted(), { ...options, services: [clonedDefinition] })).rejects.toThrow(
			'not the exact mounted definition',
		);
		const clonedEndpoint = {
			...compiledService,
			operations: compiledService.operations.map((operation) => ({
				...operation,
				endpoint: { ...operation.endpoint },
			})),
		};
		await expect(gateway.openapi(mounted(), { ...options, services: [clonedEndpoint] })).rejects.toThrow(
			'does not match',
		);
	});

	it('rejects global operation ID collisions even when the paths are disjoint', async () => {
		const otherEndpoint = endpoint.get({
			id: 'another.read',
			operationId: Read.operations[0]!.operationId,
			path: '/another',
			responses: [Ok],
		});
		const otherDefinition = service.define({ id: 'another', path: '/api/v2', endpoints: [otherEndpoint] });
		const other = service.compile(
			service.implement(otherDefinition, {
				endpoints: [endpoint.handler(otherEndpoint, async () => response.create(Ok, { ok: true }))],
			}),
		);
		const compiled = gateway.compile(
			gateway.define({
				id: 'conflicting-edge',
				services: [
					gateway.mount(definition, { origin: 'https://one.example.invalid' }),
					gateway.mount(otherDefinition, { origin: 'https://two.example.invalid' }),
				],
			}),
		);
		await expect(gateway.openapi(compiled, { ...options, services: [compiledService, other] })).rejects.toThrow(
			'operation ID',
		);
	});

	it('preserves binary/SSE and signed raw protocol media types through the existing emitter', async () => {
		const BytesSchema = schema<Uint8Array>({ type: 'string', format: 'binary' });
		const TextSchema = schema<string>({ type: 'string' });
		const Binary = response.download(BytesSchema, {
			id: 'transport:download',
			description: 'CSV export.',
			contentType: 'text/csv',
		});
		const Events = response.stream(TextSchema, {
			id: 'transport:events',
			description: 'Signal events.',
			contentType: 'text/event-stream',
		});
		const Export = endpoint.get({ id: 'transport.export', path: '/export', responses: [Binary] });
		const Stream = endpoint.get({ id: 'transport.stream', path: '/events', responses: [Events] });
		const transportDefinition = service.define({ id: 'transport', path: '/api/v2', endpoints: [Export, Stream] });
		const transport = service.compile(
			service.implement(transportDefinition, {
				endpoints: [
					endpoint.handler(Export, async () => response.create(Binary, new Uint8Array())),
					endpoint.handler(Stream, async () => response.create(Events, '')),
				],
			}),
		);
		const compiled = gateway.compile(
			gateway.define({
				id: 'transport-edge',
				services: [
					gateway.mount(definition, { origin: 'https://owner.example.invalid', internal: [Callback] }),
					gateway.mount(transportDefinition, { origin: 'https://owner.example.invalid' }),
				],
			}),
		);
		const document = await gateway.openapi(compiled, { ...options, services: [compiledService, transport] });
		expect(document.paths['/api/v2/export']?.get).toMatchObject({
			responses: { '200': { content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } } } },
		});
		expect(document.paths['/api/v2/events']?.get).toMatchObject({
			responses: { '200': { content: { 'text/event-stream': { schema: { type: 'string' } } } } },
		});
		expect(document.paths['/api/v2/callback']?.post).toMatchObject({
			requestBody: {
				content: {
					'application/octet-stream': {
						schema: ValueSchema['~standard'].jsonSchema.output({ target: 'draft-2020-12' }),
					},
				},
			},
		});
	});

	it('rejects equivalent path templates with different parameter names across HTTP methods', async () => {
		const Replace = endpoint.post({
			id: 'projection.replace',
			path: '/items/:name',
			param: schema<{ name: string }>({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }),
			responses: [Ok],
		});
		const otherDefinition = service.define({ id: 'replace', path: '/api/v2', endpoints: [Replace] });
		const other = service.compile(
			service.implement(otherDefinition, {
				endpoints: [endpoint.handler(Replace, async () => response.create(Ok, { ok: true }))],
			}),
		);
		const compiled = gateway.compile(
			gateway.define({
				id: 'template-edge',
				services: [
					gateway.mount(definition, { origin: 'https://one.example.invalid' }),
					gateway.mount(otherDefinition, { origin: 'https://two.example.invalid' }),
				],
			}),
		);
		await expect(gateway.openapi(compiled, { ...options, services: [compiledService, other] })).rejects.toThrow(
			'different parameter names',
		);
	});

	it('validates document options for an empty audience too', async () => {
		await expect(gateway.openapi(mounted(), { ...options, title: '', include: () => false })).rejects.toThrow();
		expect(operations(await gateway.openapi(mounted(), { ...options, include: () => false }))).toEqual([]);
	});

	it('documents a route that is exercised through the actual Fetch gateway and service runtime', async () => {
		const compiled = mounted();
		const document = await gateway.openapi(compiled, options);
		const upstream = service.create(compiledService, { host: {} });
		const runtime = gateway.create(compiled, {
			fetch: async (input, init) => {
				const request = input instanceof Request ? input : new Request(input, init);
				const forwarded = new URL(request.url);
				forwarded.pathname = forwarded.pathname.replace(/^\/prefix/, '');
				return upstream.fetch(new Request(forwarded, request));
			},
		});
		const result = await runtime.fetch(new Request('https://public.example.invalid/api/v2/items/example'));
		expect(result.status).toBe(200);
		expect(await result.json()).toEqual({ ok: true });
		expect(
			(document.paths['/api/v2/items/{id}']?.get as { responses: Record<string, unknown> })
				.responses[String(result.status)],
		).toBeDefined();
	});
});
