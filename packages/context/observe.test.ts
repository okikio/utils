/** Transport observation must not pretend to cancel the operation being observed. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';

describe('context transport boundaries', () => {
	it('returns settlement and preserves exact cancellation while consuming later rejection', async () => {
		const controller = new AbortController();
		expect(await context.observe(controller.signal, Promise.resolve('value'))).toBe('value');
		const pending = Promise.withResolvers<string>();
		const observed = context.observe(controller.signal, pending.promise);
		const reason = { cancelled: true };
		controller.abort(reason);
		await expect(observed).rejects.toBe(reason);
		pending.reject(new Error('Late validator rejection.'));
		await Promise.resolve();
		await expect(context.observe(controller.signal, Promise.resolve('late result'))).rejects.toBe(reason);
	});
	it('accepts snapshot data and rejects accessors without executing them', () => {
		const snapshot = { id: 'request', startedAt: '2030-01-01T00:00:00Z' };
		expect(context.isSnapshot(snapshot)).toBe(true);
		expect(context.isSnapshot({ ...snapshot, deadline: 42 })).toBe(false);
		let reads = 0;
		expect(context.isSnapshot({
			...snapshot,
			get traceId() {
				reads++;
				return 'trace';
			},
		})).toBe(false);
		expect(reads).toBe(0);
	});
});
