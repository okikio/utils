import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as events from './events.ts';

/** Track public listener ownership without borrowing a browser realm. */
function target<Value>() {
	const listeners = new Set<(value: Value) => void>();
	let added = 0;
	let removed = 0;
	return {
		get size() {
			return listeners.size;
		},
		get added() {
			return added;
		},
		get removed() {
			return removed;
		},
		addEventListener(_type: string, listener: (value: Value) => void) {
			added++;
			listeners.add(listener);
		},
		removeEventListener(_type: string, listener: (value: Value) => void) {
			removed++;
			listeners.delete(listener);
		},
		emit(value: Value) {
			for (const listener of [...listeners]) listener(value);
		},
	};
}

describe('context EventTarget observation', () => {
	it('observes real EventTarget events without changing the producer', () => {
		const controller = new AbortController();
		const source = new EventTarget();
		const values: Event[] = [];
		const event = new Event('update');
		using subscription = events.from({ signal: controller.signal }, source, 'update').subscribe((value) =>
			values.push(value)
		);
		source.dispatchEvent(event);
		expect(values).toEqual([event]);
		controller.abort();
		source.dispatchEvent(new Event('update'));
		expect(values).toEqual([event]);
		expect(subscription.closed).toBe(true);
	});

	it('registers cold independent subscriptions and removes only the unsubscribed listener', () => {
		const source = target<number>();
		const signal = new AbortController().signal;
		const updates = events.from({ signal }, source, 'update');
		expect(source.size).toBe(0);
		const first: number[] = [];
		const second: number[] = [];
		const subscription = updates.subscribe((value) => first.push(value));
		using other = updates.subscribe((value) => second.push(value));
		expect(source.size).toBe(2);
		subscription.unsubscribe();
		subscription.unsubscribe();
		source.emit(3);
		expect(source.removed).toBe(1);
		expect(first).toEqual([]);
		expect(second).toEqual([3]);
		void other;
	});

	it('completes pre-aborted observations without registering a target listener', () => {
		const controller = new AbortController();
		controller.abort();
		const source = target<number>();
		let completed = 0;
		const subscription = events.from({ signal: controller.signal }, source, 'update').subscribe({
			complete: () => completed++,
		});
		expect(source.added).toBe(0);
		expect(subscription.closed).toBe(true);
		expect(completed).toBe(1);
	});

	it('removes an active listener exactly once when its context aborts', () => {
		const controller = new AbortController();
		const source = target<number>();
		let completed = 0;
		const subscription = events.from({ signal: controller.signal }, source, 'update').subscribe({
			complete: () => completed++,
		});
		controller.abort();
		subscription.unsubscribe();
		expect(source.size).toBe(0);
		expect(source.removed).toBe(1);
		expect(completed).toBe(1);
	});

	it('detaches a once listener before a callback dispatches another event', () => {
		const source = target<number>();
		const values: number[] = [];
		let completed = 0;
		const subscription = events.from({ signal: new AbortController().signal }, source, 'update', { once: true })
			.subscribe({
				next(value) {
					values.push(value);
					source.emit(value + 1);
				},
				complete: () => completed++,
			});
		source.emit(1);
		expect(values).toEqual([1]);
		expect(source.size).toBe(0);
		expect(source.removed).toBe(1);
		expect(completed).toBe(1);
		expect(subscription.closed).toBe(true);
	});

	it('cleans a structural adapter that aborts while attaching a listener', () => {
		const controller = new AbortController();
		const source = target<number>();
		const adapter = {
			...source,
			addEventListener(type: string, listener: (value: number) => void) {
				controller.abort();
				source.addEventListener(type, listener);
			},
		};
		const subscription = events.from({ signal: controller.signal }, adapter, 'update').subscribe({});
		expect(subscription.closed).toBe(true);
		expect(source.size).toBe(0);
		expect(source.removed).toBe(1);
	});

	it('announces completion only after synchronous registration has released its listener', () => {
		const controller = new AbortController();
		const order: string[] = [];
		const source: events.Source<number> = {
			addEventListener() {
				controller.abort();
				order.push('attached');
			},
			removeEventListener() {
				order.push('removed');
			},
		};
		events.from({ signal: controller.signal }, source, 'update').subscribe({ complete: () => order.push('complete') });
		expect(order).toEqual(['attached', 'removed', 'complete']);
	});

	it('reports cleanup failure after abort during registration without announcing successful completion', () => {
		const controller = new AbortController();
		const failure = new Error('cleanup failed');
		const errors: unknown[] = [];
		let attempts = 0;
		let completed = 0;
		const source: events.Source<number> = {
			addEventListener() {
				controller.abort();
			},
			removeEventListener() {
				attempts++;
				throw failure;
			},
		};
		const subscription = events.from({ signal: controller.signal }, source, 'update').subscribe({
			error: (error) => errors.push(error),
			complete: () => completed++,
		});
		expect(subscription.closed).toBe(true);
		expect(errors).toEqual([failure]);
		expect(attempts).toBe(1);
		expect(completed).toBe(0);
	});

	it('cleans a once listener when a mock emits synchronously during registration', () => {
		const source = target<number>();
		const adapter = {
			...source,
			addEventListener(type: string, listener: (value: number) => void) {
				listener(1);
				source.addEventListener(type, listener);
			},
		};
		const values: number[] = [];
		const subscription = events.from({ signal: new AbortController().signal }, adapter, 'update', { once: true })
			.subscribe((value) => values.push(value));
		expect(values).toEqual([1]);
		expect(subscription.closed).toBe(true);
		expect(source.size).toBe(0);
		expect(source.removed).toBe(1);
	});

	it('removes a partially registered listener when setup throws', () => {
		const source = target<number>();
		const failure = new Error('adapter setup failed');
		const adapter = {
			...source,
			addEventListener(type: string, listener: (value: number) => void) {
				source.addEventListener(type, listener);
				throw failure;
			},
		};
		const errors: unknown[] = [];
		const subscription = events.from({ signal: new AbortController().signal }, adapter, 'update').subscribe({
			error: (error) => errors.push(error),
		});
		expect(errors).toEqual([failure]);
		expect(subscription.closed).toBe(true);
		expect(source.size).toBe(0);
		expect(source.removed).toBe(1);
	});

	it('snapshots passive and capture options before the first subscription', () => {
		const seen: unknown[] = [];
		const source: events.Source<number> = {
			addEventListener(_type, _listener, options) {
				seen.push(options);
			},
			removeEventListener(_type, _listener, options) {
				seen.push(options);
			},
		};
		const options = { capture: true, passive: true };
		const updates = events.from({ signal: new AbortController().signal }, source, 'update', options);
		options.capture = false;
		const subscription = updates.subscribe({});
		subscription.unsubscribe();
		expect(seen).toEqual([{ capture: true, passive: true }, true]);
	});

	it('preserves setup and cleanup failures when a structural target rejects both operations', () => {
		const setupFailure = new Error('setup failed');
		const cleanupFailure = new Error('cleanup failed');
		const source: events.Source<number> = {
			addEventListener() {
				throw setupFailure;
			},
			removeEventListener() {
				throw cleanupFailure;
			},
		};
		const errors: unknown[] = [];
		const subscription = events.from({ signal: new AbortController().signal }, source, 'update').subscribe({
			error: (error) => errors.push(error),
		});
		expect(subscription.closed).toBe(true);
		expect(errors[0]).toBeInstanceOf(AggregateError);
		expect((errors[0] as AggregateError).errors).toEqual([setupFailure, cleanupFailure]);
	});

	it('reports abort cleanup failure through the Observable error callback', () => {
		const controller = new AbortController();
		const failure = new Error('cleanup failed');
		const source: events.Source<number> = {
			addEventListener() {},
			removeEventListener() {
				throw failure;
			},
		};
		const errors: unknown[] = [];
		const subscription = events.from({ signal: controller.signal }, source, 'update').subscribe({
			error: (error) => errors.push(error),
		});
		controller.abort();
		expect(subscription.closed).toBe(true);
		expect(errors).toEqual([failure]);
	});
});
