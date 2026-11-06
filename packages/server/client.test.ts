import { describe, it } from 'node:test';
import { expect, fn } from '@std/expect';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import * as endpoint from './endpoint/mod.ts';
import * as service from './service/mod.ts';
import * as response from '@okikio/http/response';
import * as problem from '@okikio/http/problem';
import * as client from './client.ts';
const bounds = { maximumDeclarations: 10, maximumRequestBytes: 4096, maximumResponseBytes: 4096 };

describe('declaration-bound client', () => {
	it('round trips exact endpoint identity, encoded paths and directional responses through the real service', async () => {
		let encodes = 0, decodes = 0, inputs = 0;
		const DateCodec = codec.define({
			decode: schema.define((value) => {
				decodes++;
				if (typeof value !== 'string') throw new TypeError('Expected date wire string');
				return new Date(value);
			}),
			encode: schema.define((value) => {
				encodes++;
				if (!(value instanceof Date)) throw new TypeError('Expected Date');
				return value.toISOString();
			}),
		});
		const Saved = response.ok(DateCodec, { id: 'saved', description: 'Saved timestamp.', envelope: 'data' });
		const Missing = problem.define({
			id: 'missing',
			type: 'https://local.invalid/missing',
			title: 'Missing',
			description: 'Missing record.',
			status: 404,
		});
		const Route = endpoint.post({
			id: 'create',
			path: '/items/:id',
			param: schema.object({ id: schema.string() }),
			json: schema.define((value) => {
				inputs++;
				return schema.object({ title: schema.string() }).parse(value);
			}),
			responses: [Saved],
			problems: [Missing],
		});
		const Api = service.define({ id: 'client-roundtrip', path: '/api', endpoints: [Route] });
		await using runtime = service.create(
			service.compile(service.implement(Api, {
				endpoints: [
					endpoint.handler(
						Route,
						({ input }) =>
							input.json.title === 'missing'
								? problem.create(Missing)
								: response.create(Saved, new Date('2026-01-01T00:00:00Z')),
					),
				],
			})),
			{ host: {} },
		);
		let url = '', credentials = '', redirects = '';
		const caller = client.create(Route, {
			...bounds,
			baseUrl: 'https://local.invalid/api',
			fetch: (request, init) => {
				url = request.url;
				credentials = init.credentials!;
				redirects = request.redirect;
				return runtime.fetch(request);
			},
		});
		const result = await caller.call(Route.operations[0], { param: { id: 'a/b ?#%' }, json: { title: 'present' } });
		expect(result.kind).toBe('success');
		if (result.kind === 'success') {
			expect(result.definition).toBe(Saved);
			expect(result.value).toEqual(new Date('2026-01-01T00:00:00Z'));
		}
		expect(url).toBe('https://local.invalid/api/items/a%2Fb%20%3F%23%25');
		expect(credentials).toBe('omit');
		expect(redirects).toBe('manual');
		expect([inputs, encodes, decodes]).toEqual([2, 1, 1]);
		expect((await caller.call(Route.operations[0], { param: { id: 'gone' }, json: { title: 'missing' } })).kind).toBe(
			'problem',
		);
		await expect(caller.call(Route.operations[0], { param: { id: '..' }, json: { title: 'bad' } })).rejects.toThrow(
			TypeError,
		);
	});

	describe('client response admission', () => {
		const Saved = response.ok(schema.string(), { id: 'text', description: 'Text.' });
		const Missing = problem.define({
			id: 'missing',
			type: 'https://local.invalid/missing',
			title: 'Missing',
			description: 'Missing.',
			status: 404,
		});
		const Route = endpoint.get({ id: 'get', path: '/item', responses: [Saved], problems: [Missing] });
		// Each factory owns a fresh body. Only the size scenario lowers the budget;
		// otherwise a size rejection could hide a broken protocol validation path.
		const scenarios = [
			{ name: 'undeclared status', create: () => new Response('no', { status: 503 }), status: 503 },
			{
				name: 'mismatched media type',
				create: () => new Response('text', { headers: { 'content-type': 'text/plain' } }),
				status: 200,
			},
			{
				name: 'malformed JSON within the size budget',
				create: () => new Response('{bad', { headers: { 'content-type': 'application/json' } }),
				status: 200,
				cause: SyntaxError,
			},
			{
				name: 'valid JSON exceeding the size budget',
				create: () => Response.json('longer than budget'),
				status: 200,
				maximumResponseBytes: 4,
				cause: RangeError,
			},
			{
				name: 'undeclared problem type within the size budget',
				create: () =>
					Response.json({ type: 'https://unknown.invalid/problem', status: 404, title: 'Unknown' }, {
						status: 404,
						headers: { 'content-type': 'application/problem+json' },
					}),
				status: 404,
			},
		] as const;

		for (const scenario of scenarios) {
			it(`rejects ${scenario.name}`, async () => {
				const transport = fn();
				const caller = client.create(Route, {
					...bounds,
					...('maximumResponseBytes' in scenario ? { maximumResponseBytes: scenario.maximumResponseBytes } : {}),
					baseUrl: 'https://local.invalid',
					fetch: async () => {
						transport();
						return scenario.create();
					},
				});
				const pending = caller.call(Route.operations[0], {});

				await expect(pending).rejects.toBeInstanceOf(client.ClientResponseError);
				await expect(pending).rejects.toMatchObject({ status: scenario.status });
				// Protocol rejection happens before decoding; malformed JSON and size
				// limits must preserve their distinct underlying failures instead.
				if ('cause' in scenario) {
					await expect(pending).rejects.toMatchObject({ cause: expect.any(scenario.cause) });
				} else {
					await expect(pending).rejects.not.toHaveProperty('cause');
				}
				expect(transport).toHaveBeenCalledTimes(1);
			});
		}

		it('cancels an unread body after rejecting its status', async () => {
			let cancelled = false;
			const incoming = new Response(
				new ReadableStream({
					cancel() {
						cancelled = true;
					},
				}),
				{ status: 503 },
			);
			await expect(
				client.create(Route, { ...bounds, baseUrl: 'https://local.invalid', fetch: async () => incoming }).call(
					Route.operations[0],
					{},
				),
			).rejects.toThrow(client.ClientResponseError);
			expect(cancelled).toBe(true);
		});
	});

	describe('client body ownership', () => {
		it('transfers streaming success without reading the body', async () => {
			let pulls = 0, cancelled = false;
			const Stream = response.stream(schema.unknown(), { id: 'stream', description: 'Bytes.' });
			const Route = endpoint.get({ id: 'stream', path: '/bytes', responses: [Stream] });
			const native = new Response(
				new ReadableStream<Uint8Array>({
					pull() {
						pulls++;
					},
					cancel() {
						cancelled = true;
					},
				}, { highWaterMark: 0 }),
				{ headers: { 'content-type': 'application/octet-stream' } },
			);
			const result = await client.create(Route, {
				...bounds,
				baseUrl: 'https://local.invalid',
				fetch: async () => native,
			})
				.call(Route.operations[0], {});
			if (result.kind !== 'success') throw new Error('Expected stream');
			expect(result.value).toBe(native);
			expect(pulls).toBe(0);
			await result.value.body?.cancel();
			expect(cancelled).toBe(true);
		});

		it('preserves caller cancellation during a pending bounded JSON read', async () => {
			const Json = endpoint.get({
				id: 'json',
				path: '/json',
				responses: [response.ok(schema.string(), { description: 'Text.' })],
			});
			const abort = new AbortController();
			const reason = new Error('caller cancelled');
			const pending = client.create(Json, {
				...bounds,
				baseUrl: 'https://local.invalid',
				fetch: async () =>
					new Response(
						new ReadableStream<Uint8Array>({
							pull() {
								abort.abort(reason);
							},
						}),
						{ headers: { 'content-type': 'application/json' } },
					),
			}).call(Json.operations[0], {}, { signal: abort.signal });
			await expect(pending).rejects.toBe(reason);
		});
	});

	it('keeps client decode, real wire output and OpenAPI schema direction aligned', async () => {
		const numeric = codec.define({
			decode: schema.transform(schema.string(), Number),
			encode: schema.transform(schema.number(), String),
		});
		const Output = response.ok(numeric, {
			id: 'numeric',
			description: 'Numeric application, string wire.',
			jsonSchema: { type: 'string' },
		});
		const Route = endpoint.get({ id: 'number', path: '/number', responses: [Output] });
		const Api = service.define({ id: 'numbers', path: '/', endpoints: [Route] });
		const compiled = service.compile(
			service.implement(Api, { endpoints: [endpoint.handler(Route, () => response.create(Output, 42))] }),
		);
		const before = service.document(compiled);
		await using runtime = service.create(compiled, { host: {} });
		const result = await client.create(Route, { ...bounds, baseUrl: 'https://local.invalid', fetch: runtime.fetch })
			.call(
				Route.operations[0],
				{},
			);
		if (result.kind !== 'success') throw new Error('Expected numeric success');
		expect(result.value).toBe(42);
		const api = await service.openapi(compiled, { title: 'Numbers', version: '1' });
		expect(JSON.stringify(api.paths)).toContain('"type":"string"');
		expect(service.document(compiled)).toBe(before);
		expect(Object.isFrozen(before.routes)).toBe(true);
	});

	it('preserves repeated query/form values and typed wire headers without schema re-evaluation', async () => {
		const Output = response.ok(schema.unknown(), { description: 'Captured wire.' });
		const Route = endpoint.post({
			id: 'forms',
			path: '/forms',
			query: schema.object({ tag: schema.array(schema.string()) }),
			header: schema.object({ 'x-owner': schema.string() }, { unknownKeys: 'strip' }),
			cookie: schema.object({ session: schema.string() }),
			form: schema.object({ tag: schema.array(schema.string()) }),
			responses: [Output],
		});
		const Api = service.define({ id: 'forms', path: '/', endpoints: [Route] });
		await using runtime = service.create(
			service.compile(service.implement(Api, {
				endpoints: [endpoint.handler(Route, ({ input }) => response.create(Output, input))],
			})),
			{ host: {} },
		);
		const result = await client.create(Route, { ...bounds, baseUrl: 'https://local.invalid', fetch: runtime.fetch })
			.call(
				Route.operations[0],
				{
					query: { tag: ['a', 'b'] },
					header: { 'x-owner': 'test' },
					cookie: { session: 'opaque' },
					form: { tag: ['one', 'two'] },
				},
			);
		if (result.kind !== 'success') throw new Error('Expected form success');
		expect(result.value).toEqual({
			query: { tag: ['a', 'b'] },
			header: { 'x-owner': 'test' },
			cookie: { session: 'opaque' },
			form: { tag: ['one', 'two'] },
		});
	});

	it('refuses an undeclared inverse for a transforming Standard Schema before fetching', () => {
		let fetched = false;
		const Route = endpoint.get({
			id: 'transform',
			path: '/transform',
			responses: [response.ok(schema.transform(schema.string(), Number), { description: 'Needs an explicit codec.' })],
		});
		expect(() =>
			client.create(Route, {
				...bounds,
				baseUrl: 'https://local.invalid',
				fetch: () => {
					fetched = true;
					return Response.json('1');
				},
			})
		).toThrow(TypeError);
		expect(fetched).toBe(false);
	});

	it('returns no body for HEAD and permits omitted representation media metadata without reading it', async () => {
		const Route = endpoint.head({
			id: 'head.metadata',
			path: '/head',
			responses: [response.ok(schema.string(), { description: 'GET representation.' })],
		});
		const caller = client.create(Route, {
			...bounds,
			baseUrl: 'https://local.invalid',
			fetch: () => new Response(null, { status: 200 }),
		});
		const value = await caller.call(Route.operations[0], {});
		expect(value.kind).toBe('success');
		if (value.kind === 'success') expect(value.value).toBeUndefined();
	});
});
