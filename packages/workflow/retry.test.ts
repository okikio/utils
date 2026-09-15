import { expect } from '@std/expect';
import * as fc from 'fast-check';
import { describe, it } from 'node:test';

import * as retry from './retry.ts';

describe('workflow retry values', () => {
	it('derives repeatable bounded jitter from arbitrary instruction identities', () => {
		fc.assert(fc.property(fc.string(), (identity) => {
			const value = retry.unit(identity);
			expect(retry.unit(identity)).toBe(value);
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(1);
		}), { numRuns: 500 });
	});
});
