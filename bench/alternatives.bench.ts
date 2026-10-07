/** Compare shared successful outputs, with ownership and same-engine limitations retained in each fixture. @module */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { deepStrictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { alternatives } from '../tests/fixtures/alternatives.ts';
import { run } from './run.ts';

for (const candidate of alternatives) {
	deepStrictEqual(await candidate.utils(), candidate.expected);
	deepStrictEqual(await candidate.alternative(), candidate.expected);
	group(`${candidate.id}: ${candidate.scope}`, () => {
		bench('Utils shared operation', async () => do_not_optimize(await candidate.utils())).gc('once');
		bench('Established alternative shared operation', async () => do_not_optimize(await candidate.alternative())).gc(
			'once',
		);
	});
}
await run();
