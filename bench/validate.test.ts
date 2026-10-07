/** Independent fault controls prevent empty or malformed timing output from qualifying. */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { validateMitata } from './validate.ts';

/** A hand-authored population has independently known extrema, percentiles and mean. */
function valid(): unknown {
	return {
		benchmarks: [{
			runs: [{ stats: { min: 1, max: 3, p25: 1, p50: 2, p75: 3, p99: 3, p999: 3, avg: 2, samples: [1, 1, 2, 3, 3] } }],
		}],
	};
}
describe('native benchmark evidence', () => {
	it('accepts timing evidence without requiring any particular performance', () => {
		expect(() => validateMitata(valid())).not.toThrow();
	});
	it('rejects empty, missing, failed and contradictory timing evidence', () => {
		for (
			const value of [
				null,
				{},
				{ benchmarks: [] },
				{ benchmarks: [{ runs: [] }] },
				{
					benchmarks: [{
						runs: [{ stats: { min: 0, max: 1, p25: 0, p50: 1, p75: 1, p99: 1, p999: 1, avg: 0, samples: [0, 0, 0] } }],
					}],
				},
				{ benchmarks: [{ runs: [{ error: { message: 'workload failed' }, stats: {} }] }] },
				{
					benchmarks: [{
						runs: [{ stats: { min: 1, max: 3, p25: 1, p50: 2, p75: 3, p99: 3, p999: 3, avg: 2, samples: [4] } }],
					}],
				},
				{
					benchmarks: [{
						runs: [{ stats: { min: 1, max: 3, p25: 1, p50: 2, p75: 3, p99: 3, p999: 3, avg: 2, samples: [] } }],
					}],
				},
			]
		) expect(() => validateMitata(value)).toThrow();
	});
});
