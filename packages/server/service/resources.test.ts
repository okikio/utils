import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as endpoint from '@okikio/server/endpoint';
import * as middleware from '@okikio/server/middleware';
import * as response from '@okikio/http/response';
import * as resource from '@okikio/capability/resource';
import * as permissions from '@okikio/authz/permission';
import * as service from './mod.ts';
import { Message } from './fixtures/runtime.ts';

/** Create fresh exact definitions so tests can distinguish resource identity from diagnostic IDs. */
function authorityRuntime(checker: permissions.PermissionChecker, message = 'borrowed') {
	const Use = permissions.define({ id: 'runtime.envelope.use', description: 'Borrow the declared store.' });
	const Base = resource.define<{ readonly message: string }>()({
		id: 'runtime.envelope.base',
		description: 'Base dependency.',
	});
	const Store = resource.define<{ readonly message: string }>()({
		id: 'runtime.envelope.store',
		description: 'Store with per-borrow authority.',
		dependencies: { base: Base },
		requirements: [permissions.require(Use)],
	});
	const Borrow = middleware.define({
		id: 'runtime.envelope.borrow',
		description: 'Borrow in the current request.',
		resources: [Store],
	});
	const Read = endpoint.get({ id: 'runtime.envelope.read', path: '/read', resources: [Store], responses: [Message] });
	const Failures = service.observer.define({
		id: 'runtime.envelope.failures',
		description: 'Expose fixture faults to the test runner.',
		events: ['failed'],
	});
	const Definition = service.define({
		id: 'runtime.envelope',
		path: '/',
		endpoints: [Read],
		middleware: [middleware.afterValidation(Borrow)],
		observers: [Failures],
	});
	/** Construction count reveals value reuse; permission checks must still run for each borrow. */
	let creates = 0;
	/** Count endpoint entry separately so a denied borrow cannot appear to have run application work. */
	let calls = 0;
	const failures: NonNullable<service.ServiceObserverEvent['error']>[] = [];
	const runtime = service.create(
		service.compile(service.implement(Definition, {
			endpoints: [endpoint.handler(Read, async ({ resources }) => {
				calls++;
				return response.create(Message, await resources.get(Store));
			})],
			middleware: [middleware.handler(Borrow, async ({ resources }, next) => {
				await resources.get(Store);
				return await next();
			})],
			resources: resource.implementations(
				resource.implement(Base, { create: () => ({ message }) }),
				resource.implement(Store, {
					create: ({ dependencies }) => {
						creates++;
						return dependencies.base;
					},
				}),
			),
		})),
		{
			host: {},
			requestId: (request) => request.headers.get('x-actor')!,
			observers: [service.observer.handler(Failures, (event) => {
				if (event.error !== undefined) failures.push(event.error);
			})],
			adapters: { requirements: { interpreters: { permission: permissions.interpreter(checker) }, unknown: 'reject' } },
		},
	);
	return { runtime, Store, Borrow, counts: () => ({ creates, calls }), failures: () => failures };
}

