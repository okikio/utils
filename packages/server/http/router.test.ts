/** Independent generated routing oracle protects prefix partitioning and specificity. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { matchRoute, prepareRoutes } from '@okikio/server/http';
import type { RoutePlanInput } from '@okikio/server/http';

/** A simple full scan: compare literals and nonempty parameters, then lexicographic literal precedence. */
function reference(routes: readonly RoutePlanInput[], method: string, path: string): string | undefined {
	const actual = path === '/' ? [] : path.slice(1).split('/');
	const scan = (selectedMethod: string): string | undefined => {
		let chosen: { route: Extract<RoutePlanInput, { kind: 'route' }>; flags: number[] } | undefined;
		for (const route of routes) {
			if (route.kind !== 'route' || route.method !== selectedMethod) continue;
			const parts = route.path === '/' ? [] : route.path.slice(1).split('/');
			if (parts.length !== actual.length) continue;
			if (!parts.every((part, index) => part[0] === ':' ? actual[index] !== '' : part === actual[index])) continue;
			const flags = parts.map((part) => part[0] === ':' ? 0 : 1);
			const differing = chosen === undefined ? -1 : flags.findIndex((flag, index) => flag !== chosen!.flags[index]);
			if (chosen === undefined || (differing !== -1 && flags[differing]! > chosen.flags[differing]!)) {
				chosen = { route, flags };
			}
		}
		return chosen === undefined ? undefined : `${chosen.route.method} ${chosen.route.path}`;
	};
	return scan(method) ?? (method === 'HEAD' ? scan('GET') : undefined);
}

describe('prepared prefix routing', () => {
	it('preserves literal precedence across generic and nested prefixes and rejects empty parameters', () => {
		const routes: Extract<RoutePlanInput, { kind: 'route' }>[] = [
			{ kind: 'route', method: 'GET', path: '/:root/fixed/:id' },
			{ kind: 'route', method: 'GET', path: '/groups/:group/:id' },
			{ kind: 'route', method: 'GET', path: '/groups/42/:id' },
			{ kind: 'route', method: 'POST', path: '/groups/42/:id' },
			{ kind: 'route', method: 'GET', path: '/groups/42/current' },
		];
		for (let index = 0; index < 64; index++) {
			routes.push({ kind: 'route', method: 'GET', path: `/groups/${index}/:id` });
		}
		// Avoid duplicate shapes for the hand-authored literal 42 route.
		const distinct = routes.filter((route, index) =>
			routes.findIndex((value) => value.path === route.path && value.method === route.method) === index
		);
		const paths = [
			'/groups/fixed/work',
			'/other/fixed/work',
			'/groups/42/current',
			'/groups/42/',
			'/groups//work',
			'/groups/42/work/',
		];
		for (let index = 0; index < 70; index++) paths.push(`/groups/${index}/work`);
		for (const ordered of [distinct, [...distinct].reverse()]) {
			const plan = prepareRoutes(ordered);
			for (const method of ['GET', 'HEAD', 'POST', 'DELETE']) {
				for (const path of paths) expect(matchRoute(plan, method, path)).toBe(reference(ordered, method, path));
			}
		}
	});
});
