import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as schema from '@okikio/schema';
import * as query from '@okikio/query';
import * as expression from '@okikio/query/expression';

/** Recognize Boolean facts independently of the expression nodes around them. */
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/** Use the shared binary call shape for the truth matrix; arity tests remain separate. */
const builders: Record<
	'and' | 'or' | 'nor' | 'none' | 'nand' | 'xor' | 'xnor',
	<Leaf>(left: Leaf, right: Leaf) => query.QueryBooleanExpression<query.QueryExpressionLeaf<Leaf>>
> = {
	and: query.and,
	or: query.or,
	nor: query.nor,
	none: query.none,
	nand: query.nand,
	xor: query.xor,
	xnor: query.xnor,
};

/** Each expected column is written independently of the builders' lowered trees. */
const rows = [
	{ left: false, right: false, and: false, or: false, nor: true, nand: true, xor: false, xnor: true },
	{ left: false, right: true, and: false, or: true, nor: false, nand: true, xor: true, xnor: false },
	{ left: true, right: false, and: false, or: true, nor: false, nand: true, xor: true, xnor: false },
	{ left: true, right: true, and: true, or: true, nor: false, nand: false, xor: false, xnor: true },
] as const;

describe('conventional Boolean query builders', () => {
	it('exports the same builders through the root and expression entrypoints', () => {
		expect(query.and).toBe(query.all);
		expect(query.or).toBe(query.any);
		expect(query.none).toBe(query.nor);
		for (const name of ['and', 'or', 'none', 'nor', 'nand', 'xor', 'xnor'] as const) {
			expect(query[name]).toBe(expression[name]);
		}
	});

	for (const row of rows) {
		it(`matches every Boolean operator for ${row.left}, ${row.right}`, () => {
			for (const name of ['and', 'or', 'nor', 'nand', 'xor', 'xnor'] as const) {
				const tree = builders[name](row.left, row.right);
				expect(expression.evaluate(tree, isBoolean, (fact) => fact)).toBe(row[name]);
			}
			expect(expression.evaluate(query.none(row.left, row.right), isBoolean, (fact) => fact)).toBe(row.nor);
		});
	}

	it('supports one or many inverted conditions while rejecting empty groups', () => {
		for (const build of [query.nor, query.nand, query.none]) {
			expect(() => Reflect.apply(build, undefined, [])).toThrow(TypeError);
			expect(expression.evaluate(build(false), isBoolean, (fact) => fact)).toBe(true);
			expect(expression.evaluate(build(true), isBoolean, (fact) => fact)).toBe(false);
		}
		expect(expression.evaluate(query.nor(false, false, true), isBoolean, (fact) => fact)).toBe(false);
		expect(expression.evaluate(query.nand(true, true, false), isBoolean, (fact) => fact)).toBe(true);
	});

	it('rejects non-binary exclusive calls even from JavaScript', () => {
		for (const build of [query.xor, query.xnor]) {
			for (const args of [[], [true], [true, false, true]]) {
				expect(() => Reflect.apply(build, undefined, args)).toThrow('exactly two');
			}
		}
		// Arity counts arguments, not their values. A domain can use undefined as a fact.
		const tree = query.xnor(undefined, undefined);
		expect(expression.evaluate(tree, (value): value is undefined => value === undefined, () => true)).toBe(true);
	});

	it('copies authored group lists and borrows the original leaf objects', () => {
		const first = { active: true };
		const second = { active: false };
		const inputs: [typeof first, typeof second] = [first, second];
		const tree = query.none(...inputs);
		inputs.push({ active: true });
		const seen: unknown[] = [];
		const inspection = expression.inspectExpression(
			tree,
			(value): value is typeof first => typeof value === 'object' && value !== null && 'active' in value,
			({ leaf }) => seen.push(leaf),
		);
		expect(inspection.leafCount).toBe(2);
		expect(seen[0]).toBe(first);
		expect(seen[1]).toBe(second);
	});

	it('counts expanded exclusive occurrences and checks limits before comparisons', () => {
		const tree = query.xor(false, true);
		expect(expression.inspectExpression(tree, isBoolean)).toEqual({
			maximumDepth: 4,
			leafCount: 4,
			maximumSiblings: 2,
		});
		let comparisons = 0;
		expect(() =>
			expression.evaluate(tree, isBoolean, () => {
				comparisons++;
				return true;
			}, {
				maximumLeaves: 3,
			})
		).toThrow(RangeError);
		expect(comparisons).toBe(0);
		expect(() =>
			expression.inspectExpression(query.xnor(false, true), isBoolean, undefined, {
				maximumDepth: 4,
			})
		).toThrow(RangeError);
	});

	it('preserves authored short-circuit order and validates skipped branches', () => {
		const visits: string[] = [];
		const tree = query.xor('left', 'right');
		const isName = (value: unknown): value is string => typeof value === 'string';
		expect(expression.evaluate(tree, isName, (name) => {
			visits.push(name);
			return name === 'right';
		})).toBe(true);
		expect(visits).toEqual(['left', 'left', 'right']);

		const cyclic: { kind: 'not'; filter?: unknown } = { kind: 'not' };
		cyclic.filter = cyclic;
		let comparisons = 0;
		expect(() =>
			expression.evaluate(query.or(true, cyclic), isBoolean, () => {
				comparisons++;
				return true;
			})
		).toThrow('acyclic');
		expect(comparisons).toBe(0);
	});
});

