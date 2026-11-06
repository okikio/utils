/** Compare callback and Observable delivery, including separate attach/dispose cycles. */
import * as state from './state.ts';
import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import { DisposableStack } from '@okikio/dispose';
/** One production cell with an externally counted delivery oracle. */
function progress(observers: number, observable: boolean) {
	const cell = state.create(0);
	let delivered = 0;
	let lastValue = 0;
	const receive = ({ value }: state.Change<number>): void => {
		delivered++;
		lastValue = value;
	};
	const subscriptions = Array.from(
		{ length: observers },
		() => observable ? cell.reader.changes.subscribe(receive) : cell.reader.subscribe(receive),
	);
	let revision = 0;
	/** Closing the source completes and releases both callback and Observable subscriptions. */
	const close = (): void => cell[Symbol.dispose]();
	return {
		publish(count: number): void {
			for (let index = 0; index < count; index++) cell.set(++revision);
		},
		check(count: number): void {
			strictEqual(delivered, count * observers);
			strictEqual(lastValue, count);
			strictEqual(cell.reader.revision, count);
			strictEqual(cell.reader.get(), count);
		},
		read: () => delivered,
		close,
		[Symbol.dispose]: close,
		checkClosed(): void {
			strictEqual(subscriptions.every((subscription) => subscription.closed), true);
		},
	};
}

// Readers survive registration and measurement. Scope exit also closes them
// if a later fixture or its preflight fails before run() can start.
using steady = new DisposableStack();
for (const observers of [1, 16, 128]) {
	for (const observable of [false, true]) {
		using oracle = progress(observers, observable);
		oracle.publish(128);
		oracle.check(128);
		oracle.close();
		oracle.checkClosed();
	}
	group(`Context progress: 128 updates to ${observers} attached observers`, () => {
		for (const observable of [false, true]) {
			const fixture = steady.use(progress(observers, observable));
			bench(observable ? 'Observable changes' : 'callback subscription', () => {
				fixture.publish(128);
				do_not_optimize(fixture.read());
			});
		}
	});
}
group('Context lifetime: create, attach 16 observers, publish, dispose', () => {
	for (const observable of [false, true]) {
		bench(observable ? 'Observable lifetime' : 'callback lifetime', () => {
			using fixture = progress(16, observable);
			fixture.publish(1);
			do_not_optimize(fixture.read());
			fixture.close();
		});
	}
});
await run();
