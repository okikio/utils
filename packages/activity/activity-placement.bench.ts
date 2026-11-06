/** Placement snapshot diagnostics share dispatch eligibility; no capacity is reserved by inspection. */
import { bench, do_not_optimize, group } from 'mitata';
import { deepStrictEqual } from 'node:assert';
import { run } from './fixtures/bench.ts';
import * as engine from '@okikio/activity/engine';
const target = engine.define({ id: 'placement.target' });
const activity = { id: 'placement.work', version: '1', placement: engine.require(target) };
for (const count of [10, 100, 1000]) {
	const hosts = Array.from(
		{ length: count },
		(_, index) => ({
			id: `registration.${index}`,
			hostId: `host.${index}`,
			engineId: target.id,
			capacity: 1,
			active: index === count - 1 ? 0 : 1,
			activities: [{ id: activity.id, version: activity.version }],
		}),
	);
	const options = { maximumHosts: count, now: 0 };
	const selected = engine.inspect(activity, hosts, options).hosts.filter((row) => row.selected);
	// One selected row is insufficient if it belongs to a saturated physical host.
	deepStrictEqual(selected.map((row) => row.hostId), [`host.${count - 1}`]);
	group(`placement ${count} hosts`, () => {
		bench('bounded report', () => do_not_optimize(engine.inspect(activity, hosts, options)));
		bench(
			'selection only same constraints',
			() =>
				do_not_optimize(
					hosts.find((host) =>
						host.active < host.capacity &&
						host.activities.some((entry) => entry.id === activity.id && entry.version === activity.version)
					),
				),
		);
	});
}
await run();
