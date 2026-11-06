/** Promise overhead for branch-preserving async composition; no parallel admission is implied. @module */
import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as result from './mod.ts';
import * as asynchronous from './async.ts';

for (const count of [1, 1000]) {
	for (const failed of [false, true]) {
		const value: result.Result<number, string> = failed ? result.fail('missing') : result.ok(2);
		const transform = async (n: number) => n * 3;
		const actual = await asynchronous.map(value, transform);
		strictEqual(actual.ok ? actual.value : actual, value.ok ? 6 : value);
		group(`async result ${count} sequential ${failed ? 'failed' : 'success'}`, () => {
			bench('map', async () => {
				for (let i = 0; i < count; i++) do_not_optimize(await asynchronous.map(value, transform));
			});
			bench('explicit async branch', async () => {
				for (let i = 0; i < count; i++) {
					do_not_optimize(await (async () => value.ok ? result.ok(await transform(value.value)) : value)());
				}
			});
		});
	}
}
await run();