describe('Boolean builders in a checked collection request', () => {
	const Search = query.define({
		fields: { name: query.field(schema.string()) },
		filters: { name: [query.eq] },
		expressions: ['all', 'any', 'not'],
		pagination: query.offset(),
	});

	for (const name of ['and', 'or', 'nor', 'none', 'nand', 'xor', 'xnor'] as const) {
		it(`validates and round-trips ${name} using the existing wire vocabulary`, async () => {
			const left = Search.condition('name', 'eq', 'Ada');
			const right = Search.condition('name', 'eq', 'Lin');
			const value = await Search.create({ filter: builders[name](left, right) });
			expect(await Search.parse(Search.encode(value))).toEqual(value);
			expect(query.normalize(query.normalize(value))).toEqual(query.normalize(value));
			expect(query.stringify(Search, value)).toBe(query.stringify(Search, await Search.parse(Search.encode(value))));
		});
	}

	it('requires the existing underlying expression permissions', async () => {
		const OnlyAnd = query.define({
			fields: Search.fields,
			filters: { name: [query.eq] },
			pagination: query.offset(),
		});
		const left = OnlyAnd.condition('name', 'eq', 'Ada');
		const right = OnlyAnd.condition('name', 'eq', 'Lin');
		for (const build of [query.nor, query.none, query.nand, query.xor, query.xnor]) {
			expect((await OnlyAnd.safeCreate({ filter: build(left, right) })).success).toBe(false);
		}
		expect((await OnlyAnd.safeCreate({ filter: query.and(left, right) })).success).toBe(true);
	});

	it('keeps adapter requirements in the existing expression vocabulary', async () => {
		const WithoutOr = query.define({
			fields: Search.fields,
			filters: { name: [query.eq] },
			expressions: ['all', 'not'],
			pagination: query.offset(),
		});
		const leaf = WithoutOr.condition('name', 'eq', 'Ada');
		expect((await WithoutOr.safeCreate({ filter: query.nand(leaf, leaf) })).success).toBe(true);
		expect((await WithoutOr.safeCreate({ filter: query.nor(leaf, leaf) })).success).toBe(false);
		expect(query.requirements(Search).expressions).toEqual(['all', 'any', 'not']);
		const capabilities = { operators: 'all', pagination: ['offset'], fieldSelection: ['simple'] } as const;
		expect(Search.validateAdapter({ ...capabilities, expressions: ['all', 'any', 'not'] }).valid).toBe(true);
		const incomplete = Search.validateAdapter({ ...capabilities, expressions: ['all', 'not'] });
		expect(incomplete.valid).toBe(false);
		if (!incomplete.valid) expect(incomplete.issues.map((issue) => issue.code)).toEqual(['unsupported-expression']);
	});

	it('charges repeated exclusive conditions against the collection filter budget', async () => {
		const Small = query.define({
			fields: Search.fields,
			filters: { name: [query.eq] },
			expressions: ['all', 'any', 'not'],
			pagination: query.offset(),
			maximumFilters: 3,
		});
		const leaf = Small.condition('name', 'eq', 'Ada');
		expect((await Small.safeCreate({ filter: query.xor(leaf, leaf) })).success).toBe(false);
	});

	it('keeps conjunction as a checked AND-only reader, separate from expression builders', async () => {
		const left = Search.condition('name', 'eq', 'Ada');
		const right = Search.condition('name', 'eq', 'Lin');
		const value = await Search.create({ filter: query.and(left, query.all(right)) });
		const conditions = query.conjunction(value.filter);
		expect(conditions).toEqual([left, right]);
		expect(Object.isFrozen(conditions)).toBe(true);
		expect(query.conjunction(undefined)).toEqual([]);
		for (const build of [query.or, query.nor, query.nand, query.xor, query.xnor]) {
			expect(query.conjunction((await Search.create({ filter: build(left, right) })).filter)).toBeUndefined();
		}
	});
});
