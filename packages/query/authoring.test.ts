import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import * as query from './mod.ts';
import * as parameters from './parameters.ts';

/** One searchable directory contract used from typed callers and HTTP parameters. */
const Search = query.define({
	fields: {
		id: query.field(schema.string(), { sortable: true }),
		name: query.field(schema.string()),
		score: query.field(schema.number()),
	},
	filters: { name: [query.eq, query.in], score: [query.gte, query.between] },
	expressions: ['all', 'any', 'not'],
	order: [query.asc('id', { tiebreaker: true })],
	pagination: query.offset({ defaultLimit: 20 }),
});

describe('typed query authoring', () => {
	it('validates a typed expression and preserves it through a URL round trip', async () => {
		const authored = await Search.create({
			filter: query.any(Search.condition('name', 'in', ['a,b', '', '雪']), Search.condition('score', 'gte', 90)),
			pagination: { kind: 'offset', limit: 2, offset: 4 },
			fields: ['name', 'score'],
		});
		const url = new URL('https://example.test/people');
		url.search = parameters.encode(Search, authored).toString();
		expect(await parameters.parse(Search, url)).toEqual(authored);
		expect(authored.pagination).toEqual({ kind: 'offset', limit: 2, offset: 4, source: 'offset' });
	});

	it('applies the same defaults and limits to programmatic and wire callers', async () => {
		expect(await Search.create()).toEqual(await Search.parse({}));
		const result = await Search.safeCreate({ pagination: { kind: 'page', page: 2, limit: 10 } });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.value.pagination).toEqual({ kind: 'offset', source: 'page', page: 2, offset: 10, limit: 10 });
		}
		const tooLarge = await Search.safeCreate({ pagination: { kind: 'offset', limit: 1000 } });
		expect(tooLarge.success).toBe(false);
		if (!tooLarge.success) expect(tooLarge.issues[0]?.code).toBe('invalid-limit');
	});

	it('does not invoke getters or recurse through cyclic authored expressions', async () => {
		let reads = 0;
		const accessor = Object.defineProperty({}, 'filter', {
			enumerable: true,
			get() {
				reads++;
				return null;
			},
		});
		const rejected = await Reflect.apply(Search.safeCreate, Search, [accessor]);
		expect(rejected.success).toBe(false);
		expect(reads).toBe(0);
		const cyclic: { kind: 'not'; filter?: unknown } = { kind: 'not' };
		cyclic.filter = cyclic;
		const result = await Reflect.apply(Search.safeCreate, Search, [{ filter: cyclic }]);
		expect(result.success).toBe(false);
		expect(result.issues[0].code).toBe('invalid-expression');
	});

	it('retains runtime permission and operand-arity checks for JavaScript callers', async () => {
		const unsupported = await Reflect.apply(Search.safeCreate, Search, [{
			filter: { field: 'score', operator: 'eq', value: 1 },
		}]);
		expect(unsupported.success).toBe(false);
		expect(unsupported.issues[0].code).toBe('unknown-operator');
		const shortRange = await Reflect.apply(Search.safeCreate, Search, [{
			filter: { field: 'score', operator: 'between', value: [1] },
		}]);
		expect(shortRange.success).toBe(false);
		expect(shortRange.issues[0].code).toBe('invalid-value');
		expect(() => Reflect.apply(Search.condition, Search, ['name', 'eq', 'Ada', 'Lin'])).toThrow(TypeError);
	});

	it('uses an explicit synchronous inverse for transformed fields', async () => {
		const Converted = query.define({
			fields: {
				score: query.field(schema.transform(schema.string(), Number), {
					encode: String,
					outputJsonSchema: { type: 'number' },
				}),
			},
			filters: { score: [query.gte, query.between] },
			pagination: query.offset(),
		});
		const value = await Converted.create({ filter: Converted.condition('score', 'between', ['10', '20']) });
		expect(query.conjunction(value.filter)?.[0]?.value).toEqual([10, 20]);
		expect(await Converted.parse(Converted.encode(value))).toEqual(value);
	});

	it('reuses the owned codec directions without inventing another codec contract', async () => {
		const Score = codec.define({
			decode: schema.transform(schema.string(), Number),
			encode: schema.transform(schema.number(), String),
		});
		const Converted = query.define({
			fields: { score: query.field(Score, { outputJsonSchema: { type: 'number' } }) },
			filters: { score: [query.gte] },
			pagination: query.offset(),
		});
		const value = await Converted.create({ filter: Converted.condition('score', 'gte', '12') });
		expect(query.conjunction(value.filter)?.[0]?.value).toBe(12);
		expect(await Converted.parse(Converted.encode(value))).toEqual(value);
	});

	it('rejects an asynchronous codec encoder in the synchronous URL contract', async () => {
		const Score = codec.define({ decode: schema.string(), encode: schema.defineAsync(async (value) => String(value)) });
		const Converted = query.define({
			fields: { score: query.field(Score) },
			filters: { score: [query.eq] },
			pagination: query.offset(),
		});
		const value = await Converted.create({ filter: Converted.condition('score', 'eq', '12') });
		expect(() => Converted.encode(value)).toThrow('synchronously');
	});
});
