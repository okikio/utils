import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as response from '@okikio/http/response';
import * as problem from '@okikio/http/problem';
import * as endpoint from './mod.ts';

function schema<Output>(jsonSchema: Readonly<Record<string, unknown>>, validate: (value: unknown) => Output): StandardSchemaV1<unknown, Output> & endpoint.StandardJsonSchemaV1 {
	return {
		'~standard': {
			version: 1,
			vendor: 'test',
			validate(value) {
				try { return { value: validate(value) }; }
				catch (error) { return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }; }
			},
		},
		'~standard-json-schema': { version: 1, vendor: 'test', jsonSchema },
	};
}

const Path = schema({ type: 'object', properties: { widgetId: { type: 'string' } }, required: ['widgetId'] }, (value) => value as { widgetId: string });
const Query = schema({ type: 'object', properties: { include: { type: 'array', items: { type: 'string' } } } }, (value) => value as { include?: string[] });
const Widget = schema({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, (value) => value as { id: string });
const Detail = response.ok(Widget, { id: 'widgets:detail', description: 'Widget detail.' });
const NotFound = problem.define({
	id: 'widgets:not-found',
	type: 'https://api.example.invalid/problems/widget-not-found',
	status: 404,
	title: 'Widget not found',
	description: 'The requested widget does not exist.',
});

const GetWidget = endpoint.operation.get({
	id: 'widgets.get',
	operationId: 'getWidget',
	query: Query,
	responses: [Detail],
	problems: [NotFound],
});
const WidgetById = endpoint.define({
	id: 'widgets.by-id',
	path: '/:widgetId',
	param: Path,
	operations: [GetWidget],
});

describe('endpoint definitions and handlers', () => {
	it('binds operations by direct identity and requires exhaustive multi-method maps', () => {
		const Update = endpoint.operation.patch({ id: 'widgets.update', json: Widget, responses: [Detail] });
		const definition = endpoint.define({ id: 'widgets.item', path: '/:widgetId', param: Path, operations: [GetWidget, Update] });
		expect(() => endpoint.handler(definition, { get: async () => response.create(Detail, { id: 'a' }) } as never)).toThrow(TypeError);
		const handlers = endpoint.handler(definition, {
			get: async () => response.create(Detail, { id: 'a' }),
			patch: async () => response.create(Detail, { id: 'b' }),
		});
		expect(handlers.bindings.map((binding) => binding.operation)).toEqual([GetWidget, Update]);
	});

	it('preserves exact authored input slot types after record validation', () => {
		const operation = endpoint.operation.get({
			id: 'widgets.exact-inputs',
			query: Query,
			responses: [Detail],
		});
		const definition = endpoint.define({
			id: 'widgets.exact-path-inputs',
			path: '/:widgetId',
			param: Path,
			operations: [operation],
		});
		const query: typeof Query = operation.inputs.query;
		const param: typeof Path = definition.inputs.param;

		expect(query).toBe(Query);
		expect(param).toBe(Path);
	});

	it('rejects accessor-backed endpoint authoring without invoking getters', () => {
		let reads = 0;
		const definition = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(definition, 'id', { enumerable: true, get() { reads++; return 'unsafe'; } });
		Object.defineProperty(definition, 'path', { value: '/unsafe', enumerable: true });
		Object.defineProperty(definition, 'operations', { value: [GetWidget], enumerable: true });
		expect(() => endpoint.define(definition as never)).toThrow('enumerable data property');
		expect(reads).toBe(0);
	});

	it('rejects accessor-backed handler maps without invoking handlers during classification', () => {
		const Update = endpoint.operation.patch({ id: 'widgets.safe-map-update', json: Widget, responses: [Detail] });
		const definition = endpoint.define({ id: 'widgets.safe-map', path: '/:widgetId', param: Path, operations: [GetWidget, Update] });
		let reads = 0;
		const handles = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(handles, 'get', { enumerable: true, get() { reads++; return async () => response.create(Detail, { id: 'a' }); } });
		Object.defineProperty(handles, 'patch', { value: async () => response.create(Detail, { id: 'b' }), enumerable: true });
		expect(() => endpoint.handler(definition, handles as never)).toThrow('exhaustive method map');
		expect(reads).toBe(0);
	});

	it('snapshots documented input parsing policy', () => {
		const parsing: { bareQueryParameters: 'flag' | 'empty' } = { bareQueryParameters: 'flag' };
		const slot = endpoint.input(Query, { parsing });
		parsing.bareQueryParameters = 'empty';
		expect(slot.parsing).toEqual({ bareQueryParameters: 'flag' });
		expect(Object.isFrozen(slot.parsing)).toBe(true);
	});

	it('rejects conflicting body inputs and path templates without param contracts', () => {
		expect(() => endpoint.post({ id: 'widgets.invalid', path: '/', json: Widget, raw: Widget, responses: [Detail] })).toThrow(TypeError);
		expect(() => endpoint.define({ id: 'widgets.invalid-path', path: '/:widgetId', operations: [GetWidget] })).toThrow(TypeError);
	});

	it('requires canonical endpoint paths at definition time', () => {
		expect(() => endpoint.get({ id: 'widgets.double-slash', path: '//widgets', responses: [Detail] })).toThrow('empty path segments');
		expect(() => endpoint.get({ id: 'widgets.trailing-slash', path: '/widgets/', responses: [Detail] })).toThrow('must not end with /');
	});


	it('promotes a single-method route parameter schema to the path contract', () => {
		const endpointDefinition = endpoint.get({
			id: 'widgets.single',
			path: '/widgets/:widgetId',
			param: Path,
			responses: [Detail],
		});
		expect(endpointDefinition.inputs.param).toBe(Path);
		expect(endpoint.validate(endpointDefinition).valid).toBe(true);
	});

	it('rejects attaching one operation object to multiple endpoint paths', () => {
		const first = endpoint.define({
			id: 'widgets.first-path',
			path: '/first/:widgetId',
			param: Path,
			operations: [GetWidget],
		});
		const second = endpoint.define({
			id: 'widgets.second-path',
			path: '/second/:widgetId',
			param: Path,
			operations: [GetWidget],
		});
		const result = endpoint.validate([first, second]);
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.issues.some((issue) =>
				issue.code === 'duplicate-operation-id' && issue.message.includes('one endpoint path owner')
			)).toBe(true);
		}
	});

	it('rejects operations without a declared result envelope', () => {
		const invalid = endpoint.get({
			id: 'widgets.empty',
			path: '/widgets',
		});
		const result = endpoint.validate(invalid);
		expect(result.valid).toBe(false);
		if (!result.valid) expect(result.issues.some((issue) => issue.code === 'missing-result')).toBe(true);
	});

	it('snapshots contribution arrays at definition time', () => {
		const responses: response.ResponseDefinition[] = [Detail];
		const definition = endpoint.get({
			id: 'widgets.snapshot',
			path: '/widgets',
			responses,
		});
		responses.push(response.noContent());
		expect(definition.operations[0]?.responses).toEqual([Detail]);
	});

	it('projects exact path parameters, request inputs, responses, and RFC problems to OpenAPI', async () => {
		const Widgets = endpoint.group({ id: 'widgets', path: '/widgets', endpoints: [WidgetById] });
		const document = await endpoint.openapi(Widgets, { title: 'Widgets', version: '1.0.0' });
		const operation = document.paths['/widgets/{widgetId}']?.get as Record<string, unknown>;
		expect(operation.operationId).toBe('getWidget');
		expect(operation.parameters).toEqual([
			{ in: 'param', name: 'widgetId', required: true, schema: { type: 'string' } },
			{ in: 'query', name: 'include', required: false, schema: { type: 'array', items: { type: 'string' } }, style: 'form', explode: true },
		]);
		const responses = operation.responses as Record<string, unknown>;
		expect(Object.keys(responses)).toEqual(['200', '404']);
	});



	it('rejects accessor-backed OpenAPI options without invoking getters', async () => {
		let reads = 0;
		const options = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(options, 'title', { enumerable: true, get() { reads++; return 'Unsafe'; } });
		Object.defineProperty(options, 'version', { value: '1', enumerable: true });
		await expect(endpoint.openapi(WidgetById, options as never)).rejects.toThrow('enumerable data property');
		expect(reads).toBe(0);
	});

	it('rejects accessor-backed and circular schema projections without executing getters', async () => {
		const Bare: StandardSchemaV1 = { '~standard': { version: 1, vendor: 'bare', validate: (value) => ({ value }) } };
		const UnsafeOutput = response.ok(Bare, { id: 'unsafe-schema', description: 'Unsafe schema.' });
		const UnsafeRoute = endpoint.get({ id: 'unsafe-schema.get', path: '/unsafe-schema', responses: [UnsafeOutput] });
		let reads = 0;
		const accessor = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(accessor, 'type', { enumerable: true, get() { reads++; return 'string'; } });
		await expect(endpoint.openapi(UnsafeRoute, { title: 'Unsafe', version: '1', schemaProjector: () => accessor }))
			.rejects.toThrow('data property');
		expect(reads).toBe(0);

		const circular: Record<string, unknown> = { type: 'object' };
		circular.self = circular;
		await expect(endpoint.openapi(UnsafeRoute, { title: 'Circular', version: '1', schemaProjector: () => circular }))
			.rejects.toThrow('circular references');
	});

	it('uses a configured schema projector and preserves advertised server origins', async () => {
		const Bare: StandardSchemaV1 = {
			'~standard': {
				version: 1,
				vendor: 'bare-test',
				validate: (value) => ({ value }),
			},
		};
		const Detail = response.ok(Bare, { id: 'bare:detail', description: 'Bare schema detail.' });
		const Get = endpoint.get({ id: 'bare.get', path: '/bare', query: Bare, responses: [Detail] });
		const purposes: string[] = [];
		const document = await endpoint.openapi(Get, {
			title: 'Bare',
			version: '1',
			servers: [{ url: 'https://api.example.com', description: 'Production' }],
			schemaProjector(_schema, { purpose }) {
				purposes.push(purpose);
				return purpose === 'request'
					? { type: 'object', properties: { q: { type: 'string' } } }
					: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] };
			},
		});
		const operation = document.paths['/bare']?.get as Readonly<Record<string, unknown>>;
		expect(operation.parameters).toEqual([{ in: 'query', name: 'q', required: false, schema: { type: 'string' } }]);
		const responses = operation.responses as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
		const content = responses['200']?.content as Readonly<Record<string, Readonly<Record<string, unknown>>>>;
		expect(content['application/json']?.schema).toEqual({
			type: 'object', properties: { id: { type: 'string' } }, required: ['id'],
		});
		expect(purposes).toEqual(['request', 'response']);
		expect(document.servers).toEqual([{ url: 'https://api.example.com', description: 'Production' }]);
	});

	it('documents paginated envelopes and isolated HTML responses as their actual wire bodies', async () => {
		const Page = response.paginated(Widget, {
			id: 'widgets:page',
			description: 'Widget page.',
			pagination: { links: 'both', totals: 'body' },
		});
		const Html = response.html({ id: 'widgets:html', description: 'Widget HTML.' });
		const List = endpoint.get({ id: 'widgets.list', path: '/widgets', responses: [Page] });
		const Human = endpoint.get({ id: 'widgets.human', path: '/widgets.html', responses: [Html] });
		const document = await endpoint.openapi([List, Human], { title: 'Widgets', version: '1' });
		type PageSchema = Readonly<{
			properties: Readonly<{
				data: object;
				meta: Readonly<{ properties: Readonly<{ pagination: Readonly<{ properties: Readonly<{ total: object }> }> }> }>;
				links: Readonly<{ properties: Readonly<{ next: object }> }>;
			}>;
		}>;
		type OpenApiResponse = Readonly<{ content: Readonly<Record<string, Readonly<{ schema: PageSchema | object }>>> }>;
		type OperationDocument = Readonly<{ responses: Readonly<Record<string, OpenApiResponse>> }>;
		const page = (document.paths['/widgets']?.get as OperationDocument).responses['200']!;
		const pageSchema = page.content['application/json']!.schema as PageSchema;
		expect(pageSchema.properties.data).toEqual({ type: 'array', items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } });
		expect(pageSchema.properties.meta.properties.pagination.properties.total).toEqual({ type: 'integer', minimum: 0 });
		expect(pageSchema.properties.links.properties.next).toEqual({ type: 'string', format: 'uri-reference' });
		const html = (document.paths['/widgets.html']?.get as OperationDocument).responses['200']!;
		expect(html.content['text/html; charset=utf-8']!.schema).toMatchObject({ type: 'string' });
	});

	it('rejects undocumented nested query serialization instead of claiming deep-object support', async () => {
		const NestedQuery = schema({
			type: 'object',
			properties: { filter: { type: 'object', properties: { status: { type: 'string' } } } },
		}, (value) => value as { filter?: { status?: string } });
		const Nested = endpoint.get({ id: 'widgets.nested', path: '/nested', query: NestedQuery, responses: [Detail] });
		await expect(endpoint.openapi(Nested, { title: 'Nested', version: '1' }))
			.rejects.toThrow('has no declared wire serialization');
	});

	it('rejects path schemas that do not exactly match the route template', async () => {
		const WrongPath = schema({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, (value) => value as { id: string });
		const wrong = endpoint.define({ id: 'widgets.wrong', path: '/:widgetId', param: WrongPath, operations: [GetWidget] });
		await expect(endpoint.openapi(wrong, { title: 'Wrong', version: '1' })).rejects.toThrow('does not match the route template');
	});
});
