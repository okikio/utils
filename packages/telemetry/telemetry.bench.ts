/** Measure count-bounded high-cardinality history separately from diagnostic projection. */
import { bench, do_not_optimize, group } from 'mitata';
import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert';
import { run } from './fixtures/bench.ts';
import * as telemetry from '@okikio/telemetry';

const destination: telemetry.Reporter = telemetry.noop;

for (const count of [1, 1_000, 10_000]) {
	/** Generate fixed unique keys outside timing; emission and snapshot cost is a separate workload. */
	const events = Array.from(
		{ length: count },
		(_, index) => telemetry.event({ name: 'bench.event', fields: { request_id: String(index) } }),
	);
	/** Include history creation and disposal for each admitted burst. */
	const retain = async function (verify = false): Promise<ReturnType<telemetry.BufferedReporter['stats']>> {
		const history = telemetry.buffer(telemetry.noop, { maximumKeys: 64, maximumRecords: 256, capacity: 8 });
		for (const event of events) await history.report(event);
		const stats = history.stats();
		if (verify) {
			strictEqual(stats.keys, Math.min(count, 64));
			strictEqual(stats.records, Math.min(count, 64));
			strictEqual(stats.dropped, Math.max(0, count - 64));
		}
		history.discard();
		if (verify) strictEqual(history.stats().records, 0);
		return stats;
	};
	await retain(true);
	group(`telemetry: ${count} unique keys, 64 retained`, () => {
		bench('bounded history admission and discard', async () => {
			do_not_optimize(await retain());
		});
		// Direct delivery establishes the cost of having no failure history; it has weaker retention semantics.
		bench('direct noop delivery cost reference', async () => {
			for (const event of events) await destination.report(event);
			do_not_optimize(events.length);
		});
	});
}
const fields = { request_id: 'request', values: Array.from({ length: 100 }, (_, index) => ({ index, text: 'value' })) };
const projected = telemetry.event({ name: 'bench.project', fields });
deepStrictEqual(JSON.parse(JSON.stringify(projected.fields)), fields);
notStrictEqual(projected.fields.values, fields.values);
strictEqual(Object.isFrozen(projected.fields.values), true);
group('telemetry expanded immutable field projection: 100 records', () => {
	bench('event with bounded JSON copy', () => {
		do_not_optimize(telemetry.event({ name: 'bench.project', fields }));
	});
});
await run();
