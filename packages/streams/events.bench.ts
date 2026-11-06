/** Separate native event observation cost from explicitly bounded push-to-stream conversion. @module */
import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { EventBus } from '@okikio/observables/events';
import { observe, readable } from './events.ts';
import { run } from './fixtures/bench.ts';

for (const count of [64, 1024]) {
	const consume = async function (queued: boolean): Promise<number> {
		using bus = new EventBus<number>();
		let total = 0;
		const stream = queued ? readable(bus.events, { maximumItems: count, overflow: 'error' }) : undefined;
		using _subscription = queued ? undefined : bus.subscribe((value) => {
			total += value;
		});
		for (let index = 0; index < count; index++) bus.emit(1);
		bus.close();
		if (stream) { for await (const value of stream) total += value; }
		return total;
	};
	strictEqual(await consume(true), count);
	strictEqual(await consume(false), count);
	const dispatch = function (adapted: boolean): number {
		const target = new EventTarget();
		let total = 0;
		const listener = (): void => {
			total++;
		};
		using _subscription = adapted ? observe(target, 'value').subscribe(listener) : undefined;
		if (!adapted) target.addEventListener('value', listener);
		for (let index = 0; index < count; index++) target.dispatchEvent(new Event('value'));
		if (!adapted) target.removeEventListener('value', listener);
		return total;
	};
	strictEqual(dispatch(true), count);
	strictEqual(dispatch(false), count);
	group(`native EventTarget ${count} dispatches; equal listener lifetime`, () => {
		bench('Observable native-event adapter', () => do_not_optimize(dispatch(true)));
		bench('direct native listener', () => do_not_optimize(dispatch(false)));
	});
	group(`EventBus ${count} values; synchronous burst then completion`, () => {
		bench('bounded lossless Web Stream; queued async consumption', async () => do_not_optimize(await consume(true)));
		bench(
			'direct synchronous subscription; no queue or piping contract',
			async () => do_not_optimize(await consume(false)),
		);
	});
}
await run();
