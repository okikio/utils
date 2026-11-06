import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as state from '@okikio/context/state';
import * as effect from '@okikio/capability/effect';
import * as task from './mod.ts';
import { combine } from './progress.ts';
import type { ProgressType } from './progress.ts';
describe('weighted progress readers', () => {
	it('preserves unknown totals, explicit weights, changing totals and known empty work', () => {
		using first = state.create<ProgressType | undefined>({ completed: 5, total: 10 });
		using second = state.create<ProgressType | undefined>(undefined);
		using progress = combine([first.reader, second.reader], { weights: [1, 3], maximumChildren: 2 });
		expect(progress.get()).toEqual({ children: 2, known: 1, ratio: undefined });
		second.set({ completed: 0, total: 0 });
		expect(progress.get().ratio).toBeCloseTo(0.875, 14);
		first.set({ completed: 5, total: 20 });
		expect(progress.get().ratio).toBeCloseTo(0.8125, 14);
		let seen = 0;
		using _listener = progress.subscribe(() => seen++);
		first.set({ completed: 5, total: 20, message: 'unchanged ratio' });
		expect(seen).toBe(0);
		progress[Symbol.dispose]();
		first.set({ completed: 20, total: 20 });
		expect(seen).toBe(0);
	});
	it('rejects invalid bounds/weights and normalizes huge finite weights before summing', () => {
		using source = state.create<ProgressType | undefined>({ completed: 1, total: 1 });
		for (const weight of [0, -1, NaN, Infinity]) {
			expect(() => combine([source.reader], { weights: [weight], maximumChildren: 1 })).toThrow(RangeError);
		}
		expect(() => combine([source.reader], { weights: [], maximumChildren: 1 })).toThrow(TypeError);
		expect(() => combine([source.reader], { weights: [1], maximumChildren: 0 })).toThrow(RangeError);
		for (const value of [{ completed: -1 }, { total: NaN }, { completed: Infinity }]) {
			using invalid = state.create<ProgressType | undefined>(value);
			expect(() => combine([invalid.reader], { weights: [1], maximumChildren: 1 })).toThrow(RangeError);
		}
		using empty = combine([], { weights: [], maximumChildren: 0 });
		expect(empty.get().ratio).toBeUndefined();
		using huge = combine([source.reader, source.reader], {
			weights: [Number.MAX_VALUE, Number.MAX_VALUE],
			maximumChildren: 2,
		});
		expect(huge.get().ratio).toBe(1);
	});
	it('a ratio of one cannot settle a Task or hide failure after the last report', async () => {
		using cell = state.create<ProgressType | undefined>(undefined);
		using progress = combine([cell.reader], { weights: [1], maximumChildren: 1 });
		const gate = Promise.withResolvers<void>();
		const reported = Promise.withResolvers<void>();
		const failure = new Error('failure after 100 percent');
		const child = task.start(async (ctx) => {
			await effect.emit(ctx, task.ProgressEffect, { completed: 1, total: 1 });
			reported.resolve();
			await gate.promise;
			throw failure;
		});
		using _listener = child.updates.subscribe(({ value }) => cell.set(value));
		await reported.promise;
		expect(progress.get().ratio).toBe(1);
		expect(child.status).toBe('running');
		gate.resolve();
		await expect(child.done).rejects.toBe(failure);
		expect(progress.get().ratio).toBe(1);
	});
});
