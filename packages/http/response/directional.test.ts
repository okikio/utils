import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as schema from '@okikio/schema';
import { DateSchema } from '@okikio/schema/time';
import * as response from './mod.ts';

describe('directional response preparation', () => {
	it('serializes the validated object and leaves handler-owned data untouched', async () => {
		const contract = schema.object({ id: schema.string() }, { unknownKeys: 'strip' });
		const definition = response.ok(contract, { description: 'Public item.' });
		const source = { id: 'item', privateToken: 'secret' };
		const logical = response.create(definition, source);
		const checked = await response.prepare(logical);
		expect(checked[0]).toEqual({ id: 'item' });
		expect(logical[0]).toBe(source);
		expect(source.privateToken).toBe('secret');
		expect(response.definitionOf(checked)).toBe(definition);
	});

	it('accepts ordinary schema input and applies a non-idempotent transform exactly once', async () => {
		let calls = 0;
		const contract = schema.transform(schema.string(), (value) => {
			calls++;
			return { length: value.length };
		});
		const definition = response.ok(contract, { description: 'Measured input.' });
		const materialized = await response.materialize(response.create(definition, 'hello'));
		expect(materialized.body).toEqual({ length: 5 });
		expect(calls).toBe(1);
	});

	it('uses an explicit codec encoder for application values', async () => {
		const definition = response.ok(DateSchema, { description: 'Current time.' });
		const checked = await response.prepare(response.create(definition, new Date('2026-01-02T03:04:05Z')));
		expect(checked[0]).toBe('2026-01-02T03:04:05.000Z');
	});

	it('validates and transforms every page item, preserving indexed issue paths', async () => {
		const contract = schema.object({ id: schema.string() }, { unknownKeys: 'strip' });
		const definition = response.define({
			id: 'page',
			status: 200,
			description: 'Items.',
			mode: 'page',
			schema: contract,
		});
		const source = { kind: 'offset' as const, offset: 0, limit: 2, hasMore: false, items: [{ id: 'a', secret: true }] };
		const checked = await response.prepare(response.create(definition, source));
		expect(checked[0].items).toEqual([{ id: 'a' }]);
		expect(source.items[0]!.secret).toBe(true);
		const invalid = response.create(definition, { ...source, items: [{ id: 1 }, { id: 2 }] } as never);
		const [failure] = await Promise.allSettled([response.prepare(invalid)]);
		if (failure!.status !== 'rejected') throw new Error('Invalid page items were admitted.');
		if (!(failure.reason instanceof schema.SchemaValidationError)) throw failure.reason;
		expect(failure.reason.issues.map((issue) => issue.path)).toEqual([['items', 0, 'id'], ['items', 1, 'id']]);
	});
});
