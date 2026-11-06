import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import * as telemetry from '@okikio/telemetry/instrument';
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';
import * as service from './mod.ts';

const numeric: StandardSchemaV1<string, number> & StandardJSONSchemaV1<string, number> = {
	'~standard': {
		version: 1,
		vendor: 'fixture',
		validate: (value) =>
			typeof value === 'string' && /^\d+$/.test(value)
				? { value: Number(value) }
				: { issues: [{ message: 'Expected numeric text.' }] },
		jsonSchema: { input: () => ({ type: 'string', pattern: '^\\d+$' }), output: () => ({ type: 'number' }) },
	},
};
const textual: StandardSchemaV1<number, string> & StandardJSONSchemaV1<number, string> = {
	'~standard': {
		version: 1,
		vendor: 'fixture',
		validate: (value) =>
			typeof value === 'number' && Number.isFinite(value)
				? { value: String(value) }
				: { issues: [{ message: 'Expected finite number.' }] },
		jsonSchema: { input: () => ({ type: 'number' }), output: () => ({ type: 'string' }) },
	},
};

describe('service response direction and body ownership', () => {
	it('serializes sanitized response output and reads JSON without a Request clone', async () => {
		const output = response.ok(schema.object({ id: schema.string() }, { unknownKeys: 'strip' }), {
			id: 'public',
			description: 'Public item.',
		});
		const operation = endpoint.post({
			id: 'public.post',
			path: '/public',
			json: schema.object({ id: schema.string() }),
			responses: [output],
		});
		const definition = service.define({ id: 'sanitized', path: '/', endpoints: [operation] });
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(operation, ({ input }) => {
					const value = { id: input.json.id, secret: 'private' };
					return response.create(output, value);
				})],
			})),
			{ host: {} },
		);
		class OwnedRequest extends Request {
			override clone(): Request {
				throw new Error('Unowned clone');
			}
		}
		const result = await runtime.fetch(
			new OwnedRequest('https://service.invalid/public', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"id":"a"}',
			}),
		);
		expect(result.status).toBe(200);
		expect(await result.json()).toEqual({ id: 'a' });
	});

	it('transforms page items once and documents the actual item output', async () => {
		const output = response.paginated(numeric, { id: 'numbers', description: 'Numeric results.' });
		const operation = endpoint.get({ id: 'numbers.get', path: '/numbers', responses: [output] });
		const definition = service.define({ id: 'numbers', path: '/', endpoints: [operation] });
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [
					endpoint.handler(
						operation,
						() => response.create(output, { kind: 'offset', items: ['12', '34'], offset: 0, limit: 2, hasMore: false }),
					),
				],
			})),
			{ host: {} },
		);
		const result = await runtime.fetch(new Request('https://service.invalid/numbers'));
		expect(result.status).toBe(200);
		expect(await result.json()).toMatchObject({ data: [12, 34] });
		const document = await endpoint.openapi([operation], { title: 'Numbers', version: '1' });
		expect(document.paths['/numbers']!.get).toMatchObject({
			responses: {
				'200': { content: { 'application/json': { schema: { properties: { data: { items: { type: 'number' } } } } } } },
			},
		});
	});

	it('encodes application values and documents the encoder output', async () => {
		const output = response.ok(codec.define({ decode: numeric, encode: textual }), {
			id: 'encoded',
			description: 'Encoded numeric result.',
		});
		const operation = endpoint.get({ id: 'encoded.get', path: '/encoded', responses: [output] });
		const definition = service.define({ id: 'encoded', path: '/', endpoints: [operation] });
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(operation, () => response.create(output, 12))],
			})),
			{ host: {} },
		);
		const result = await runtime.fetch(new Request('https://service.invalid/encoded'));
		expect(result.status).toBe(200);
		expect(await result.json()).toBe('12');
		const document = await endpoint.openapi([operation], { title: 'Encoded', version: '1' });
		expect(document.paths['/encoded']!.get).toMatchObject({
			responses: { '200': { content: { 'application/json': { schema: { type: 'string' } } } } },
		});
	});

	it('rejects invalid response values and reports handled failure to the supplied instrument', async () => {
		let calls = 0;
		const failures: unknown[] = [];
		const instrument: telemetry.Instrument = {
			...telemetry.noop,
			span(_name, _fields, action) {
				calls++;
				return action({
					fail: (reason) => {
						failures.push(reason);
					},
				});
			},
		};
		const output = response.ok(schema.string(), { id: 'invalid', description: 'Text result.' });
		const operation = endpoint.get({ id: 'invalid.get', path: '/invalid', responses: [output] });
		const definition = service.define({ id: 'invalid', path: '/', endpoints: [operation] });
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [endpoint.handler(operation, () => response.create(output, 42 as never))],
			})),
			{ host: {}, instrument },
		);
		const result = await runtime.fetch(new Request('https://service.invalid/invalid'));
		expect(result.status).toBe(500);
		expect(calls).toBe(1);
		expect(failures).toHaveLength(1);
		expect(await result.text()).not.toContain('42');
	});
});

describe('JSON response representation', () => {
	it('preserves JSON null and never invokes an undeclared toJSON conversion', async () => {
		let conversions = 0;
		const Null = response.ok(schema.literal(null), { id: 'null', description: 'JSON null.' });
		const Opaque = response.ok(schema.unknown(), { id: 'opaque', description: 'Opaque application value.' });
		const NullRoute = endpoint.get({ id: 'null.get', path: '/null', responses: [Null] });
		const OpaqueRoute = endpoint.get({ id: 'opaque.get', path: '/opaque', responses: [Opaque] });
		const definition = service.define({ id: 'json-representation', path: '/', endpoints: [NullRoute, OpaqueRoute] });
		await using runtime = service.create(
			service.compile(service.implement(definition, {
				endpoints: [
					endpoint.handler(NullRoute, () => response.create(Null, null)),
					endpoint.handler(OpaqueRoute, () =>
						response.create(Opaque, {
							toJSON() {
								conversions++;
								return 'unexpected';
							},
						})),
				],
			})),
			{ host: {} },
		);
		const accepted = await runtime.fetch(new Request('https://service.invalid/null'));
		expect(accepted.headers.get('content-type')).toBe('application/json');
		expect(await accepted.text()).toBe('null');
		const rejected = await runtime.fetch(new Request('https://service.invalid/opaque'));
		expect(rejected.status).toBe(500);
		expect(conversions).toBe(0);
	});
});
