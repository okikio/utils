import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';

import * as response from '@okikio/http/response';
import * as resource from '@okikio/resource';
import * as endpoint from '@okikio/server/endpoint';
import * as service from '@okikio/server/service';

/** Build the smallest Standard Schema value needed by service/OpenAPI scenario fixtures. */
function schema<Output>(jsonSchema: Readonly<Record<string, unknown>>): StandardSchemaV1<unknown, Output> & StandardJSONSchemaV1<unknown, Output> {
	return Object.freeze({
		'~standard': Object.freeze({
			version: 1 as const,
			vendor: 'scenario',
			validate(value: unknown) {
				return { value: value as Output };
			},
			jsonSchema: Object.freeze({ input: () => jsonSchema, output: () => jsonSchema }),
		}),
	});
}

/** Provider-neutral catalog response schema. */
const CatalogSchema = schema<Readonly<{ available: boolean }>>({
	type: 'object',
	properties: { available: { type: 'boolean' } },
	required: ['available'],
});
/** Provider execution response schema. */
const ExecutionSchema = schema<Readonly<{ generation: number }>>({
	type: 'object',
	properties: { generation: { type: 'integer' } },
	required: ['generation'],
});
/** Public response that must stay usable without acquiring the optional provider. */
const CatalogResponse = response.ok(CatalogSchema, {
	id: 'scenario:provider-catalog',
	description: 'Provider-neutral public capability metadata.',
});
/** Response emitted only after the optional provider is acquired. */
const ExecutionResponse = response.ok(ExecutionSchema, {
	id: 'scenario:provider-execution',
	description: 'Result from an operation that actually requires the optional provider.',
});
/** Optional runtime provider used to verify lazy resource acquisition. */
const Provider = resource.define<Readonly<{ generation: number }>>()({
	id: 'scenario.optional-provider',
	description: 'Optional provider acquired only by the operation that needs it.',
});
/** Provider-neutral public endpoint. */
const Catalog = endpoint.get({
	id: 'scenario.provider-catalog',
	path: '/catalog',
	responses: [CatalogResponse],
});
/** Endpoint that explicitly requires the optional provider. */
const Execute = endpoint.post({
	id: 'scenario.provider-execute',
	path: '/execute',
	resources: [Provider],
	responses: [ExecutionResponse],
});
/** Service definition shared by all provider-isolation assertions. */
const Diagnostics = service.observer.define({
	id: 'scenario-provider-diagnostics',
	description: 'Observe provider acquisition failures without exposing their details to clients.',
	events: ['failed'],
});
const Definition = service.define({
	id: 'scenario-provider-surface',
	path: '/api',
	endpoints: [Catalog, Execute],
	observers: [Diagnostics],
});

test('service contracts keep optional providers lazy and isolate failed acquisition', async () => {
	let acquisitions = 0;
	const failures: Error[] = [];
	const ProviderImplementation = resource.implement(Provider, {
		create() {
			acquisitions += 1;
			if (acquisitions === 1) throw new Error('optional provider configuration is unavailable');
			return Object.freeze({ generation: acquisitions });
		},
	});
	const compiled = service.compile(service.implement(Definition, {
		endpoints: [
			endpoint.handler(Catalog, () => response.create(CatalogResponse, { available: true })),
			endpoint.handler(Execute, async ({ resources }) => {
				const provider = await resources.get(Provider);
				return response.create(ExecutionResponse, { generation: provider.generation });
			}),
		],
		resources: resource.implementations(ProviderImplementation),
	}));

	assert.equal(acquisitions, 0);
	const document = await service.openapi(compiled, { title: 'Provider scenario', version: '1.0.0' });
	assert.ok(document.paths['/api/catalog']);
	assert.ok(document.paths['/api/execute']);
	assert.equal(acquisitions, 0);

	await using runtime = service.create(compiled, {
		host: Object.freeze({}),
		observers: [service.observer.handler(Diagnostics, (event) => {
			if (event.error !== undefined) failures.push(new Error(event.error.message));
		})],
	});
	assert.equal(acquisitions, 0);

	const catalogBefore = await runtime.fetch(new Request('https://service.invalid/api/catalog'));
	assert.equal(catalogBefore.status, 200);
	assert.deepEqual(await catalogBefore.json(), { available: true });
	assert.equal(acquisitions, 0);

	const failed = await runtime.fetch(new Request('https://service.invalid/api/execute', { method: 'POST' }));
	assert.equal(failed.status, 500);
	assert.equal(acquisitions, 1);
	assert.equal(JSON.stringify(await failed.json()).includes('provider configuration'), false);
	assert.equal(failures.some((error) => error.message.includes('provider configuration')), true);

	const catalogAfter = await runtime.fetch(new Request('https://service.invalid/api/catalog'));
	assert.equal(catalogAfter.status, 200);
	assert.deepEqual(await catalogAfter.json(), { available: true });
	assert.equal(acquisitions, 1);

	const recovered = await runtime.fetch(new Request('https://service.invalid/api/execute', { method: 'POST' }));
	assert.equal(recovered.status, 200);
	assert.deepEqual(await recovered.json(), { generation: 2 });
	assert.equal(acquisitions, 2);
});
