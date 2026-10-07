import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import { inspectExpression, type QueryExpression } from './mod.ts';

/** Domain-owned leaf used to prove the generic expression utility stays leaf-agnostic. */
type Leaf = Readonly<{ kind: 'criterion'; id: string }>;

/** Distinguish the test leaf from generic Boolean expression nodes. */
const isLeaf = (value: QueryExpression<Leaf>): value is Leaf => value.kind === 'criterion';

describe('query Boolean expressions', () => {
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
