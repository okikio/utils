/** Numeric convenience and calendar conversion versus direct Temporal; validation costs differ. */
import './polyfill.ts';
import * as duration from './mod.ts';
import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
const reference = '2026-03-08T00:00:00-05:00[America/New_York]';
strictEqual(duration.from(2.5, 'seconds').toString(), 'PT2.5S');
strictEqual(duration.convert(2.5, 'seconds', 'milliseconds'), 2500);
strictEqual(Temporal.Duration.from({ seconds: 2, milliseconds: 500 }).total('milliseconds'), 2500);
strictEqual(duration.total({ minutes: 1, milliseconds: 500 }, 'seconds'), 60.5);
strictEqual(duration.convert(1, 'day', 'hours', { relativeTo: reference }), 23);
strictEqual(Temporal.Duration.from({ days: 1 }).total({ unit: 'hours', relativeTo: reference }), 23);

group('Duration convenience with explicit units', () => {
	bench('fractional seconds construction', () => do_not_optimize(duration.from(2.5, 'seconds')));
	bench('seconds to milliseconds including numeric input conversion', () => {
		do_not_optimize(duration.convert(2.5, 'seconds', 'milliseconds'));
	});
	bench('Temporal pre-balanced fields to milliseconds reference', () => {
		do_not_optimize(Temporal.Duration.from({ seconds: 2, milliseconds: 500 }).total('milliseconds'));
	});
	bench('structured minutes and milliseconds total in seconds', () => {
		do_not_optimize(duration.total({ minutes: 1, milliseconds: 500 }, 'seconds'));
	});
	bench('calendar day to hours across daylight-saving transition', () => {
		do_not_optimize(duration.convert(1, 'day', 'hours', { relativeTo: reference }));
	});
	bench('Temporal calendar conversion reference', () => {
		do_not_optimize(Temporal.Duration.from({ days: 1 }).total({ unit: 'hours', relativeTo: reference }));
	});
});

await run();
