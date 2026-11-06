import type { StandardSchemaV1 } from '@standard-schema/spec';
import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as endpoint from '@okikio/server/endpoint';

import { define } from './definition.ts';
import { route, routePath, routes } from './route.ts';

/** Small route-parameter contract used to exercise group and service path composition. */
const ParamSchema = Object.freeze({
	'~standard': Object.freeze({
		version: 1 as const,
		vendor: 'service-route-test',
		validate(value: unknown) {
			return { value: value as { itemId: string } };
		},
	}),
}) satisfies StandardSchemaV1<unknown, { itemId: string }>;

/** Nested endpoint used to prove callers do not need to copy service or group prefixes. */
const Item = endpoint.get({ id: 'test.item', path: '/:itemId', param: ParamSchema });

/** Multi-method endpoint used to prove operation selection is explicit when required. */
const Collection = endpoint.define({
	id: 'test.collection',
	path: '/',
	operations: [
		endpoint.operation.get({ id: 'test.collection.list' }),
		endpoint.operation.post({ id: 'test.collection.create' }),
	],
});

/** Import-safe test service with the same nested route mechanics used by real services. */
const Service = define({
	id: 'test',
	path: '/api/v1',
	endpoints: [endpoint.group({ id: 'test.items', path: '/items', endpoints: [Item, Collection] })],
});

describe('service routes', () => {
	it('derives the full route from imported service and endpoint definitions', () => {
		const item = route(Service, Item);
		expect(item.method).toBe('get');
		expect(item.path).toBe('/api/v1/items/:itemId');
		expect(routePath(item, { itemId: 'a/b' })).toBe('/api/v1/items/a%2Fb');
	});

	it('requires an explicit method for a multi-method endpoint', () => {
		expect(() => route(Service, Collection)).toThrow('several HTTP methods');
		expect(route(Service, Collection, 'post').method).toBe('post');
	});

	it('rejects missing and unknown route parameters', () => {
		const item = route(Service, Item);
		expect(() => routePath(item)).toThrow('requires parameter');
		expect(() => routePath(item, { itemId: 'one', other: 'two' })).toThrow('has no parameter');
	});

	it('keeps one route inventory for compilers and first-party callers', () => {
		expect(routes(Service).map((candidate) => `${candidate.method} ${candidate.path}`)).toEqual([
			'get /api/v1/items/:itemId',
			'get /api/v1/items',
			'post /api/v1/items',
		]);
	});
});
