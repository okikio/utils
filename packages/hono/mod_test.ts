import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import { Hono } from 'hono';

import * as endpoint from '@okikio/server/endpoint';
import * as http from '@okikio/server/http';
import * as response from '@okikio/http/response';
import * as resource from '@okikio/resource';
import * as service from '@okikio/server/service';
import * as hono from './mod.ts';

const Message = response.ok({
	'~standard': {
		version: 1 as const,
		vendor: 'test',
		validate(value: unknown) {
			return typeof value === 'object' && value !== null && typeof (value as { message?: unknown }).message === 'string'
				? { value }
				: { issues: [{ message: 'Expected message.' }] };
		},
	},
}, { id: 'hono:message', description: 'Hono adapter test response.' });

/** Create one tiny compiled service used by Hono adapter tests. */
function createRuntime(): service.ServiceRuntime {
	const Ping = endpoint.get({ id: 'hono.ping', path: '/ping', responses: [Message] });
	const Item = endpoint.get({ id: 'hono.item', path: '/items/:id', responses: [Message] });
	const Current = endpoint.get({ id: 'hono.current', path: '/items/me', responses: [Message] });
	const definition = service.define({ id: 'hono', path: '/api', endpoints: [Ping, Item, Current] });
	return service.create(service.compile(service.implement(definition, {
		endpoints: [
			endpoint.handler(Ping, async () => response.create(Message, { message: 'pong' })),
			endpoint.handler(Item, async () => response.create(Message, { message: 'dynamic' })),
			endpoint.handler(Current, async () => response.create(Message, { message: 'static' })),
		],
		resources: resource.implementations(),
	})), { host: Object.freeze({}) });
}

describe('Hono server adapter', () => {
	it('mounts compiled routes beside native Hono routes', async () => {
		await using runtime = createRuntime();
		const app = new Hono();
		app.get('/health', (ctx) => ctx.text('ok'));
		hono.mount(app, runtime);

		expect(await (await app.request('/health')).text()).toBe('ok');
		expect(await (await app.request('/api/ping')).json()).toEqual({ message: 'pong' });
	});

	it('keeps static-route precedence aligned with the framework-neutral runtime', async () => {
		await using runtime = createRuntime();
		const native = await runtime.fetch(new Request('http://localhost/api/items/me'));
		const app = new Hono();
		hono.mount(app, runtime);
		const adapted = await app.request('/api/items/me');
		expect(await native.json()).toEqual({ message: 'static' });
		expect(await adapted.json()).toEqual({ message: 'static' });
	});

	it('reuses generic HTTP middleware around Hono fetch', async () => {
		const app = new Hono();
		app.get('/hello', (ctx) => ctx.json({ hello: true }));
		const fetch = hono.fetch(app, [http.securityHeaders(), http.timing()]);
		const result = await fetch(new Request('http://localhost/hello'));
		expect(result.headers.get('x-content-type-options')).toBe('nosniff');
		expect(result.headers.get('server-timing')).toContain('total;dur=');
	});

	it('maps Hono-native exceptions through the shared error policy', async () => {
		const app = new Hono();
		app.onError(hono.catchErrors());
		app.get('/fault', () => {
			throw new Error('Do not expose this message.');
		});
		const result = await app.request('/fault');
		expect(result.status).toBe(500);
		expect(await result.json()).toEqual({
			type: 'https://api.example.invalid/problems/internal',
			title: 'Internal server error',
			status: 500,
			instance: '/fault',
		});
	});
});
