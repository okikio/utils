import { it } from 'node:test';
import { expect } from '@std/expect';
import * as router from './router.ts';
import * as http from './mod.ts';

it('reports overlap witnesses through actual route/mount/HEAD precedence without invoking handlers', async () => {
	const routes = [
		http.route('GET', '/items/:id', () => new Response('dynamic')),
		http.route('GET', '/items/new', () => new Response('static')),
		http.route('HEAD', '/items/:item', () => new Response('head')),
		http.mount('/items', () => new Response('mount')),
		http.mount('/', () => new Response('root')),
	];
	const plan = router.prepare(routes);
	const evidence = router.inspect(plan, { maximumRoutes: 5, maximumComparisons: 10, maximumOverlaps: 10 });
	expect(evidence.capped).toBe(false);
	expect(evidence.comparisons).toBe(10);
	const app = http.create({ routes, plan });
	for (const entry of evidence.overlaps) {
		expect(router.matchRoute(plan, entry.method, entry.path) ?? router.matchMount(plan, entry.path)).toBe(entry.winner);
		if (entry.method === 'GET' && entry.path === '/items/new') {
			expect(await (await app.fetch(new Request(`https://local.invalid${entry.path}`))).text()).toBe('static');
		}
		if (entry.method === 'HEAD') expect(entry.winner).toBe('HEAD /items/:item');
	}
	expect(evidence.overlaps.some((entry) => entry.winner === 'GET /items/new')).toBe(true);
	expect(router.inspect(plan, { maximumRoutes: 5, maximumComparisons: 0, maximumOverlaps: 10 }).capped).toBe(true);
	expect(router.inspect(plan, { maximumRoutes: 5, maximumComparisons: 10, maximumOverlaps: 0 }).capped).toBe(true);
	expect(() => router.inspect(plan, { maximumRoutes: 4, maximumComparisons: 10, maximumOverlaps: 10 })).toThrow(
		RangeError,
	);
});

it('preserves slash and mount-boundary distinctions and validates duplicate shapes through prepare', () => {
	const plan = router.prepare([{ kind: 'route', method: 'GET', path: '/api/:name/' }, {
		kind: 'route',
		method: 'GET',
		path: '/api/:name',
	}, { kind: 'mount', path: '/apiv2' }]);
	expect(router.inspect(plan, { maximumRoutes: 3, maximumComparisons: 3, maximumOverlaps: 3 }).overlaps).toEqual([]);
	expect(() =>
		router.prepare([{ kind: 'route', method: 'get', path: '/a/:x' }, { kind: 'route', method: 'GET', path: '/a/:y' }])
	).toThrow(TypeError);
});
