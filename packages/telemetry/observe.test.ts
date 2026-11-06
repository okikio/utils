/** Native host error reporting must not turn observational failures into process failures. @module */
import { describe, it } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { EventBus, Observable } from '@okikio/observables';
import { expect } from '@std/expect';
import { observe } from './observe.ts';

describe('safe read-only observations', () => {
	it('contains synchronous and asynchronous subscriber and diagnostic failures', async () => {
		using source = new EventBus<number>();
		const errors: unknown[] = [];
		const receivers: unknown[] = [];
		const startFailure = new Error('start');
		const nextFailure = new Error('next');
		const completeFailure = new Error('complete');
		const events = observe(source, {
			async onError(error) {
				errors.push(error);
				throw new Error('diagnostic');
			},
		});
		const observer = {
			start() {
				receivers.push(this);
				throw startFailure;
			},
			async next() {
				receivers.push(this);
				throw nextFailure;
			},
			complete() {
				receivers.push(this);
				throw completeFailure;
			},
		};
		using listener = events.subscribe(observer);
		source.emit(1);
		source.close();
		await setImmediate();
		expect(listener.closed).toBe(true);
		expect(receivers).toEqual([observer, observer, observer]);
		expect(new Set(errors)).toEqual(new Set([startFailure, nextFailure, completeFailure]));
		expect('emit' in events).toBe(false);
	});

	it('reports source errors and contains a rejected error handler', async () => {
		const failure = new Error('source');
		const handlerFailure = new Error('error handler');
		const errors: unknown[] = [];
		const source = new Observable<number>((subscriber) => subscriber.error(failure));
		const events = observe(source, {
			onError: (error) => {
				errors.push(error);
			},
		});
		using missingHandler = events.subscribe(() => {});
		let received: unknown;
		using rejectingHandler = events.subscribe({
			async error(reason) {
				received = reason;
				throw handlerFailure;
			},
		});
		await setImmediate();
		expect(missingHandler.closed).toBe(true);
		expect(rejectingHandler.closed).toBe(true);
		expect(received).toBe(failure);
		expect(errors).toEqual([failure, handlerFailure]);
	});

	it('preserves both AbortSignal subscription forms without closing the source', () => {
		using source = new EventBus<number>();
		const events = observe(source);
		const controller = new AbortController();
		const values: number[] = [];
		using observer = events.subscribe({
			next(value) {
				values.push(value);
			},
		}, { signal: controller.signal });
		using callback = events.subscribe((value) => values.push(value), undefined, undefined, {
			signal: controller.signal,
		});
		source.emit(1);
		controller.abort();
		source.emit(2);
		expect(observer.closed).toBe(true);
		expect(callback.closed).toBe(true);
		expect(values).toEqual([1, 1]);
		using replacement = events.subscribe((value) => values.push(value));
		source.emit(3);
		replacement.unsubscribe();
		source.emit(4);
		expect(values).toEqual([1, 1, 3]);
	});

	it('honors immediate unsubscription in start before connecting to the source', () => {
		let opened = 0;
		const events = observe(
			new Observable<number>(() => {
				opened++;
			}),
		);
		using listener = events.subscribe({
			start(subscription) {
				subscription.unsubscribe();
			},
		});
		expect(listener.closed).toBe(true);
		expect(opened).toBe(0);
	});
});
