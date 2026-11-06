/** Exact arithmetic and locale formatting costs; native baselines state their reduced policy. @module */
import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as arithmetic from './arithmetic.ts';
import * as formatting from './format.ts';
import { elapsedNanoseconds } from './conversion.ts';
import { from } from './units.ts';
import { temporal } from './temporal.ts';

for (const count of [1, 1000]) {
	const values = Array.from({ length: count }, () => from('PT0.000000001S'));
	const options = { mode: 'elapsed' as const, maximumItems: count };
	strictEqual(elapsedNanoseconds(arithmetic.sum(values, options)), BigInt(count));
	group(`exact elapsed sum ${count} prepared durations`, () => {
		bench('bounded bigint sum', () => do_not_optimize(arithmetic.sum(values, options)));
		bench('explicit bigint total without scan bound', () => {
			let total = 0n;
			for (const value of values) total += elapsedNanoseconds(value);
			do_not_optimize(from(total, 'nanoseconds'));
		});
	});
}
const reference = temporal.ZonedDateTime.from('2026-03-08T00:00-05:00[America/New_York]');
const options = { mode: 'calendar' as const, relativeTo: reference, maximumItems: 2 };
strictEqual(arithmetic.sum(['P1D', 'PT1H'], options).toString(), 'P1DT1H');
group('calendar sum across DST including parsing and difference', () => {
	bench('bounded calendar sum', () => do_not_optimize(arithmetic.sum(['P1D', 'PT1H'], options)));
	bench(
		'native authored cursor steps',
		() => do_not_optimize(reference.until(reference.add('P1D').add('PT1H'), { largestUnit: 'day' })),
	);
});
const formatter = formatting.create({ locale: 'en-US', style: 'long', fallback: 'iso' });
const value = from('PT1H2M');
strictEqual(formatter.format(value), formatting.format(value, { locale: 'en-US', style: 'long', fallback: 'iso' }));
group(`duration formatting selected ${formatter.mode} host`, () => {
	bench('reused locale formatter', () => do_not_optimize(formatter.format(value)));
	bench(
		'cold locale formatter',
		() => do_not_optimize(formatting.format(value, { locale: 'en-US', style: 'long', fallback: 'iso' })),
	);
});
await run();
