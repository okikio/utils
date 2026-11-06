/** Derived-reader costs include acquisition, equality suppression and releasing every owned listener. */
import { bench, do_not_optimize, group } from 'mitata';
import * as state from '@okikio/context/state';
import { TestClock } from '@okikio/context';
import { advanceUntilIdle } from '@okikio/context/testing';
import { run } from './fixtures/bench.ts';

/** Independent notification count: only changes to the projected count should reach readers. */
function projection(count: number, manual: boolean): number {
	using source = state.create({ count: 0, ignored: 0 });
	let notifications = 0;
	const owned: Disposable[] = [];
	try {
		for (let index = 0; index < count; index++) {
			if (manual) {
				const cell = state.create(source.reader.get().count);
				owned.push(cell, source.reader.subscribe(({ value }) => cell.set(value.count)));
				owned.push(cell.reader.subscribe(() => notifications++));
			} else {
				const selected = state.select(source.reader, (value) => value.count);
				owned.push(selected, selected.subscribe(() => notifications++));
			}
		}
		source.set({ count: 0, ignored: 1 });
		source.set({ count: 1, ignored: 1 });
		return notifications;
	} finally {
		for (const item of owned.reverse()) item[Symbol.dispose]();
	}
}
for (const count of [1, 100, 10_000]) {
	if (projection(count, false) !== count || projection(count, true) !== count) {
		throw new Error('Projection notification oracle failed.');
	}
	group(`owned projections ${count}`, () => {
		bench('select acquire/update/dispose', () => do_not_optimize(projection(count, false)));
		bench('manual reader/cell same equality and lifetime', () => do_not_optimize(projection(count, true)));
	});
}
/** Each sleeper is joined before the benchmark cycle releases the deterministic clock. */
async function timers(count: number): Promise<number> {
	const clock = new TestClock();
	const pending = Array.from({ length: count }, () => clock.sleep(1));
	const result = await advanceUntilIdle(clock, { maximumSteps: 1, maximumMicrotasks: 2 });
	await Promise.all(pending);
	if (clock.pending().length !== 0 || result.steps !== 1) throw new Error('Timer ownership oracle failed.');
	return pending.length;
}
for (const count of [1, 1000]) {
	if (await timers(count) !== count) throw new Error('Timer count oracle failed.');
	bench(`clock advance/join ${count}`, async () => do_not_optimize(await timers(count)));
}
await run();
