import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as context from './mod.ts';

describe('context', () => {
	it('recognizes explicit cancellation and deadline errors without treating arbitrary failures as cancellation', () => {
		const deadline = Temporal.Instant.from('2000-01-01T00:00:00Z');
		expect(context.cancelled(new context.ContextCancelledError('stopped'))).toBe(true);
		expect(context.cancelled(new context.ContextDeadlineExceededError(deadline, deadline))).toBe(true);
		expect(context.cancelled(new Error('failed'))).toBe(false);
	});

	it('inherits parent cancellation and preserves its cause', async () => {
		const parentController = new AbortController();
		await using parent = context.create({ id: 'request-1', signal: parentController.signal });
		await using child = context.child(parent);
		parentController.abort('client disconnected');
		expect(context.cause(child)).toBe('client disconnected');
		expect(() => context.check(child)).toThrow(context.ContextCancelledError);
	});

	it('does not allow a child deadline or timeout to exceed its parent deadline', async () => {
		const clock = new context.TestClock('2026-08-05T00:00:00Z');
		await using parent = context.create({
			id: 'request-2',
			clock,
			deadline: Temporal.Instant.from('2026-08-05T00:00:05Z'),
		});
		await using later = context.deadline(parent, Temporal.Instant.from('2026-08-05T00:00:30Z'));
		await using timeout = context.timeout(parent, { seconds: 30 });
		expect(later.deadline?.toString()).toBe('2026-08-05T00:00:05Z');
		expect(timeout.deadline?.toString()).toBe('2026-08-05T00:00:05Z');
	});

	it('round-trips serializable fields while creating a new local signal', async () => {
		const clock = new context.TestClock('2026-08-05T00:00:00Z');
		await using original = context.create({ id: 'request-3', traceId: 'trace-3', clock });
		const snapshot = context.snapshot(original);
		await using restored = context.restore(snapshot, { clock });
		expect(restored.id).toBe('request-3');
		expect(restored.traceId).toBe('trace-3');
		expect(restored.signal).not.toBe(original.signal);
	});

	it('composes runtime-local views without creating a second cancellation owner', async () => {
		const clock = new context.TestClock('2026-08-05T00:00:00Z');
		await using owned = context.create({ id: 'request-view', clock });
		const permissionView = context.view(owned, { permissions: Object.freeze({}) });
		const combined = context.view(permissionView, { effects: Object.freeze({}) });

		expect(combined.permissions).toBe(permissionView.permissions);
		expect(combined.effects).toEqual({});
		context.cancel(combined, 'stop');
		expect(owned.signal.aborted).toBe(true);
		expect(context.cause(combined)).toBe('stop');
	});

	it('clears owned lifecycle state and resolves asynchronous cleanup exactly once', async () => {
		const events: string[] = [];
		const owned = context.create({ id: 'request-4' });
		owned.defer(async () => {
			await Promise.resolve();
			events.push('cleanup');
		});
		await owned[Symbol.asyncDispose]();
		await owned[Symbol.asyncDispose]();
		await owned.closed;
		expect(owned.signal.aborted).toBe(true);
		expect(events).toEqual(['cleanup']);
	});

	it('advances deterministic sleepers and deadlines without wall-clock timers', async () => {
		const clock = new context.TestClock('2026-08-05T00:00:00Z');
		let slept = false;
		const sleeping = clock.sleep(5_000).then(() => slept = true);
		clock.advance({ seconds: 4 });
		await Promise.resolve();
		expect(slept).toBe(false);
		clock.advance({ seconds: 1 });
		await sleeping;
		expect(slept).toBe(true);

		await using ctx = context.create({
			id: 'deterministic-deadline',
			clock,
			deadline: clock.now().add({ seconds: 10 }),
		});
		clock.advance({ seconds: 10 });
		await Promise.resolve();
		expect(ctx.signal.reason).toBeInstanceOf(context.ContextDeadlineExceededError);
	});

	it('keeps a future deadline within the same millisecond live until the rounded logical wait', async () => {
		const logical = new context.TestClock('2026-08-05T00:00:00.000100Z');
		const waits: number[] = [];
		const clock: context.Clock = {
			now: () => logical.now(),
			sleep: (milliseconds, signal) => {
				waits.push(milliseconds);
				return logical.sleep(milliseconds, signal);
			},
		};
		await using ctx = context.create({
			id: 'fractional-deadline',
			clock,
			deadline: clock.now().add({ nanoseconds: 1 }),
		});
		expect(waits).toEqual([1]);
		expect(ctx.signal.aborted).toBe(false);
		expect(() => context.check(ctx)).not.toThrow();
		logical.advance({ nanoseconds: 999_999 });
		await Promise.resolve();
		expect(ctx.signal.aborted).toBe(false);
		logical.advance({ nanoseconds: 1 });
		await Promise.resolve();
		expect(ctx.signal.reason).toBeInstanceOf(context.ContextDeadlineExceededError);
	});

	it('expires due and past deadlines immediately even when they share the clock millisecond', async () => {
		const clock = new context.TestClock('2026-08-05T00:00:00.000100Z');
		await using due = context.create({ id: 'due-deadline', clock, deadline: clock.now() });
		await using past = context.create({
			id: 'past-deadline',
			clock,
			deadline: clock.now().subtract({ nanoseconds: 1 }),
		});
		expect(due.signal.reason).toBeInstanceOf(context.ContextDeadlineExceededError);
		expect(past.signal.reason).toBeInstanceOf(context.ContextDeadlineExceededError);
	});

	it('keeps the real deadline across repeated maximum timer slices and joins the last wait', async () => {
		const logical = new context.TestClock();
		const maximum = 2_147_483_647;
		const waits: number[] = [];
		let active = 0;
		let latestWait = Promise.resolve();
		const clock: context.Clock = {
			now: () => logical.now(),
			sleep: (milliseconds, signal) => {
				waits.push(milliseconds);
				active++;
				latestWait = logical.sleep(milliseconds, signal).finally(() => active--);
				return latestWait;
			},
		};
		const deadline = clock.now().add({ milliseconds: maximum * 2 + 17 });
		await using ctx = context.create({ id: 'long-deadline', clock, deadline });
		expect(waits).toEqual([maximum]);
		for (let slice = 0; slice < 2; slice++) {
			logical.advance({ milliseconds: maximum });
			await latestWait;
			expect(ctx.signal.aborted).toBe(false);
			expect(active).toBe(1);
		}
		expect(waits).toEqual([maximum, maximum, 17]);
		logical.advance({ milliseconds: 16 });
		expect(ctx.signal.aborted).toBe(false);
		logical.advance({ milliseconds: 1 });
		await latestWait;
		expect(ctx.signal.reason).toBeInstanceOf(context.ContextDeadlineExceededError);
		const reason = ctx.signal.reason as context.ContextDeadlineExceededError;
		expect(reason.deadline).toBe(deadline);
		expect(reason.observedAt.toString()).toBe(deadline.toString());
		await ctx[Symbol.asyncDispose]();
		await ctx.closed;
		expect(active).toBe(0);
	});

	it('prevents long-deadline rescheduling after parent abort or disposal', async () => {
		for (const action of ['abort', 'dispose', 'abort-after-slice'] as const) {
			const logical = new context.TestClock();
			const parent = new AbortController();
			const waits: number[] = [];
			let active = 0;
			const clock: context.Clock = {
				now: () => logical.now(),
				sleep: (milliseconds, signal) => {
					waits.push(milliseconds);
					active++;
					return logical.sleep(milliseconds, signal).finally(() => active--);
				},
			};
			await using ctx = context.create({
				id: `long-deadline-${action}`,
				clock,
				signal: parent.signal,
				deadline: clock.now().add({ hours: 1_440 }),
			});
			const reason = new Error('parent cancelled long work');
			if (action === 'abort-after-slice') logical.advance({ milliseconds: 2_147_483_647 });
			if (action !== 'dispose') parent.abort(reason);
			await ctx[Symbol.asyncDispose]();
			await ctx.closed;
			expect(active).toBe(0);
			if (action !== 'dispose') expect(ctx.signal.reason).toBe(reason);
			else expect(ctx.signal.reason).toBeInstanceOf(context.ContextCancelledError);
			logical.advance({ hours: 1_440 });
			expect(waits).toEqual([2_147_483_647]);
			expect(active).toBe(0);
		}
	});

	it('aborts with an independent clock failure and joins its deadline owner', async () => {
		const failure = new Error('clock unavailable');
		const clock: context.Clock = {
			now: () => Temporal.Instant.from('2000-01-01T00:00:00Z'),
			sleep: () => Promise.reject(failure),
		};
		await using ctx = context.create({ id: 'broken-clock', clock, deadline: clock.now().add({ seconds: 1 }) });
		await Promise.resolve();
		expect(ctx.signal.reason).toBe(failure);
		await ctx[Symbol.asyncDispose]();
		await ctx.closed;
	});

	it('uses the context clock for waits', async () => {
		const clock = new context.TestClock();
		await using ctx = context.create({ id: 'deterministic-wait', clock });
		let settled = false;
		const waiting = context.wait(ctx, { minutes: 2 }).then(() => settled = true);
		clock.advance({ minutes: 1 });
		await Promise.resolve();
		expect(settled).toBe(false);
		clock.advance({ minutes: 1 });
		await waiting;
		expect(settled).toBe(true);
	});

	it('removes external gate callbacks after resume or cancellation', async () => {
		const controller = new AbortController();
		await using ctx = context.create({ id: 'external-gate', signal: controller.signal });
		const waiters = new Set<() => void>();
		const wait = () =>
			context.waitFor(ctx, (resume) => {
				waiters.add(resume);
				return () => {
					waiters.delete(resume);
				};
			});

		const resumed = wait();
		expect(waiters.size).toBe(1);
		waiters.values().next().value!();
		await resumed;
		expect(waiters.size).toBe(0);

		const cancelled = wait();
		controller.abort('stop gate');
		await expect(cancelled).rejects.toBeInstanceOf(context.ContextCancelledError);
		expect(waiters.size).toBe(0);
	});

	it('reports whether a value settles before a controlled clock duration', async () => {
		const clock = new context.TestClock();
		let resolve!: () => void;
		const pending = new Promise<void>((done) => resolve = done);
		const timedOut = context.settles(pending, 1_000, clock);
		clock.advance({ milliseconds: 1_000 });
		expect(await timedOut).toBe(false);

		const settled = context.settles(Promise.reject(new Error('expected shutdown rejection')), 1_000, clock);
		expect(await settled).toBe(true);
		resolve();
	});

	it('delay delegates cancellation to the standard async timer', async () => {
		const controller = new AbortController();
		controller.abort(new Error('cancel timer'));
		await expect(context.delay(10_000, controller)).rejects.toThrow('cancel timer');
	});

	it('wait adds context cancellation semantics to delay', async () => {
		const controller = new AbortController();
		await using ctx = context.create({ id: 'wait-cancel', signal: controller.signal });
		const pending = context.wait(ctx, { seconds: 10 });
		controller.abort('stop');
		await expect(pending).rejects.toBeInstanceOf(context.ContextCancelledError);
	});

	it('wait rejects calendar and timer ranges that cannot map to one runtime delay', async () => {
		await using ctx = context.create({ id: 'wait-range' });
		await expect(context.wait(ctx, { months: 1 })).rejects.toBeInstanceOf(RangeError);
		expect(() => context.delay(-1)).toThrow(RangeError);
	});
});
