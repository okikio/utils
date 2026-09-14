import { bench, do_not_optimize, run } from 'mitata';
import { matchPath } from './path.ts';
import { matchRoute, prepare, routeKey } from './router.ts';
import type { RoutePlanInput } from './types.ts';

const routeCount = 256;
const routes: RoutePlanInput[] = Array.from({ length: routeCount }, (_, index) => index % 4 === 0
	? Object.freeze({ kind: 'route' as const, method: 'GET', path: `/companies/${index}` })
	: Object.freeze({ kind: 'route' as const, method: index % 2 === 0 ? 'POST' : 'GET', path: `/groups/${index}/companies/:id` }));
const plan = prepare(routes);
const requests = Array.from({ length: 256 }, (_, index) => ({
	method: index % 3 === 0 ? 'POST' : 'GET',
	path: index % 5 === 0 ? `/companies/${(index * 4) % routeCount}` : `/groups/${index % routeCount}/companies/${index}`,
}));
type Match = (method: string, pathname: string) => string | undefined;
const prepared: Match = (method, pathname) => matchRoute(plan, method, pathname);
const reference: Match = (method, pathname) => {
	const route = linearMatch(routes, method, pathname);
	return route === undefined ? undefined : routeKey(route);
};
const expected = Object.freeze(requests.map((request) => reference(request.method, request.path)));

/** Keep the timed candidates honest before Mitata measures their equivalent request batch. */
function verify(): void {
	for (let index = 0; index < requests.length; index += 1) {
		const request = requests[index]!;
		if (prepared(request.method, request.path) !== expected[index]) {
			throw new Error(`Prepared route plan disagrees with the reference matcher for ${request.method} ${request.path}.`);
		}
	}
}

/** Match one complete fixed corpus so both candidates receive the same method/path distribution. */
function batch(match: Match): number {
	let total = 0;
	for (const request of requests) total += match(request.method, request.path)?.length ?? 0;
	return total;
}

verify();

bench('prepared HTTP route plan: 256 representative requests', () => {
	do_not_optimize(batch(prepared));
});

bench('linear reference matcher: 256 representative requests', () => {
	do_not_optimize(batch(reference));
});

await run();

/** Deliberately simple independent matcher used only as a performance baseline. */
function linearMatch(input: readonly RoutePlanInput[], method: string, pathname: string): RoutePlanInput | undefined {
	const normalized = method.toUpperCase();
	let fallback: RoutePlanInput | undefined;
	for (const route of input) {
		if (route.kind !== 'route' || !matchPath(route.path, pathname)) continue;
		if (route.method === normalized) return route;
		if (normalized === 'HEAD' && route.method === 'GET') fallback ??= route;
	}
	return fallback;
}
