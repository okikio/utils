import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { isObservableError, map, pipe } from '@okikio/observables';
import { SuppressedError } from '@okikio/dispose';
import * as context from './mod.ts';
import * as state from './state.ts';

describe('explicit context state', () => {
	it('provides a real read facade and a typed progress consumer', async () => {
		await using ctx = context.create({ id: 'progress' });
		using cell = state.create({ completed: 0, total: 4 });
		const view = context.view(ctx, { progress: cell.reader });
		const seen: number[] = [];
		using _subscription = view.progress.subscribe(({ value }) => seen.push(value.completed));
		cell.update((value) => ({ ...value, completed: 1 }));
		expect(view.progress.get()).toEqual({ completed: 1, total: 4 });
		expect(seen).toEqual([1]);
		expect('set' in view.progress).toBe(false);
		expect(Symbol.dispose in view.progress).toBe(false);
		expect('emit' in view.progress.changes).toBe(false);
		expect('close' in view.progress.changes).toBe(false);
	});

	it('batches latest values, keeps monotonic revisions and does not roll back thrown callbacks', () => {
		using cell = state.create(0);
		const changes: state.Change<number>[] = [];
		using _subscription = cell.reader.subscribe((value) => changes.push(value));
		cell.batch(() => {
			cell.set(1);
			cell.batch(() => {
				cell.set(2);
				cell.set(2);
			});
			cell.set(3);
		});
		expect(changes).toEqual([{ previous: 0, value: 3, revision: 3 }]);
		expect(() =>
			cell.batch(() => {
				cell.set(4);
				throw new Error('caller');
			})
		).toThrow('caller');
		expect(cell.reader.get()).toBe(4);
		expect(changes.at(-1)?.value).toBe(4);
	});

	it('detaches only its own subscriptions, handles pre-abort and disposes idempotently', () => {
		const cell = state.create(0);
		const controller = new AbortController();
		const seen: number[] = [];
		const subscription = cell.reader.subscribe(({ value }) => seen.push(value), {
			signal: controller.signal,
			immediate: true,
		});
		controller.abort();
		cell.set(1);
		expect(seen).toEqual([0]);
		expect(subscription.closed).toBe(true);
		const rejected = cell.reader.subscribe(() => {
			throw new Error('must not subscribe');
		}, { signal: controller.signal, immediate: true });
		expect(rejected.closed).toBe(true);
		const active = cell.reader.subscribe(() => {});
		cell[Symbol.dispose]();
		cell[Symbol.dispose]();
		expect(active.closed).toBe(true);
		expect(() => cell.set(2)).toThrow(ReferenceError);
		expect(cell.reader.get()).toBe(1);
	});

	it('attempts every subscription release and Observable completion when one borrowed signal unlink fails', () => {
		const cell = state.create(0);
		const controller = new AbortController();
		const failure = new Error('unlink failed after removal');
		const remove = controller.signal.removeEventListener.bind(controller.signal);
		let removals = 0;
		Object.defineProperty(controller.signal, 'removeEventListener', {
			value: (...args: Parameters<AbortSignal['removeEventListener']>) => {
				removals++;
				remove(...args);
				throw failure;
			},
		});
		const first = cell.reader.subscribe(() => {}, { signal: controller.signal });
		const second = cell.reader.subscribe(() => {});
		let completed = 0;
		const observable = cell.reader.changes.subscribe({ complete: () => completed++ });
		let observed: unknown;
		try {
			cell[Symbol.dispose]();
		} catch (error) {
			observed = error;
		}
		expect(observed).toBe(failure);
		expect(cell.closed).toBe(true);
		expect(first.closed).toBe(true);
		expect(second.closed).toBe(true);
		expect(observable.closed).toBe(true);
		expect(completed).toBe(1);
		expect(removals).toBe(1);
		cell[Symbol.dispose]();
		first.unsubscribe();
		expect(removals).toBe(1);
		const late = cell.reader.changes.subscribe({ complete: () => completed++ });
		expect(late.closed).toBe(true);
		expect(completed).toBe(2);
	});

	it('removes a listener retained after registration reenters cell closure, preserving late failures', () => {
		for (const fail of [false, true]) {
			const cell = state.create(0);
			const controller = new AbortController();
			const signal = controller.signal;
			const add = signal.addEventListener.bind(signal);
			const remove = signal.removeEventListener.bind(signal);
			const retained = new Set<unknown>();
			const acquisition = new Error('registration failed after reentrant close');
			const cleanup = new Error('late listener removal failed');
			let removals = 0;
			Object.defineProperty(signal, 'addEventListener', {
				value: (...args: Parameters<AbortSignal['addEventListener']>) => {
					cell[Symbol.dispose]();
					add(...args);
					retained.add(args[1]);
					if (fail) throw acquisition;
				},
			});
			Object.defineProperty(signal, 'removeEventListener', {
				value: (...args: Parameters<AbortSignal['removeEventListener']>) => {
					removals++;
					remove(...args);
					retained.delete(args[1]);
					if (fail) throw cleanup;
				},
			});
			let observed: unknown;
			let subscription: state.Subscription | undefined;
			try {
				subscription = cell.reader.subscribe(() => {}, { signal });
			} catch (error) {
				observed = error;
			}
			expect(cell.closed).toBe(true);
			expect(retained.size).toBe(0);
			expect(removals).toBe(1);
			if (fail) {
				expect(observed).toBeInstanceOf(SuppressedError);
				if (!(observed instanceof SuppressedError)) throw observed;
				expect(observed.error).toBe(cleanup);
				expect(observed.suppressed).toBe(acquisition);
			} else {
				expect(observed).toBe(undefined);
				expect(subscription?.closed).toBe(true);
			}
			cell[Symbol.dispose]();
			expect(removals).toBe(1);
		}
	});

	it('rolls back a partially registered subscription and preserves both acquisition and cleanup failures', () => {
		using cell = state.create(0);
		const controller = new AbortController();
		const acquisition = new Error('listener retained before add failed');
		const cleanup = new Error('listener removed before unlink failed');
		const add = controller.signal.addEventListener.bind(controller.signal);
		const remove = controller.signal.removeEventListener.bind(controller.signal);
		let retained = 0, calls = 0;
		Object.defineProperty(controller.signal, 'addEventListener', {
			value: (...args: Parameters<AbortSignal['addEventListener']>) => {
				add(...args);
				retained++;
				throw acquisition;
			},
		});
		Object.defineProperty(controller.signal, 'removeEventListener', {
			value: (...args: Parameters<AbortSignal['removeEventListener']>) => {
				remove(...args);
				retained--;
				throw cleanup;
			},
		});
		let observed: unknown;
		try {
			cell.reader.subscribe(() => calls++, { signal: controller.signal });
		} catch (error) {
			observed = error;
		}
		expect(observed).toBeInstanceOf(SuppressedError);
		if (!(observed instanceof SuppressedError)) throw observed;
		expect(observed.error).toBe(cleanup);
		expect(observed.suppressed).toBe(acquisition);
		expect(retained).toBe(0);
		cell.set(1);
		expect(calls).toBe(0);
		let other = 0;
		using _healthy = cell.reader.subscribe(() => other++);
		cell.set(2);
		expect(other).toBe(1);
	});

	it('isolates errors and bounds observer feedback without storing an event history', () => {
		using cell = state.create(0, { notificationLimit: 3 });
		using _broken = cell.reader.subscribe(() => {
			throw new Error('observer');
		});
		const seen: number[] = [];
		using _other = cell.reader.subscribe(({ value }) => {
			seen.push(value);
			cell.set(value + 1);
		});
		cell.set(1);
		expect(seen).toEqual([1, 2, 3]);
		expect(cell.reader.get()).toBe(4);
		expect(cell.observerError).toBeInstanceOf(RangeError);
	});

	it('does not freeze or proxy borrowed payloads', () => {
		const payload = { count: 1 };
		using cell = state.create(payload);
		expect(cell.reader.get()).toBe(payload);
		expect(Object.isFrozen(payload)).toBe(false);
	});

	it('composes changes through owned Observable operators and completes on cell disposal', async () => {
		const cell = state.create(0);
		const completion = Promise.withResolvers<void>();
		const values: number[] = [];
		using subscription = pipe(cell.reader.changes, map((change) => change.value * 10)).subscribe({
			next(value) {
				if (isObservableError(value)) completion.reject(value);
				else values.push(value);
			},
			error: completion.reject,
			complete: completion.resolve,
		});
		cell.set(1);
		cell.set(2);
		cell[Symbol.dispose]();
		await completion.promise;
		expect(values).toEqual([10, 20]);
		expect(subscription.closed).toBe(true);
	});

	it('closes a late Observable subscriber without replaying the final value', () => {
		const cell = state.create(1);
		cell[Symbol.dispose]();
		let completed = 0;
		const values: number[] = [];
		const subscription = cell.reader.changes.subscribe({
			next: ({ value }) => values.push(value),
			complete: () => completed++,
		});
		expect(subscription.closed).toBe(true);
		expect(completed).toBe(1);
		expect(values).toEqual([]);
	});

	it('unsubscribes one Observable consumer without closing the borrowed cell', () => {
		using cell = state.create(0);
		const controller = new AbortController();
		const stopped: number[] = [];
		const active: number[] = [];
		const subscription = cell.reader.changes.subscribe({ next: ({ value }) => stopped.push(value) }, {
			signal: controller.signal,
		});
		using _active = cell.reader.changes.subscribe(({ value }) => active.push(value));
		controller.abort();
		cell.set(1);
		expect(subscription.closed).toBe(true);
		expect(stopped).toEqual([]);
		expect(active).toEqual([1]);
		expect(cell.closed).toBe(false);
	});

	it('does not deliver an in-flight change to observers added during its notification', () => {
		using cell = state.create(0);
		const callbacks: number[] = [];
		const observable: number[] = [];
		using first = cell.reader.subscribe(() => {
			if (cell.reader.revision !== 1) return;
			cell.reader.subscribe(({ value }) => callbacks.push(value));
			cell.reader.changes.subscribe(({ value }) => observable.push(value));
		});
		cell.set(1);
		expect(callbacks).toEqual([]);
		expect(observable).toEqual([]);
		cell.set(2);
		expect(callbacks).toEqual([2]);
		expect(observable).toEqual([2]);
		void first;
	});

	it('contains async diagnostic rejection without recursion or losing an undefined failure', async () => {
		let diagnostic = Promise.resolve();
		let reported = Promise.withResolvers<void>();
		const errors: unknown[] = [];
		const seen: number[] = [];
		using cell = state.create(0, {
			onError(error) {
				errors.push(error);
				reported.resolve();
				return diagnostic;
			},
		});
		const absent: unknown = undefined;
		using _broken = cell.reader.subscribe(async () => {
			throw absent;
		});
		using _other = cell.reader.subscribe(({ value }) => seen.push(value));
		for (const error of [new Error('asynchronous diagnostic failed'), undefined]) {
			const completion = Promise.withResolvers<void>();
			diagnostic = completion.promise;
			reported = Promise.withResolvers<void>();
			cell.set(cell.reader.get() + 1);
			await reported.promise;
			expect(errors.at(-1)).toBe(undefined);
			completion.reject(error);
			await completion.promise.catch(() => {});
			expect(cell.observerError).toBe(error);
		}
		expect(errors).toEqual([undefined, undefined]);
		expect(seen).toEqual([1, 2]);
		expect(cell.reader.get()).toBe(2);
	});
});
