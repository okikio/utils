import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { Observable } from '@okikio/observables/observable';
import { EventBus } from '@okikio/observables/events';
import * as events from './events.ts';

describe('native events and bounded Observable streams', () => {
	it('preserves event identity, native listener coexistence, targeting and synchronous cancellation', () => {
		const target = new EventTarget();
		let native = 0, observed: Event | undefined;
		let observedCurrent: EventTarget | null = null, nativeCurrent: EventTarget | null = null;
		target.addEventListener('value', () => native++);
		const source = events.observe(target, 'value', { passive: false });
		using subscription = source.subscribe((value) => {
			observed = value;
			expect(value.target).toBe(target);
			observedCurrent = value.currentTarget;
			value.preventDefault();
		});
		// Node 26 can clear currentTarget between listeners; preserve the native host value.
		target.addEventListener('value', (event) => {
			nativeCurrent = event.currentTarget;
		});
		const value = new Event('value', { cancelable: true });
		expect(target.dispatchEvent(value)).toBe(false);
		expect(observed).toBe(value);
		expect(observedCurrent).toBe(nativeCurrent);
		expect(native).toBe(1);
		subscription.unsubscribe();
		target.dispatchEvent(new Event('value'));
		expect(native).toBe(2);
		expect(observed).toBe(value);
	});
	it('gives each subscription an independent once lifetime and completes aborted observations', () => {
		const target = new EventTarget(), abort = new AbortController();
		const source = events.observe(target, 'value', { once: true, signal: abort.signal });
		let left = 0, right = 0, complete = 0;
		using _a = source.subscribe({
			next() {
				left++;
			},
			complete() {
				complete++;
			},
		});
		using _b = source.subscribe({
			next() {
				right++;
			},
			complete() {
				complete++;
			},
		});
		target.dispatchEvent(new Event('value'));
		target.dispatchEvent(new Event('value'));
		expect([left, right, complete]).toEqual([1, 1, 2]);
		abort.abort();
		using _c = source.subscribe({
			next() {
				throw new Error('No aborted listener');
			},
			complete() {
				complete++;
			},
		});
		expect(complete).toBe(3);
	});
	it('rejects overflow instead of hiding an unbounded queue and releases only its subscription', async () => {
		using bus = new EventBus<number>();
		let unrelated = 0;
		using _other = bus.subscribe(() => unrelated++);
		const stream = events.readable(bus.events, { maximumItems: 2, overflow: 'error' });
		bus.emit(1);
		bus.emit(2);
		bus.emit(3);
		bus.emit(4);
		await expect(stream.getReader().read()).rejects.toBeInstanceOf(events.EventOverflowError);
		expect(unrelated).toBe(4);
	});
	it('makes drop-newest and drop-oldest explicit and drains retained values on completion', async () => {
		for (const overflow of ['drop-newest', 'drop-oldest'] as const) {
			using bus = new EventBus<number>();
			const stream = events.readable(bus.events, { maximumItems: 2, overflow });
			bus.emit(1);
			bus.emit(2);
			bus.emit(3);
			bus.close();
			expect(await Array.fromAsync(stream)).toEqual(overflow === 'drop-newest' ? [1, 2] : [2, 3]);
		}
	});
	it('pipes native event snapshots and releases the listener when the destination cancels', async () => {
		const target = new EventTarget();
		const stream = events.readable(events.observe<CustomEvent<number>>(target, 'value'), {
			maximumItems: 2,
			overflow: 'error',
		});
		const received: number[] = [];
		const abort = new AbortController();
		const pipe = stream.pipeThrough(
			new TransformStream<CustomEvent<number>, number>({
				transform(value, controller) {
					controller.enqueue(value.detail);
				},
			}),
		)
			.pipeTo(
				new WritableStream<number>({
					write(value) {
						received.push(value);
						abort.abort('enough');
					},
				}),
				{ signal: abort.signal },
			);
		target.dispatchEvent(new CustomEvent('value', { detail: 7 }));
		await expect(pipe).rejects.toBe('enough');
		target.dispatchEvent(new CustomEvent('value', { detail: 8 }));
		expect(received).toEqual([7]);
	});
	it('releases synchronous producers once on completion, failure, overflow and cancellation', async () => {
		for (const mode of ['complete', 'error', 'overflow', 'cancel'] as const) {
			let released = 0;
			const failure = { mode };
			const source = new Observable<number>((observer) => {
				observer.next(1);
				if (mode === 'complete') observer.complete();
				if (mode === 'error') observer.error(failure);
				if (mode === 'overflow') observer.next(2);
				return () => {
					released++;
				};
			});
			const stream = events.readable(source, { maximumItems: 1, overflow: 'error' });
			if (mode === 'complete') expect(await Array.fromAsync(stream)).toEqual([1]);
			else if (mode === 'cancel') await stream.cancel();
			else if (mode === 'error') await expect(stream.getReader().read()).rejects.toBe(failure);
			else await expect(stream.getReader().read()).rejects.toBeInstanceOf(events.EventOverflowError);
			expect(released).toBe(1);
		}
	});
	it('aborts with the exact reason including null and releases subscription teardown', async () => {
		let released = 0;
		const source = new Observable<number>(() => () => {
			released++;
		});
		const abort = new AbortController();
		const stream = events.readable(source, { maximumItems: 1, overflow: 'error', signal: abort.signal });
		abort.abort(null);
		await expect(stream.getReader().read()).rejects.toBe(null);
		expect(released).toBe(1);
	});
	it('rejects invalid capacity and policy before starting a source', () => {
		let starts = 0;
		const source = new Observable(() => {
			starts++;
		});
		expect(() => events.readable(source, { maximumItems: 0, overflow: 'error' })).toThrow(RangeError);
		expect(() => events.readable(source, { maximumItems: 1, overflow: 'unknown' as 'error' })).toThrow(TypeError);
		expect(starts).toBe(0);
	});
});
