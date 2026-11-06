import { joinPath, pathParameters } from '@okikio/server/endpoint/path';
import type { EndpointDefinition, EndpointEntry, EndpointGroup, EndpointMethod } from '@okikio/server/endpoint';

import type { ServiceDefinition, ServiceRoute } from './types.ts';

/** Primitive value accepted for one authored route parameter. */
export type ServiceRouteParam = string | number | bigint | boolean;

/** Values used to fill one HTTP route template. */
export type ServiceRouteParams = Readonly<Record<string, ServiceRouteParam>>;

/**
 * Return the exact route graph represented by one import-safe service definition.
 *
 * Gateway compilation, runtime validation, and first-party clients use this same
 * graph so a service path or endpoint-group prefix is never copied into callers.
 */
export function routes(definition: ServiceDefinition): readonly ServiceRoute[] {
	const result: ServiceRoute[] = [];
	/** Carry authored prefixes and group provenance; selections choose leaves without adding another prefix. */
	const walk = (
		entries: readonly EndpointEntry[],
		prefix: string,
		groups: readonly EndpointGroup[],
	): void => {
		for (const entry of entries) {
			if (entry.kind === 'endpoint') {
				const routePath = joinPath(prefix, entry.path);
				for (const operation of entry.operations) {
					result.push(Object.freeze({
						id: `${definition.id}:${operation.id}:${operation.method}`,
						service: definition,
						endpoint: entry,
						operation,
						groups: Object.freeze([...groups]),
						method: operation.method,
						path: routePath,
					}));
				}
				continue;
			}
			if (entry.kind === 'endpoint-group-selection') {
				walk(entry.endpoints, prefix, groups);
				continue;
			}
			walk(entry.endpoints, joinPath(prefix, entry.path), [...groups, entry]);
		}
	};
	walk(definition.endpoints, definition.path, []);
	return Object.freeze(result);
}

/**
 * Resolve one exact endpoint object to its single service route.
 *
 * Multi-method endpoints must name a method because the endpoint object alone is
 * not enough to identify one HTTP operation.
 */
export function route(
	definition: ServiceDefinition,
	endpoint: EndpointDefinition,
	method?: EndpointMethod,
): ServiceRoute {
	const matches = routes(definition).filter((candidate) =>
		candidate.endpoint === endpoint && (method === undefined || candidate.method === method)
	);
	if (matches.length === 0) {
		throw new TypeError(`Endpoint ${JSON.stringify(endpoint.id)} is not a ${definition.id} service route.`);
	}
	if (matches.length > 1) {
		throw new TypeError(`Endpoint ${JSON.stringify(endpoint.id)} has several HTTP methods; select one explicitly.`);
	}
	return matches[0]!;
}

/** Fill the parameters on one compiled route and URL-encode every supplied value. */
export function routePath(route: ServiceRoute, params: ServiceRouteParams = {}): string {
	const names = pathParameters(route.path);
	const expected = new Set(names);
	for (const name of Object.keys(params)) {
		if (!expected.has(name)) {
			throw new TypeError(`Route ${JSON.stringify(route.id)} has no parameter ${JSON.stringify(name)}.`);
		}
	}
	for (const name of names) {
		if (!Object.hasOwn(params, name)) {
			throw new TypeError(`Route ${JSON.stringify(route.id)} requires parameter ${JSON.stringify(name)}.`);
		}
	}
	return route.path.replace(/:([A-Za-z0-9_]+)/g, (_token, name: string) => encodeURIComponent(String(params[name]!)));
}
