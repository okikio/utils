import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as context from '@okikio/context';
import * as queue from './mod.ts';

function ids(...values: string[]): () => string {
	let index = 0;
	return () => values[index++] ?? `generated-${index}`;
}

describe('memory queue', () => {
	it('wraps the claimed-work queue in a FIFO-friendly one-at-a-time API', async () => {
		const clock = new context.TestClock();
		await using claimed = queue.memory<string, string>({ clock, id: ids('item-1', 'item-2', 'claim-1', 'claim-2') });
		await using jobs = queue.fifo(claimed, { id: 'fifo-basic', clock, owner: 'task-a' });

		const first = await jobs.add('first');
		await jobs.add('second');
		const taken = await jobs.take({ duration: { seconds: 30 } });
		expect(taken?.value).toBe('first');
		await taken?.complete('done');
		expect(await jobs.result(first)).toBe('done');
	});

	it('renews and recovers FIFO-friendly taken items through the underlying claim rules', async () => {
		const clock = new context.TestClock();
		await using claimed = queue.memory<string, string>({ clock, id: ids('item', 'claim-1', 'claim-2') });
		await using jobs = queue.fifo(claimed, { id: 'fifo-recovery', clock });

		const ref = await jobs.add('value');
		const first = await jobs.take({ duration: { seconds: 5 } });
		const renewed = await first?.renew({ seconds: 20 });
		expect(renewed?.expiresAt.toString()).toBe(clock.now().add({ seconds: 20 }).toString());
		await renewed?.retry({ delay: { seconds: 10 } });
		expect(await jobs.take()).toBeUndefined();

		clock.advance({ seconds: 10 });
		const second = await jobs.take({ duration: { seconds: 5 } });
		expect(second?.attempt).toBe(2);
		await second?.complete('recovered');
		expect(await jobs.result(ref)).toBe('recovered');
	});

	it('claims by priority, preserves FIFO ties, and completes exact claims', async () => {
		const clock = new context.TestClock();
		await using ctx = context.create({ id: 'queue-owner', clock });
		await using jobs = queue.memory<string, string>({ clock, id: ids('item-1', 'item-2', 'item-3', 'claim-1', 'claim-2', 'claim-3') });
		const first = await jobs.add(ctx, 'first', { priority: 1 });
		await jobs.add(ctx, 'second', { priority: 2 });
		await jobs.add(ctx, 'third', { priority: 2 });
		const claims = await jobs.claim(ctx, { limit: 3, owner: 'host-1', duration: { minutes: 1 } });
		expect(claims.map((claim) => claim.value)).toEqual(['second', 'third', 'first']);
		await jobs.complete(ctx, claims[2]!, 'complete');
		expect(await jobs.result(ctx, first)).toBe('complete');
		expect(await jobs.stats()).toMatchObject({ queued: 0, claimed: 2, completed: 1 });
	});

	it('claims one exact logical reference without taking unrelated queued work', async () => {
		const clock = new context.TestClock();
		await using ctx = context.create({ id: 'queue-specific-ref', clock });
		await using jobs = queue.memory<string, string>({ clock, id: ids('first', 'second', 'claim') });
		const first = await jobs.add(ctx, 'first');
		const second = await jobs.add(ctx, 'second');
		const claims = await jobs.claim(ctx, { ref: second, owner: 'scheduler', limit: 1, duration: { seconds: 30 } });
		expect(claims.map((claim) => claim.value)).toEqual(['second']);
		await expect(jobs.claim(ctx, { ref: first, owner: 'scheduler', limit: 2 })).rejects.toThrow('limit must be 1');
		await jobs.complete(ctx, claims[0]!, 'done');
		expect((await jobs.claim(ctx))[0]?.value).toBe('first');
	});

	it('waits for one exact item without taking ownership or holding unrelated work', async () => {
		await using ctx = context.create({ id: 'queue-ready-wait', clock: context.SystemClock });
		await using jobs = queue.memory<string, string>({
			clock: context.SystemClock,
			id: ids('delayed', 'other', 'other-claim', 'delayed-claim'),
		});
		const delayed = await jobs.add(ctx, 'delayed', { availableAt: context.SystemClock.now().add({ milliseconds: 15 }) });
		await jobs.add(ctx, 'other');
		const waiting = jobs.wait(ctx, delayed);
		const other = (await jobs.claim(ctx, { owner: 'other-owner' }))[0]!;
		expect(other.value).toBe('other');
		expect(await waiting).toBe('claimable');
		const claim = (await jobs.claim(ctx, { ref: delayed, owner: 'scheduler' }))[0]!;
		expect(claim.value).toBe('delayed');
		await jobs.complete(ctx, claim, 'done');
		expect(await jobs.wait(ctx, delayed)).toBe('terminal');
	});

	it('deduplicates explicit keys and enforces active capacity', async () => {
		await using ctx = context.create({ id: 'queue-capacity', clock: new context.TestClock() });
		await using jobs = queue.memory<string, string>({ capacity: 1, id: ids('item-1') });
		const first = await jobs.add(ctx, 'first', { key: 'same' });
		const duplicate = await jobs.add(ctx, 'ignored', { key: 'same' });
		expect(duplicate).toEqual(first);
		await expect(jobs.add(ctx, 'second')).rejects.toThrow(queue.QueueCapacityError);
	});

	it('rejects stale completion after claim expiry and allows recovery', async () => {
		const clock = new context.TestClock();
		await using ctx = context.create({ id: 'queue-expiry', clock });
		await using jobs = queue.memory<string, string>({ clock, id: ids('item', 'claim-1', 'claim-2') });
		await jobs.add(ctx, 'value');
		const first = (await jobs.claim(ctx, { duration: { seconds: 5 } }))[0]!;
		clock.advance({ seconds: 6 });
		const second = (await jobs.claim(ctx, { duration: { seconds: 5 }, owner: 'recovery' }))[0]!;
		expect(second.attempt).toBe(2);
		await expect(jobs.complete(ctx, first, 'stale')).rejects.toThrow(queue.StaleClaimError);
		await expect(jobs.cancel(ctx, first, 'stale cancellation')).rejects.toThrow(queue.StaleClaimError);
		await jobs.complete(ctx, second, 'recovered');
		expect(await jobs.result(ctx, { id: first.itemId })).toBe('recovered');
	});

	it('retries with delayed availability and renews exact ownership', async () => {
		const clock = new context.TestClock();
		await using ctx = context.create({ id: 'queue-retry', clock });
		await using jobs = queue.memory<string, string>({ clock, id: ids('item', 'claim-1', 'claim-2') });
		await jobs.add(ctx, 'value');
		const first = (await jobs.claim(ctx, { duration: { seconds: 5 } }))[0]!;
		const renewed = await jobs.renew(ctx, first, { seconds: 20 });
		expect(renewed.expiresAt.toString()).toBe(clock.now().add({ seconds: 20 }).toString());
		await jobs.retry(ctx, renewed, { delay: { seconds: 10 } });
		expect(await jobs.claim(ctx)).toEqual([]);
		clock.advance({ seconds: 10 });
		const second = (await jobs.claim(ctx))[0]!;
		expect(second.attempt).toBe(2);
	});

	it('surfaces encoded failures and cancellation to result waiters', async () => {
		await using ctx = context.create({ id: 'queue-results', clock: new context.TestClock() });
		await using jobs = queue.memory<string, string>({ id: ids('failed-item', 'claim', 'cancelled-item') });
		const failedRef = await jobs.add(ctx, 'failed');
		const failedClaim = (await jobs.claim(ctx))[0]!;
		await jobs.fail(ctx, failedClaim, { id: 'test.failure', data: {}, message: 'failed intentionally' });
		await expect(jobs.result(ctx, failedRef)).rejects.toThrow(queue.QueueItemFailedError);
		const cancelledRef = await jobs.add(ctx, 'cancelled');
		await jobs.cancel(ctx, cancelledRef, 'not needed');
		await expect(jobs.result(ctx, cancelledRef)).rejects.toThrow(queue.QueueItemCancelledError);
	});

	it('removes cancelled claim waiters and wakes waiters on close', async () => {
		const controller = new AbortController();
		await using ctx = context.create({ id: 'queue-wait', signal: controller.signal, clock: new context.TestClock() });
		await using jobs = queue.memory<string, string>();
		const waiting = jobs.claim(ctx, { wait: true });
		controller.abort('stop waiting');
		await expect(waiting).rejects.toBe('stop waiting');
		expect((await jobs.stats()).waitingClaims).toBe(0);

		await using closeCtx = context.create({ id: 'queue-close', clock: new context.TestClock() });
		const closing = jobs.claim(closeCtx, { wait: true });
		await jobs.close('shutdown');
		await expect(closing).rejects.toThrow(queue.QueueClosedError);
	});

	it('wakes waiting claims when delayed work becomes available and when ownership expires', async () => {
		await using ctx = context.create({ id: 'queue-time-wake', clock: context.SystemClock });
		await using jobs = queue.memory<string, string>({
			clock: context.SystemClock,
			id: ids('delayed-item', 'delayed-claim', 'expired-item', 'first-claim', 'recovery-claim'),
		});
		await jobs.add(ctx, 'delayed', { availableAt: context.SystemClock.now().add({ milliseconds: 10 }) });
		const delayed = await jobs.claim(ctx, { wait: true, duration: { milliseconds: 20 } });
		expect(delayed[0]?.value).toBe('delayed');
		await jobs.complete(ctx, delayed[0]!, 'done');

		await jobs.add(ctx, 'expires');
		const first = (await jobs.claim(ctx, { duration: { milliseconds: 10 } }))[0]!;
		const recovered = await jobs.claim(ctx, { wait: true, owner: 'recovery', duration: { milliseconds: 20 } });
		expect(recovered[0]?.itemId).toBe(first.itemId);
		expect(recovered[0]?.attempt).toBe(2);
	});

	it('rejects invalid claim and retry timing instead of creating immediately stale ownership', async () => {
		await using ctx = context.create({ id: 'queue-invalid-duration', clock: new context.TestClock() });
		expect(() => queue.memory<string, string>({ defaultClaimDuration: {} })).toThrow('default claim duration must be positive');
		await using jobs = queue.memory<string, string>({ id: ids('item', 'claim') });
		await jobs.add(ctx, 'value');
		await expect(jobs.claim(ctx, { duration: {} })).rejects.toThrow('claim duration must be positive');
		const claim = (await jobs.claim(ctx))[0]!;
		await expect(jobs.renew(ctx, claim, {})).rejects.toThrow('claim renewal duration must be positive');
		await expect(jobs.retry(ctx, claim, { delay: { seconds: 1 }, availableAt: ctx.clock.now() })).rejects.toThrow(
			'either availableAt or delay',
		);
	});

	it('keeps the first input authoritative when a producer reuses one idempotency key', async () => {
		await using ctx = context.create({ id: 'queue-key-input', clock: new context.TestClock() });
		await using jobs = queue.memory<string, string>({ id: ids('item', 'claim') });
		const first = await jobs.add(ctx, 'original', { key: 'report:1' });
		const duplicate = await jobs.add(ctx, 'replacement', { key: 'report:1' });
		expect(duplicate).toEqual(first);
		const claim = (await jobs.claim(ctx, { ref: first }))[0]!;
		expect(claim.value).toBe('original');
	});

	it('keeps a key attached to its terminal item for idempotent result retrieval', async () => {
		await using ctx = context.create({ id: 'queue-terminal-key', clock: new context.TestClock() });
		await using jobs = queue.memory<string, string>({ id: ids('item', 'claim') });
		const first = await jobs.add(ctx, 'original', { key: 'import-1' });
		const claim = (await jobs.claim(ctx))[0]!;
		await jobs.complete(ctx, claim, 'stored result');
		const duplicate = await jobs.add(ctx, 'replacement', { key: 'import-1' });
		expect(duplicate).toEqual(first);
		expect(await jobs.result(ctx, duplicate)).toBe('stored result');
	});

});