describe('service resource authority', () => {
	it('checks each borrower after the service resource envelope and resource value are warm', async () => {
		const actors: string[] = [];
		const fixture = authorityRuntime({
			maximumChecks: 8,
			async check(ctx, requests) {
				actors.push(ctx.id);
				return requests.map(() => ({ allowed: ctx.id === 'alice' }));
			},
		});
		await using runtime = fixture.runtime;
		const allowed = await runtime.fetch(
			new Request('https://service.invalid/read', { headers: { 'x-actor': 'alice' } }),
		);
		expect(fixture.failures()).toEqual([]);
		expect(allowed.status).toBe(200);
		expect(await allowed.json()).toEqual({ message: 'borrowed' });
		const denied = await runtime.fetch(new Request('https://service.invalid/read', { headers: { 'x-actor': 'bob' } }));
		expect(denied.status).toBe(500);
		expect((await denied.json() as { type: string }).type).toBe('urn:utils:server:internal');
		expect(actors).toEqual(['alice', 'alice', 'bob']);
		expect(fixture.counts()).toEqual({ creates: 1, calls: 1 });
	});

	it('keeps concurrent borrower authority distinct while sharing definition envelopes', async () => {
		let entered!: () => void;
		const firstEntered = new Promise<void>((resolve) => {
			entered = resolve;
		});
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const checks: { readonly actor: string; readonly signal: AbortSignal }[] = [];
		const fixture = authorityRuntime({
			maximumChecks: 8,
			async check(ctx, requests) {
				checks.push({ actor: ctx.id, signal: ctx.signal });
				if (ctx.id === 'alice') {
					entered();
					await gate;
				}
				return requests.map(() => ({ allowed: ctx.id === 'alice' }));
			},
		});
		await using runtime = fixture.runtime;
		const observe = async (actor: string) => {
			const result = await runtime.fetch(
				new Request('https://service.invalid/read', { headers: { 'x-actor': actor } }),
			);
			return { status: result.status, body: await result.json() };
		};
		const alice = observe('alice');
		await firstEntered;
		const bob = observe('bob');
		release();
		const results = await Promise.allSettled([alice, bob]);
		expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
		const [allowed, denied] = results;
		if (allowed?.status !== 'fulfilled' || denied?.status !== 'fulfilled') throw new Error('Requests did not settle.');
		expect(allowed.value).toEqual({ status: 200, body: { message: 'borrowed' } });
		expect(denied.value.status).toBe(500);
		expect(checks.filter((check) => check.actor === 'alice')).toHaveLength(2);
		expect(checks.filter((check) => check.actor === 'bob')).toHaveLength(1);
		expect(checks.find((check) => check.actor === 'alice')?.signal).not.toBe(
			checks.find((check) => check.actor === 'bob')?.signal,
		);
		expect(fixture.counts()).toEqual({ creates: 1, calls: 1 });
	});

	it('does not merge same-ID resource or middleware definitions belonging to different runtime graphs', async () => {
		const checker: permissions.PermissionChecker = {
			maximumChecks: 8,
			async check(_ctx, requests) {
				return requests.map(() => ({ allowed: true }));
			},
		};
		const first = authorityRuntime(checker, 'first');
		const second = authorityRuntime(checker, 'second');
		await using left = first.runtime;
		await using right = second.runtime;
		expect(first.Store.id).toBe(second.Store.id);
		expect(first.Store).not.toBe(second.Store);
		expect(first.Borrow.id).toBe(second.Borrow.id);
		expect(first.Borrow).not.toBe(second.Borrow);
		const request = () => new Request('https://service.invalid/read', { headers: { 'x-actor': 'alice' } });
		expect(await (await left.fetch(request())).json()).toEqual({ message: 'first' });
		expect(await (await right.fetch(request())).json()).toEqual({ message: 'second' });
		expect(await (await left.fetch(request())).json()).toEqual({ message: 'first' });
		expect(first.counts()).toEqual({ creates: 1, calls: 2 });
		expect(second.counts()).toEqual({ creates: 1, calls: 1 });
	});

	it('rejects undeclared resources before acquisition even when another operation owns their implementation', async () => {
		const Allowed = resource.define<{ readonly message: string }>()({
			id: 'runtime.allowed',
			description: 'Allowed resource.',
		});
		const Foreign = resource.define<{ readonly message: string }>()({
			id: 'runtime.foreign',
			description: 'Another operation resource.',
		});
		const Borrow = middleware.define({
			id: 'runtime.envelope.boundary',
			description: 'Test the middleware resource boundary.',
			resources: [Allowed],
		});
		const Read = endpoint.get({
			id: 'runtime.allowed.read',
			path: '/allowed',
			resources: [Allowed],
			responses: [Message],
			middleware: [Borrow],
		});
		const Other = endpoint.get({
			id: 'runtime.foreign.read',
			path: '/foreign',
			resources: [Foreign],
			responses: [Message],
		});
		let foreignCreates = 0;
		const Definition = service.define({ id: 'runtime.boundary', path: '/', endpoints: [Read, Other] });
		await using runtime = service.create(
			service.compile(service.implement(Definition, {
				endpoints: [
					endpoint.handler(Read, async ({ resources }) => {
						expect(resources.has(Foreign)).toBe(false);
						await expect(resources.get(Foreign)).rejects.toBeInstanceOf(TypeError);
						return response.create(Message, await resources.get(Allowed));
					}),
					endpoint.handler(Other, async ({ resources }) => response.create(Message, await resources.get(Foreign))),
				],
				middleware: [middleware.handler(Borrow, async ({ resources }, next) => {
					// @ts-expect-error Undeclared resources are rejected statically and at runtime.
					expect(resources.has(Foreign)).toBe(false);
					// @ts-expect-error A different resource ID cannot grant access.
					await expect(resources.get(Foreign)).rejects.toBeInstanceOf(TypeError);
					return await next();
				})],
				resources: resource.implementations(
					resource.implement(Allowed, { create: () => ({ message: 'allowed' }) }),
					resource.implement(Foreign, {
						create: () => {
							foreignCreates++;
							return { message: 'foreign' };
						},
					}),
				),
			})),
			{ host: {} },
		);
		for (let attempt = 0; attempt < 2; attempt++) {
			const result = await runtime.fetch(new Request('https://service.invalid/allowed'));
			expect(result.status).toBe(200);
			expect(await result.json()).toEqual({ message: 'allowed' });
		}
		expect(foreignCreates).toBe(0);
		const owned = await runtime.fetch(new Request('https://service.invalid/foreign'));
		expect(owned.status).toBe(200);
		expect(await owned.json()).toEqual({ message: 'foreign' });
		expect(foreignCreates).toBe(1);
	});
});
