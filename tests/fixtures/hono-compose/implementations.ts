/** Public HTTP adapters; neither imports nor reconstructs Hono's private composer. @module */
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { compose, create, route } from '@okikio/server/http';
import type { Handler, Middleware } from '@okikio/server/http';

export type Candidate = 'hono' | 'utils';
export interface Scope {
	readonly request: Request;
	readonly identity: object;
	readonly arr: number[];
	readonly called: boolean[];
	readonly identities: object[];
	log?: string;
	xxx?: string;
	zzz?: string;
	val: number;
	terminalCalls: number;
}
export type Layer = (scope: Scope, next: () => Response | Promise<Response>) => Response | Promise<Response>;
export type Terminal = (scope: Scope) => Response | Promise<Response>;
export interface Fixture {
	fetch(request: Request): Promise<Response>;
	scope(request: Request): Scope;
}

/** Keep fixture observations per request; middleware still runs in each library's real dispatcher. */
export function fixture(
	candidate: Candidate,
	layers: readonly Layer[],
	terminal: Terminal = () => new Response('Hello'),
): Fixture {
	const scopes = new WeakMap<Request, Scope>();
	const scope = (request: Request, identity: object): Scope => {
		let value = scopes.get(request);
		if (value === undefined) {
			value = { request, identity, arr: [], called: [], identities: [], val: 0, terminalCalls: 0 };
			scopes.set(request, value);
		}
		return value;
	};
	let fetch: Fixture['fetch'];
	if (candidate === 'hono') {
		const app = new Hono();
		// Rethrowing makes downstream error ownership visible to upstream middleware,
		// matching the upstream private-compose tests that omit an onError callback.
		app.onError((error) => {
			throw error;
		});
		for (const layer of layers) {
			app.use('*', async (context, next) => {
				const value = scope(context.req.raw, context);
				value.identities.push(context);
				const result = await layer(value, async () => {
					await next();
					return context.res;
				});
				// Hono response replacement is explicit Context assignment; Utils middleware
				// returns its replacement. Keep that protocol adaptation visible here.
				context.res = result;
				return result;
			});
		}
		app.all('*', (context) => {
			const value = scope(context.req.raw, context);
			value.terminalCalls += 1;
			value.identities.push(context);
			return terminal(value);
		});
		fetch = async (request) => await app.fetch(request);
	} else {
		const middleware: Middleware[] = layers.map((layer) => (request, next) => {
			const value = scope(request, request);
			value.identities.push(request);
			return layer(value, () => next(request));
		});
		const handler: Handler = (request) => {
			const value = scope(request, request);
			value.terminalCalls += 1;
			value.identities.push(request);
			return terminal(value);
		};
		const app = create({ routes: [route('GET', '/', handler)], middleware });
		fetch = async (request) => await app.fetch(request);
	}
	return {
		fetch,
		scope(request) {
			const value = scopes.get(request);
			if (value === undefined) throw new Error('Request did not enter the middleware fixture.');
			return value;
		},
	};
}

/** Use real nested public composition: mounted Hono routes and Utils terminal-wrapping middleware. */
export function nested(candidate: Candidate): Fixture {
	const values = new WeakMap<Request, Scope>();
	const scope = (request: Request): Scope => {
		let value = values.get(request);
		if (value === undefined) {
			value = {
				request,
				identity: request,
				arr: [],
				called: [],
				identities: [],
				val: 0,
				terminalCalls: 0,
			};
			values.set(request, value);
		}
		return value;
	};
	let fetch: Fixture['fetch'];
	if (candidate === 'hono') {
		const app = new Hono();
		const child = new Hono();
		child.use('*', (context, next) => {
			scope(context.req.raw).arr.push(1);
			return next();
		});
		child.use('*', (context, next) => {
			scope(context.req.raw).arr.push(2);
			return next();
		});
		app.route('/', child);
		app.use('*', (context, next) => {
			scope(context.req.raw).arr.push(3);
			return next();
		});
		app.get('/', (context) => context.text('Hello'));
		fetch = async (request) => await app.fetch(request);
	} else {
		const first: Middleware = (request, next) => {
			scope(request).arr.push(1);
			return next(request);
		};
		const second: Middleware = (request, next) => {
			scope(request).arr.push(2);
			return next(request);
		};
		const group: Middleware = (request, next) => compose(next, [first, second])(request);
		const third: Middleware = (request, next) => {
			scope(request).arr.push(3);
			return next(request);
		};
		const app = create({ routes: [route('GET', '/', () => new Response('Hello'))], middleware: [group, third] });
		fetch = async (request) => await app.fetch(request);
	}
	return { fetch, scope: (request) => scope(request) };
}

/** Register caller-owned arrays once; later mutation must not change that registration. */
export function snapshot(
	candidate: Candidate,
): { readonly fetch: Fixture['fetch']; readonly unchanged: boolean; readonly calls: number[] } {
	const calls: number[] = [];
	if (candidate === 'hono') {
		const first: MiddlewareHandler = (_context, next) => {
			calls.push(1);
			return next();
		};
		const input: MiddlewareHandler[] = [first];
		const app = new Hono();
		app.use('*', ...input);
		const unchanged = input.length === 1 && input[0] === first;
		input[0] = (_context, next) => {
			calls.push(99);
			return next();
		};
		input.push((_context, next) => {
			calls.push(100);
			return next();
		});
		app.get('/', (context) => context.text('Hello'));
		return { fetch: async (request) => await app.fetch(request), unchanged, calls };
	}
	const first: Middleware = (request, next) => {
		calls.push(1);
		return next(request);
	};
	const input: Middleware[] = [first];
	const handler = compose(() => new Response('Hello'), input);
	const unchanged = input.length === 1 && input[0] === first;
	input[0] = (request, next) => {
		calls.push(99);
		return next(request);
	};
	input.push((request, next) => {
		calls.push(100);
		return next(request);
	});
	const app = create({ routes: [route('GET', '/', handler)] });
	return { fetch: async (request) => await app.fetch(request), unchanged, calls };
}

/** Record the libraries' actual next return values, without a promise-producing adapter. */
export function promiseContinuations(
	candidate: Candidate,
): { readonly fetch: Fixture['fetch']; readonly promises: unknown[] } {
	const promises: unknown[] = [];
	if (candidate === 'hono') {
		const app = new Hono();
		for (let index = 0; index < 5; index += 1) {
			app.use('*', (_context, next) => {
				const pending = next();
				promises.push(pending);
				return pending;
			});
		}
		app.get('/', async (context) => context.text('Hello'));
		return { fetch: async (request) => await app.fetch(request), promises };
	}
	const middleware: Middleware[] = Array.from({ length: 5 }, () => (request, next) => {
		const pending = next(request);
		promises.push(pending);
		return pending;
	});
	const app = create({ routes: [route('GET', '/', async () => new Response('Hello'))], middleware });
	return { fetch: async (request) => await app.fetch(request), promises };
}
