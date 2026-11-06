import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as schema from './mod.ts';
import * as codec from './codec/mod.ts';

describe('owned schema selection and issue evidence', () => {
	it('keeps optional fields and strip/preserve/reject policy across pick/omit', async () => {
		const BaseSchema = schema.object({ id: schema.string(), count: schema.optional(schema.number()) }, {
			unknownKeys: 'strip',
		});
		expect(await schema.parse(schema.pick(BaseSchema, ['id']), { id: 'asset', count: 'ignored' })).toEqual({
			id: 'asset',
		});
		expect(await schema.parse(schema.omit(BaseSchema, ['id']), {})).toEqual({});
		await expect(schema.parse(schema.pick(schema.object({ id: schema.string() }), ['id']), { id: 'a', other: 1 }))
			.rejects.toBeInstanceOf(schema.SchemaValidationError);
	});
	it('caps issue count and path evidence without relabeling vendor defects', async () => {
		const Definition = schema.define(() => {
			throw new schema.SchemaValidationError([{ message: 'first', path: ['a', 'b'] }, { message: 'second' }]);
		});
		const report = await schema.validate(Definition, {}, { maximumIssues: 1, maximumPathLength: 1 });
		expect(report).toEqual({ issues: [{ message: 'first', path: ['a'] }], truncated: true });
		const defect = new Error('vendor');
		await expect(schema.validate(
			schema.define(() => {
				throw defect;
			}),
			{},
		)).rejects.toBe(defect);
	});
});

describe('bidirectional structural codecs', () => {
	const NumberCodec = codec.define({
		decode: schema.transform(schema.string(), Number),
		encode: schema.transform(schema.number(), String),
	});
	it('round trips tuples and prefixes invalid child paths', async () => {
		const PairCodec = codec.tuple([NumberCodec, codec.identity(schema.boolean())]);
		expect(await codec.decode(PairCodec, ['42', true])).toEqual([42, true]);
		expect(await codec.encode(PairCodec, [42, true])).toEqual(['42', true]);
		await expect(codec.decode(PairCodec, ['42'])).rejects.toBeInstanceOf(schema.SchemaValidationError);
		const result = await schema.validate(PairCodec.decode, ['42', 'wrong']);
		expect(result.issues?.[0]?.path).toEqual([1]);
	});
	it('rejects transformed record-key collisions, excess entries and unsafe tuples', async () => {
		const KeyCodec = codec.define({
			decode: schema.transform(schema.string(), (key) => key.toLowerCase()),
			encode: schema.string(),
		});
		const RecordCodec = codec.record(KeyCodec, NumberCodec, { maximumEntries: 2 });
		expect(await codec.decode(RecordCodec, { a: '1' })).toEqual({ a: 1 });
		expect(await codec.encode(RecordCodec, { a: 1 })).toEqual({ a: '1' });
		await expect(codec.decode(RecordCodec, { A: '1', a: '2' })).rejects.toBeInstanceOf(schema.SchemaValidationError);
		await expect(codec.decode(RecordCodec, { a: '1', b: '2', c: '3' })).rejects.toBeInstanceOf(
			schema.SchemaValidationError,
		);
		let read = false;
		const unsafe = Object.defineProperty([1], '0', {
			get() {
				read = true;
				return 1;
			},
		});
		await expect(codec.decode(codec.tuple([NumberCodec]), unsafe)).rejects.toBeInstanceOf(schema.SchemaValidationError);
		expect(read).toBe(false);
	});
	it('runs exactly one selected branch per direction and propagates async rejection', async () => {
		let calls = 0;
		const BranchCodec = codec.define({
			decode: schema.defineAsync(() => {
				calls++;
				return { kind: 'application' };
			}),
			encode: schema.define(() => {
				calls++;
				return { kind: 'wire' };
			}),
		});
		const Definition = codec.discriminated('kind', { wire: BranchCodec }, {
			decode: () => 'wire',
			encode: () => 'wire',
		});
		expect(await codec.decode(Definition, { kind: 'wire' })).toEqual({ kind: 'application' });
		expect(await codec.encode(Definition, { kind: 'application' })).toEqual({ kind: 'wire' });
		expect(calls).toBe(2);
		await expect(codec.decode(codec.discriminated('kind', { wire: BranchCodec }), { kind: 'absent' })).rejects
			.toBeInstanceOf(schema.SchemaValidationError);
		const defect = new Error('async vendor');
		const Broken = codec.define({
			decode: schema.defineAsync(() => {
				throw defect;
			}),
			encode: schema.string(),
		});
		await expect(codec.decode(codec.tuple([Broken]), ['x'])).rejects.toBe(defect);
	});
});

it('bounds native aggregate accumulation and skips later siblings after a known rejection fills the report', async () => {
	let visits = 0;
	const CountedSchema = schema.refine(schema.unknown(), () => {
		visits++;
		return false;
	}, 'invalid');
	const ListSchema = schema.array(schema.object({ value: CountedSchema }));
	const result = await schema.validate(ListSchema, Array.from({ length: 10000 }, () => ({ value: 0 })), {
		maximumIssues: 2,
		maximumPathLength: 1,
	});
	expect(result.issues?.map((issue) => issue.path)).toEqual([[0], [1]]);
	expect(result.issues === undefined ? false : result.truncated).toBe(true);
	expect(visits).toBe(2);
	// Failure evidence from an earlier branch cannot make a later valid branch reject.
	const UnionSchema = schema.union([ListSchema, schema.array(schema.unknown())]);
	const accepted = await schema.validate(UnionSchema, [{ value: 0 }, { value: 1 }], { maximumIssues: 1 });
	expect(accepted.issues).toBeUndefined();
	const outer = schema.object({ choice: UnionSchema, other: schema.number() });
	const report = await schema.validate(outer, { choice: [{ value: 0 }, { value: 1 }], other: 'bad' }, {
		maximumIssues: 1,
	});
	expect(report.issues === undefined ? undefined : report.truncated).toBeUndefined();
	expect(report.issues?.[0]?.path).toEqual(['other']);
});
it('keeps native invocation budgets independent during reentrant validation and leaves opaque callbacks outside its accounting', async () => {
	const InnerSchema = schema.array(schema.number());
	let inner = 0;
	const OuterSchema = schema.array(schema.refine(schema.unknown(), () => {
		inner += InnerSchema['~standard'].validate(['bad', 'bad', 'bad'], { maximumIssues: 1 }).issues!.length;
		return false;
	}, 'outer'));
	const result = await schema.validate(OuterSchema, [1, 2, 3, 4], { maximumIssues: 2 });
	expect(result.issues).toHaveLength(2);
	expect(inner).toBe(2);
	expect(OuterSchema['~standard'].validate([1, 2, 3]).issues).toHaveLength(3);
});
