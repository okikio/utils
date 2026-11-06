import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as capacity from './mod.ts';

describe('immediate capacity admission', () => {
	it('reserves all dimensions or none and restores them exactly once', () => {
		const host = capacity.create({ cpu: 2, upload: 1 }, { maximumPending: 0 });
		const lease = capacity.tryAcquire(host, { cpu: 1, upload: 1 })!;
		expect(capacity.tryAcquire(host, { cpu: 1, upload: 1 })).toBeUndefined();
		expect(capacity.available(host)).toEqual({ cpu: 1, upload: 0 });
		expect(capacity.snapshot(host).queuedRequests).toBe(0);
		lease.release();
		lease.release();
		expect(capacity.available(host)).toEqual({ cpu: 2, upload: 1 });
	});
	it('does not bypass an older waiter that needs a different scarce dimension', async () => {
		const host = capacity.create({ cpu: 2, upload: 1 });
		const first = capacity.tryAcquire(host, { upload: 1 })!;
		const older = capacity.acquire(host, { cpu: 2, upload: 1 });
		expect(capacity.inspect(host, { cpu: 1 }, { maximumReasons: 2 })).toEqual({
			status: 'queued',
			queuedRequests: 1,
			deficient: [],
			truncated: false,
		});
		expect(capacity.tryAcquire(host, { cpu: 1 })).toBeUndefined();
		expect(capacity.available(host)).toEqual({ cpu: 2, upload: 0 });
		first.release();
		const lease = await older;
		expect(capacity.available(host)).toEqual({ cpu: 0, upload: 0 });
		lease.release();
	});
	it('reports bounded authored reasons without acquiring or queueing', () => {
		const host = capacity.create({ cpu: 1, upload: 1 });
		const lease = capacity.tryAcquire(host, { cpu: 1, upload: 1 })!;
		expect(capacity.inspect(host, { upload: 1, cpu: 1 }, { maximumReasons: 1 })).toEqual({
			status: 'unavailable',
			queuedRequests: 0,
			deficient: ['upload'],
			truncated: true,
		});
		expect(capacity.inspect(host, { cpu: 1 }, { maximumReasons: 0 }).truncated).toBe(true);
		lease.release();
		expect(capacity.inspect(host, { cpu: 1 }, { maximumReasons: 1 }).status).toBe('available');
	});
	it('rejects impossible requests and cancellation before any reservation', () => {
		const host = capacity.create({ cpu: 1 });
		expect(() => capacity.tryAcquire(host, { cpu: 2 })).toThrow(RangeError);
		expect(() => capacity.tryAcquire(host, { other: 0 })).toThrow(RangeError);
		const controller = new AbortController();
		controller.abort(null);
		let caught: unknown = 'not thrown';
		try {
			capacity.tryAcquire(host, { cpu: 1 }, controller.signal);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeNull();
		expect(capacity.available(host)).toEqual({ cpu: 1 });
	});
});
