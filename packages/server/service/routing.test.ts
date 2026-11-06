import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';
import * as resource from '@okikio/capability/resource';
import * as service from './mod.ts';
import { Message, schema } from './fixtures/runtime.ts';

describe('service route exposure', () => {
	it('exposes exact routes and returns the framework not-found problem outside them', async () => {
		const Ping = endpoint.get({ id: 'runtime.route', path: '/ping', responses: [Message] });
		const definition = service.define({ id: 'route', path: '/api', endpoints: [Ping] });
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(Ping, async () => response.create(Message, { message: 'pong' }))],
				resources: resource.implementations(),
			})),
			{ host: Object.freeze({}) },
		);

		expect(runtime.routes.map(({ method, path }) => ({ method, path }))).toEqual([{
			method: 'GET',
			path: '/api/ping',
		}]);
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
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [
					endpoint.handler(Item, async () => response.create(Message, { message: 'dynamic' })),
					endpoint.handler(Current, async () => response.create(Message, { message: 'static' })),
				],
				resources: resource.implementations(),
			})),
			{ host: Object.freeze({}) },
		);

		expect(runtime.routes.map(({ method, path }) => `${method} ${path}`)).toEqual([
			'GET /api/items/me',
			'GET /api/items/:id',
		]);
	});

	it('serves isolated one-off HTML routes without changing the Solid renderer', async () => {
		const Html = response.html({ id: 'runtime:html', description: 'One-off HTML response.' });
		const Callback = endpoint.get({ id: 'runtime.callback', path: '/callback', responses: [Html] });
		const definition = service.define({ id: 'callback', path: '/', endpoints: [Callback] });
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(Callback, async () => response.create(Html, '<!doctype html><p>Complete</p>'))],
				resources: resource.implementations(),
			})),
			{ host: Object.freeze({}) },
		);

		const result = await runtime.fetch(new Request('http://localhost/callback'));
		expect(result.headers.get('content-type')).toContain('text/html');
		expect(await result.text()).toContain('<p>Complete</p>');
	});
});
