import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { wake } from './wake.ts';

describe('worker wake-up ownership', () => {
	it('remembers a notification between scanning and waiting', async () => {
		const changes = wake();
		try {
			const beforeScan = changes.version;
			changes.notify();
			await changes.wait(beforeScan, 60_000, AbortSignal.timeout(100));
			expect(changes.version).toBe(beforeScan + 1);
		} finally {
			changes.close();
		}
	});
	it('releases the timer when notified and permits another wait', async () => {
		const changes = wake();
		try {
			const waiting = changes.wait(changes.version, 60_000, AbortSignal.timeout(1000));
			changes.notify();
			await waiting;
			await changes.wait(changes.version, 1, new AbortController().signal);
		} finally {
			changes.close();
		}
	});
	it('releases the subscription on shutdown', async () => {
		const changes = wake();
		try {
			const stop = new AbortController();
			const waiting = changes.wait(changes.version, 60_000, stop.signal);
			stop.abort();
			await waiting;
			changes.notify();
		} finally {
			changes.close();
		}
	});
});
