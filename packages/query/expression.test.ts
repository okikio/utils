import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import { inspectExpression, type QueryExpression } from './mod.ts';
import { all, any, evaluate, not } from './expression.ts';

/** Domain-owned leaf used to prove the generic expression utility stays leaf-agnostic. */
type Leaf = Readonly<{ kind: 'criterion'; id: string }>;

/** Distinguish the test leaf from generic Boolean expression nodes. */
const isLeaf = (value: QueryExpression<Leaf>): value is Leaf => value.kind === 'criterion';

describe('query Boolean expressions', () => {
	it('composes generic leaves and evaluates them with authored short-circuit order', () => {
		const expression = all(any('Ada', 'Lin'), not('Removed'));
		const visited: string[] = [];
		const matched = evaluate(expression, (value): value is string => typeof value === 'string', (name) => {
			visited.push(name);
			return name === 'Ada';
		});
		expect(matched).toBe(true);
		expect(visited).toEqual(['Ada', 'Removed']);
	});

	it('checks cycles and budgets before evaluating caller comparisons', () => {
		const cyclic: { kind: 'not'; filter?: unknown } = { kind: 'not' };
		cyclic.filter = cyclic;
		let calls = 0;
		expect(() =>
			Reflect.apply(evaluate, undefined, [cyclic, () => false, () => {
				calls++;
				return true;
			}])
		).toThrow('acyclic');
		expect(calls).toBe(0);
		expect(() =>
			inspectExpression(all('a', 'b'), (value): value is string => typeof value === 'string', undefined, {
				maximumLeaves: 1,
			})
		).toThrow(RangeError);
		expect(() => Reflect.apply(all, undefined, [])).toThrow(TypeError);
	});
	it('measures nested ALL / ANY / NOT composition and preserves leaf paths', () => {
		const value: QueryExpression<Leaf> = {
			kind: 'all',
			filters: [
				{ kind: 'criterion', id: 'company-size' },
				{
					kind: 'any',
					filters: [
						{ kind: 'criterion', id: 'magento' },
						{ kind: 'not', filter: { kind: 'criterion', id: 'agency' } },
					],
				},
			],
		};
		const visits: Array<{ id: string; path: readonly PropertyKey[] }> = [];

		const inspection = inspectExpression(value, isLeaf, ({ leaf, path }) => {
			visits.push({ id: leaf.id, path });
		});

		expect(inspection).toEqual({ maximumDepth: 4, leafCount: 3, maximumSiblings: 2 });
		expect(visits).toEqual([
			{ id: 'company-size', path: ['filters', 0] },
			{ id: 'magento', path: ['filters', 1, 'filters', 0] },
			{ id: 'agency', path: ['filters', 1, 'filters', 1, 'filter'] },
		]);
	});

	it('does not require the generic layer to understand leaf semantics', () => {
		const value: QueryExpression<Leaf> = { kind: 'criterion', id: 'organization.employee_count' };
		expect(inspectExpression(value, isLeaf)).toEqual({
			maximumDepth: 1,
			leafCount: 1,
			maximumSiblings: 0,
		});
	});
});
