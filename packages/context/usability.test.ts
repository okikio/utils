import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from './mod.ts';
import { days, ns } from '@okikio/duration';

describe('context elapsed budgets and observations', () => {
	it('uses the same day constructor for a deadline, a wait, and logical clock advancement', async () => {
		const clock = new context.TestClock();
		await using owner = context.create({ id: 'daily-import', clock });
		await using child = context.timeout(owner, days(2));
		const waiting = context.wait(child, days(1));
		clock.advance(days(1));
		await waiting;
		expect(context.remaining(child)?.total('hours')).toBe(24);
		expect(child.signal.aborted).toBe(false);
	});

	it('reports exact nanoseconds and long budgets independently of timer slices', async () => {
		const clock = new context.TestClock();
		await using owner = context.create({ id: 'exact-budget', clock });
		await using tiny = context.timeout(owner, ns(1));
		await using long = context.timeout(owner, days(40));
		expect(context.remaining(tiny)?.total('nanoseconds')).toBe(1);
		expect(context.remaining(long)?.total('hours')).toBe(960);
		clock.advance(ns(1));
		expect(context.remaining(tiny)?.total('nanoseconds')).toBe(0);
	});

	it('slices long waits and leaves cancellation responsive between slices', async () => {
		const logical = new context.TestClock();
		const sleeps: number[] = [];
		const clock: context.Clock = {
			now: () => logical.now(),
			sleep(milliseconds, signal) {
				sleeps.push(milliseconds);
				return logical.sleep(milliseconds, signal);
			},
		};
		await using owner = context.create({ id: 'long-wait', clock });
		const waiting = context.wait(owner, days(40));
		expect(sleeps).toEqual([2_147_483_647]);
		logical.advance({ milliseconds: 2_147_483_647 });
		await Promise.resolve();
		expect(sleeps).toEqual([2_147_483_647, 1_308_516_353]);
		context.cancel(owner, null);
		try {
			await waiting;
			throw new Error('Expected cancellation.');
		} catch (error) {
			expect(error).toBeInstanceOf(context.ContextCancelledError);
			expect((error as context.ContextCancelledError).reason).toBe(null);
		}
	});

	it('preserves null cancellation in deterministic and system clocks', async () => {
		const controller = new AbortController();
		const clock = new context.TestClock();
		const logical = clock.sleep(10, controller.signal).catch((reason: unknown) => reason);
		controller.abort(null);
		expect(await logical).toBe(null);
		expect(await clock.sleep(1, controller.signal).catch((reason: unknown) => reason)).toBe(null);
		expect(await context.delay(1, controller.signal).catch((reason: unknown) => reason)).toBe(null);
		const borrowedController = { signal: controller.signal, abort: (reason?: unknown) => controller.abort(reason) };
		expect(await context.delay(1, borrowedController).catch((reason: unknown) => reason)).toBe(null);
	});

	it('exposes the same state and event capabilities through the package facade', () => {
		expect(context.createState).toBe(context.state.create);
		expect(context.fromEvents).toBe(context.events.from);
		using progress = context.createState(0);
		const values: number[] = [];
		using _observed = progress.reader.subscribe(({ value }) => values.push(value));
		progress.set(1);
		expect(values).toEqual([1]);
	});
});
