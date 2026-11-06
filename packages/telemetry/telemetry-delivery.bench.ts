/** Exact encoded admission under a synchronous burst; direct writes have no retained queue or loss policy. */
import { bench, do_not_optimize, group } from 'mitata';
import { deepStrictEqual } from 'node:assert';
import { run } from './fixtures/bench.ts';
import { event } from '@okikio/telemetry';
import { queued, reporter } from '@okikio/telemetry/json';
const sample = event({ name: 'bench.delivery', at: '2026-11-04T00:00:00.000Z', fields: { count: 1 } });
/** The wire contract omits the internal event discriminator and uses ordinary JSON records. */
const expected = {
	at: '2026-11-04T00:00:00.000Z',
	fields: { count: 1 },
	level: 'info',
	message: 'bench.delivery',
	name: 'bench.delivery',
};
for (const count of [1, 1_000, 10_000]) {
	/** Await close so the measured lifetime includes every admitted write and releases all retained lines. */
	const burst = async function (verify = false): Promise<number> {
		let writes = 0;
		await using output = queued({
			write: (line) => {
				writes++;
				if (verify) deepStrictEqual(JSON.parse(line), expected);
			},
			maximumRecords: count,
			maximumQueuedBytes: count * 512,
			maximumBytes: 512,
			overflow: 'reject',
		});
		for (let index = 0; index < count; index++) output.report(sample);
		await output.close();
		if (writes !== count || output.stats().bytes !== 0 || output.stats().records !== 0) {
			throw new Error('Queue drain oracle failed.');
		}
		return writes;
	};
	const direct = async function (verify = false): Promise<number> {
		let writes = 0;
		const output = reporter({
			write: (line) => {
				writes++;
				if (verify) deepStrictEqual(JSON.parse(line), expected);
			},
			maximumBytes: 512,
		});
		for (let index = 0; index < count; index++) await output.report(sample);
		return writes;
	};
	if (await burst(true) !== count || await direct(true) !== count) throw new Error('Delivery count oracle failed.');
	group(`JSON delivery ${count} records, same bounded line projection`, () => {
		bench('bounded burst then joined close', async () => do_not_optimize(await burst()));
		bench('direct awaited write reference', async () => do_not_optimize(await direct()));
	});
}
await run();
