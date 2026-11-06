/** Bounded preflight and accepted-prefix bookkeeping versus individual validated delivery. @module */
import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as context from '@okikio/context';
import * as effects from './effect/mod.ts';
import * as meter from './effect/meter/mod.ts';

await using owner = context.create({ id: 'meter-batch', clock: new context.TestClock() });
const Count = meter.define({ id: 'count' });
let accepted = 0;
const ctx = effects.scope(owner, {
	effects: [meter.effect(Count)],
	emitter: {
		async emit() {
			accepted++;
		},
	},
});
for (const count of [1, 64, 1024]) {
	const readings = Array.from({ length: count }, (_, value) => ({ key: String(value), value }));
	const options = { maximumItems: count, maximumBytes: count * 256 };
	const before = accepted;
	const result = await meter.recordBatch(ctx, Count, readings, options);
	strictEqual(result.status, 'accepted');
	strictEqual(result.accepted.length, count);
	strictEqual(accepted - before, count);
	group(`meter ${count} readings; sequential accepting sink`, () => {
		bench(
			'bounded encoded preflight and delivery',
			async () => do_not_optimize(await meter.recordBatch(ctx, Count, readings, options)),
		);
		bench('individual records; no whole-batch preflight', async () => {
			for (const reading of readings) {
				do_not_optimize(await meter.record(ctx, Count, reading.value, { key: reading.key }));
			}
		});
	});
}
await run();
