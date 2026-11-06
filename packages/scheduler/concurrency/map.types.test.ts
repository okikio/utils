import { map } from './map.ts';
import { fail, ok } from '@okikio/result';
import type { Result } from '@okikio/result';
const values: AsyncIterable<number> = map(['a'], (value) => value.length, {
	concurrency: 1,
	maximumBuffered: 1,
	ordering: 'input',
});
const settled: AsyncIterable<Result<number, string>> = map([true], (value) => value ? ok(1) : fail('missing'), {
	concurrency: 1,
	maximumBuffered: 1,
	ordering: 'completion',
	mode: 'settled',
});
void values;
void settled;
// @ts-expect-error Settled mode requires explicit Result data rather than arbitrary successes.
map([1], (value) => value, { concurrency: 1, maximumBuffered: 1, ordering: 'input', mode: 'settled' });
