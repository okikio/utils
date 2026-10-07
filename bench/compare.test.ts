import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { compare, complete, workloads } from './compare.ts';

describe('paired benchmark interpretation', () => {
	it('rejects omitted whole workload pairs, repeated candidates and unknown measurements', () => {
		const aliases = workloads.flatMap((name) => [`Utils: ${name}`, `Hono: ${name}`]);
		expect(() => complete([...aliases].reverse())).not.toThrow();
		expect(() => complete(aliases.slice(2))).toThrow(TypeError);
		expect(() => complete([...aliases, aliases[0]!])).toThrow(TypeError);
		expect(() => complete([...aliases.slice(1), 'Utils: unknown'])).toThrow(TypeError);
	});
	it('preserves an independently known constant factor and equal-time result', () => {
		const baseline = [1, 2, 4, 8, 16, 32];
		const half = compare('half', [.5, 1, 2, 4, 8, 16], baseline);
		expect(half.ratio).toBeCloseTo(.5, 12);
		expect(half.interval95[0]).toBeCloseTo(.5, 12);
		expect(half.interval95[1]).toBeCloseTo(.5, 12);
		expect(half.conclusion).toBe('lower Utils time');
		expect(compare('equal', baseline, baseline).conclusion).toBe('difference unresolved');
	});
	it('retains uncertainty across noisy whole-run pairs and rejects incomplete evidence', () => {
		const result = compare('variable', [1, 2, 1, 2, 1, 2], [2, 1, 2, 1, 2, 1]);
		expect(result.interval95[0]).toBeLessThan(1);
		expect(result.interval95[1]).toBeGreaterThan(1);
		expect(result.conclusion).toBe('difference unresolved');
		expect(() => compare('missing', [1], [1])).toThrow(TypeError);
		expect(() => compare('zero', [1, 1, 1, 1, 1, 0], [1, 1, 1, 1, 1, 1])).toThrow(TypeError);
	});
});
