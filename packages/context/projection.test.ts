import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as state from './state.ts';
import { TestClock } from './mod.ts';
import * as testing from './testing.ts';

describe('owned read-only projections', () => {
	it('filters equal values and disposes upstream subscriptions without write authority', () => {
		using source = state.create({ count: 1, text: 'first' });
		using selected = state.select(source.reader, (value) => value.count);
		let notifications = 0;
		using _subscription = selected.subscribe(() => notifications++);
		source.set({ count: 1, text: 'second' });
		expect(notifications).toBe(0);
		source.set({ count: 2, text: 'second' });
		expect(notifications).toBe(1);
		expect(selected.get()).toBe(2);
		expect('set' in selected).toBe(false);
		selected[Symbol.dispose]();
		source.set({ count: 3, text: '' });
		expect(notifications).toBe(1);
		expect(selected.closed).toBe(true);
	});
	it('retains last projection after selector failure and stops reentrant updates after disposal', () => {
		using source = state.create(1);
		const defect = new Error('selector');
		using selected = state.select(source.reader, (value) => {
			if (value === 2) throw defect;
			return value * 2;
		});
		source.set(2);
		expect(selected.get()).toBe(2);
		expect(selected.error).toBe(defect);
		using _subscription = selected.subscribe(() => {
			selected[Symbol.dispose]();
			source.set(4);
		});
		source.set(3);
		expect(selected.closed).toBe(true);
		expect(selected.get()).toBe(6);
	});
	it('combines current values without claiming a multi-cell transaction', () => {
		using left = state.create(1);
		using right = state.create('a');
		using combined = state.combine([left.reader, right.reader], ([count, text]) => `${count}:${text}`);
		const seen: string[] = [];
		using _subscription = combined.subscribe(({ value }) => seen.push(value), { immediate: true });
		left.set(2);
		right.set('b');
		expect(seen).toEqual(['1:a', '2:a', '2:b']);
	});
});

describe('bounded clock simulation', () => {
	it('inspects targets and advances known chained sleeps without native timers', async () => {
		const clock = new TestClock();
		let steps = 0;
		const work = (async () => {
			await clock.sleep(10);
			steps++;
			await clock.sleep(20);
			steps++;
		})();
		expect(testing.pending(clock).length).toBe(1);
		const completed = await testing.advanceUntilIdle(clock, { maximumSteps: 2, maximumMicrotasks: 4 });
		await work;
		expect(steps).toBe(2);
		expect(completed.steps).toBe(2);
		expect(testing.pending(clock)).toEqual([]);
	});
	it('does not silently run an unbounded timer loop', async () => {
		const clock = new TestClock();
		const controller = new AbortController();
		const work = (async () => {
			try {
				while (true) await clock.sleep(1, controller.signal);
			} catch { /* owner stops this test loop */ }
		})();
		await expect(testing.advanceUntilIdle(clock, { maximumSteps: 2, maximumMicrotasks: 4 })).rejects.toThrow(
			RangeError,
		);
		controller.abort();
		await work;
		expect(testing.pending(clock)).toEqual([]);
	});
});
