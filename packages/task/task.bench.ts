/** Local Task admission includes child cleanup; progress is observation, never terminal authority. */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import { DisposableStack } from '@okikio/dispose';
import * as context from '@okikio/context';
import * as state from '@okikio/context/state';
import * as task from '@okikio/task';
import * as groups from '@okikio/task/group';
import * as progress from '@okikio/task/progress';

for (const count of [1, 100]) {
	/** Both paths run sequential children and join each Task's ordinary cleanup before the next. */
	const children = async function (grouped: boolean, verify = false): Promise<number> {
		await using ctx = context.create({ id: 'task-benchmark' });
		await using owner = grouped
			? groups.create({ ctx, concurrency: 1, maximumWaiting: 0, mode: 'settled' })
			: undefined;
		let sum = 0;
		for (let index = 0; index < count; index++) {
			const child = owner ? await owner.start(() => index) : task.start(() => index, { ctx });
			const value = await child.done;
			if (verify && value !== index) throw new Error('Task returned a result from a different child.');
			sum += value;
		}
		if (owner) await owner.close();
		return sum;
	};
	const expected = count * (count - 1) / 2;
	if (await children(true, true) !== expected || await children(false, true) !== expected) {
		throw new Error('Task cleanup oracle failed.');
	}
	group(`task ${count} sequential joined children`, () => {
		bench('group admission and counters', async () => do_not_optimize(await children(true)));
		bench('ordinary Task lifecycle reference', async () => do_not_optimize(await children(false)));
	});
}
// Registration retains these live readers until measurement ends. Loop-local
// using declarations would dispose them before Mitata enters any callback.
using projections = new DisposableStack();
for (const count of [1, 100, 1_000]) {
	const source = projections.use(state.create<progress.ProgressType | undefined>({ completed: 0, total: 2 }));
	const selected = projections.use(progress.combine(Array.from({ length: count }, () => source.reader), {
		weights: Array.from({ length: count }, () => 1),
		maximumChildren: count,
	}));
	source.set({ completed: 1, total: 2 });
	if (Math.abs(selected.get().ratio! - 0.5) > 1e-12) throw new Error('Weighted progress oracle failed.');
	group(`progress ${count} subscriptions sharing one source`, () => {
		bench('read weighted snapshot', () => do_not_optimize(selected.get()));
		bench('read raw source reference', () => do_not_optimize(source.reader.get()));
	});
}
await run();
