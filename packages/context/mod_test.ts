import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as context from './mod.ts';

describe('context', () => {
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
