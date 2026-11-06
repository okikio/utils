import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as endpoint from '@okikio/server/endpoint';
import * as query from '@okikio/query';
import * as response from '@okikio/http/response';
import * as resource from '@okikio/capability/resource';
import * as service from './mod.ts';
import { Message, MessageSchema, schema } from './fixtures/runtime.ts';

describe('service response materialization', () => {
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
			query: endpoint.input(PageQuery, { jsonSchema: PageQuery.wireSchema() }),
			responses: [Page],
		});
		const definition = service.define({ id: 'pages', path: '/', endpoints: [List] });
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(List, async ({ input }) => {
					if (input.query.pagination.kind !== 'cursor') throw new TypeError('Expected cursor pagination.');
					return response.create(Page, {
						kind: 'cursor',
						items: [{ message: 'first' }],
						...(input.query.pagination.cursor !== undefined ? { cursor: input.query.pagination.cursor } : {}),
						limit: input.query.pagination.limit,
						hasMore: true,
						nextCursor: 'next-page',
					});
				})],
				resources: resource.implementations(),
			})),
			{ host: Object.freeze({}) },
		);

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
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(Cookies, async () =>
					response.create(Message, { message: 'ok' }, {
						headers: [
							['Set-Cookie', 'access=one; Path=/; HttpOnly'],
							['Set-Cookie', 'refresh=two; Path=/; HttpOnly'],
						],
					}))],
				resources: resource.implementations(),
			})),
			{ host: Object.freeze({}) },
		);

		const result = await runtime.fetch(new Request('http://localhost/cookies'));
		const cookies = (result.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
		expect(cookies).toEqual([
			'access=one; Path=/; HttpOnly',
			'refresh=two; Path=/; HttpOnly',
		]);
	});

	it('materializes a declared conditional 304 without a response body', async () => {
		const Cached = response.ok(MessageSchema, { id: 'runtime.cached', description: 'Cached message.' });
		const NotModified = response.notModified({ id: 'runtime.not-modified' });
		const Read = endpoint.get({ id: 'runtime.read-cached', path: '/cached', responses: [Cached, NotModified] });
		const definition = service.define({ id: 'cached', path: '/', endpoints: [Read] });
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(Read, async () =>
					response.create(Cached, { message: 'cached' }, {
						headers: { ETag: '"version-1"', 'Cache-Control': 'private, max-age=0' },
					}))],
				resources: resource.implementations(),
			})),
			{ host: Object.freeze({}) },
		);
		const result = await runtime.fetch(
			new Request('http://localhost/cached', {
				headers: { 'If-None-Match': 'W/"version-1"' },
			}),
		);
		expect(result.status).toBe(304);
		expect(result.headers.get('etag')).toBe('"version-1"');
		expect(await result.text()).toBe('');
	});

	it('returns declared 406 and 415 problems for representation negotiation failures', async () => {
		const Create = endpoint.post({
			id: 'runtime.create-json',
			path: '/json',
			json: MessageSchema,
			responses: [Message],
		});
		const definition = service.define({ id: 'formats', path: '/', endpoints: [Create] });
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(Create, async ({ input }) => response.create(Message, input.json))],
				resources: resource.implementations(),
			})),
			{ host: Object.freeze({}) },
		);
		const unsupported = await runtime.fetch(
			new Request('http://localhost/json', {
				method: 'POST',
				headers: { 'Content-Type': 'text/plain' },
				body: 'hello',
			}),
		);
		expect(unsupported.status).toBe(415);
		const missing = await runtime.fetch(
			new Request('http://localhost/json', {
				method: 'POST',
				body: new Uint8Array(new TextEncoder().encode('{"message":"hello"}')),
			}),
		);
		expect(missing.status).toBe(415);
		const structured = await runtime.fetch(
			new Request('http://localhost/json', {
				method: 'POST',
				headers: { 'Content-Type': 'application/vnd.kaiju+json', Accept: 'application/json' },
				body: '{"message":"hello"}',
			}),
		);
		expect(structured.status).toBe(200);
		expect(structured.headers.get('vary')).toBe('Accept');
		const unacceptable = await runtime.fetch(
			new Request('http://localhost/json', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'application/xml' },
				body: '{"message":"hello"}',
			}),
		);
		expect(unacceptable.status).toBe(406);
		expect(unacceptable.headers.get('content-type')).toContain('application/problem+json');
		expect(unacceptable.headers.get('vary')).toBe('Accept');
	});

	it('encodes consecutive async-iterable text chunks as Web Response bytes without dropping yields', async () => {
		const Html = response.html({ id: 'runtime:stream-html', description: 'Streaming HTML.' });
		const Stream = endpoint.get({ id: 'runtime.stream-html', path: '/stream-html', responses: [Html] });
		async function* content() {
			yield 'one';
			yield 'two';
			yield 'three';
		}
		const definition = service.define({ id: 'stream-html-runtime', path: '/', endpoints: [Stream] });
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(Stream, async () => response.create(Html, content()))],
				resources: resource.implementations(),
			})),
			{ host: Object.freeze({}) },
		);
		const result = await runtime.fetch(new Request('http://localhost/stream-html'));
		expect(result.status).toBe(200);
		expect(await result.text()).toBe('onetwothree');
	});
});
