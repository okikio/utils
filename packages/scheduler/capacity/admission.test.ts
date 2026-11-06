/** Waiting capacity remains bounded and cancellation releases the admission budget. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as capacity from './mod.ts';

describe('bounded admission waits', () => {
	it('rejects excess waiters and admits again after cancellation', async () => {
		const pool = capacity.create({ worker: 1 }, { maximumPending: 1 });
		const lease = await capacity.acquire(pool, { worker: 1 });
		const signal = new AbortController();
		const pending = capacity.acquire(pool, { worker: 1 }, signal.signal);
		const stopped = expect(pending).rejects.toBe('stopped');
		await expect(capacity.acquire(pool, { worker: 1 })).rejects.toBeInstanceOf(capacity.AdmissionWaitLimitError);
		signal.abort('stopped');
		await stopped;
		const next = capacity.acquire(pool, { worker: 1 });
		lease.release();
		(await next).release();
		expect(capacity.snapshot(pool).queuedRequests).toBe(0);
		expect(capacity.available(pool)).toEqual({ worker: 1 });
	});
	it('allows immediate acquisition while zero disables blocked requests', async () => {
		const pool = capacity.create({ worker: 1 }, { maximumPending: 0 });
		const lease = await capacity.acquire(pool, { worker: 1 });
		await expect(capacity.acquire(pool, { worker: 1 })).rejects.toBeInstanceOf(capacity.AdmissionWaitLimitError);
		lease.release();
	});

	it('retains a null cancellation reason before admission and while waiting', async () => {
		const pool = capacity.create({ worker: 1 }, { maximumPending: 1 });
		const cancelled = new AbortController();
		cancelled.abort(null);
		await expect(capacity.acquire(pool, { worker: 1 }, cancelled.signal)).rejects.toBeNull();
		await using lease = await capacity.acquire(pool, { worker: 1 });
		const controller = new AbortController();
		const pending = capacity.acquire(pool, { worker: 1 }, controller.signal);
		const rejected = expect(pending).rejects.toBeNull();
		controller.abort(null);
		await rejected;
		expect(capacity.snapshot(pool).queuedRequests).toBe(0);
		expect(capacity.available(pool)).toEqual({ worker: 0 });
		lease.release();
		expect(capacity.available(pool)).toEqual({ worker: 1 });
	});
});
