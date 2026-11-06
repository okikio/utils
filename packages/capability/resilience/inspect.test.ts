import { it } from 'node:test';
import { expect } from '@std/expect';
import * as resilience from './mod.ts';
it('reports absent/competing/wrong-boundary ownership without claiming live enforcement', () => {
	const policies = [
		resilience.timeout({ seconds: 1 }),
		resilience.retry({ jitter: false }),
		resilience.bulkhead({ concurrency: 2 }),
	];
	const report = resilience.inspect(policies, [{ type: 'timeout', owner: 'server', id: 'request-deadline' }, {
		type: 'retry',
		owner: 'server',
		id: 'wrong-boundary',
	}], { maximumPolicies: 3, maximumOwners: 2, safety: 'safe' });
	expect(report.valid).toBe(true);
	expect(report.policies.map((row) => row.outcome)).toEqual(['claimed', 'wrong-owner', 'missing']);
	const duplicate = resilience.inspect([policies[1]!], [{ type: 'retry', owner: 'adapter', id: 'one' }, {
		type: 'retry',
		owner: 'adapter',
		id: 'two',
	}], { maximumPolicies: 1, maximumOwners: 2, safety: 'unsafe' });
	expect(duplicate.valid).toBe(false);
	expect(duplicate.issues).toContain('unsafe-retry');
	expect(duplicate.policies[0]?.outcome).toBe('conflicting');
	expect(() => resilience.inspect(policies, [], { maximumPolicies: 2, maximumOwners: 0 })).toThrow(RangeError);
});
