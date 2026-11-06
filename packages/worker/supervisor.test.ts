import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as supervisor from './supervisor.ts';
import type { WorkerTerminationType } from './thread/types.ts';

/** Deterministic owned generation models external commits independently from request delivery. */
function generation() {
	const terminal = Promise.withResolvers<WorkerTerminationType>();
	let stops = 0;
	let calls = 0;
	const response = Promise.withResolvers<number>();
	const worker: supervisor.GenerationType<number, number> = {
		closed: terminal.promise,
		request() {
			calls++;
			return response.promise;
		},
		async stop(reason) {
			stops++;
			terminal.resolve({ status: 'stopped', forced: false, reason });
		},
	};
	return {
		worker,
		terminal,
		response,
		get stops() {
			return stops;
		},
		get calls() {
			return calls;
		},
	};
}
/** Promise-only polling fails boundedly when a lifecycle checkpoint was not reached. */
async function until(predicate: () => boolean): Promise<void> {
	for (let index = 0; index < 200 && !predicate(); index++) await Promise.resolve();
	expect(predicate()).toBe(true);
}
const options = { maximumRestarts: 1, maximumRequests: 1, backoff: 0 };

describe('restart supervision without replay', () => {
	it('surfaces uncertain completion after an external commit, ignores late replies and admits only new calls', async () => {
		await using owner = context.create({ id: 'supervised' });
		const first = generation();
		const second = generation();
		let attempts = 0;
		let commits = 0;
		const lifecycle = supervisor.create(owner, () => ++attempts === 1 ? first.worker : second.worker, options);
		const events: string[] = [];
		const subscription = lifecycle.events.subscribe((event) => events.push(event.status));
		await lifecycle.ready;
		const request = lifecycle.request(owner, 1);
		commits++;
		await expect(lifecycle.request(owner, 2)).rejects.toBeInstanceOf(supervisor.UnavailableError);
		first.terminal.resolve({ status: 'stopped', forced: true, reason: 'transport lost after commit' });
		await expect(request).rejects.toBeInstanceOf(supervisor.UncertainRequestError);
		// A real owner clock controls backoff; allow its zero-millisecond host wait to run.
		await new Promise((resolve) => setTimeout(resolve, 0));
		await until(() => attempts === 2 && lifecycle.status.status === 'ready');
		expect(first.calls).toBe(1);
		expect(second.calls).toBe(0);
		expect(commits).toBe(1);
		first.response.resolve(999);
		const next = lifecycle.request(owner, 3);
		second.response.resolve(3);
		expect(await next).toBe(3);
		const stop = lifecycle.stop('done');
		expect(lifecycle.stop('other')).toBe(stop);
		await stop;
		expect((await lifecycle.closed).status).toBe('stopped');
		expect(first.stops).toBe(1);
		expect(second.stops).toBe(1);
		expect(events).toContain('backoff');
		subscription.unsubscribe();
	});
	it('bounds startup failures and rejects readiness after exhaustion, including thrown undefined', async () => {
		await using owner = context.create({ id: 'exhaustion' });
		let attempts = 0;
		const lifecycle = supervisor.create(owner, () => {
			attempts++;
			throw undefined;
		}, { ...options, maximumRestarts: 2 });
		await expect(lifecycle.ready).rejects.toBe(undefined);
		expect(await lifecycle.closed).toEqual({ status: 'exhausted', attempts: 3, reason: undefined });
		expect(attempts).toBe(3);
	});
	it('joins a late startup generation after stop without admitting requests', async () => {
		await using owner = context.create({ id: 'late' });
		const created = generation();
		const startup = Promise.withResolvers<supervisor.GenerationType<number, number>>();
		let started = false;
		const lifecycle = supervisor.create(owner, (_generation, signal) => {
			started = true;
			expect(signal.aborted).toBe(false);
			return startup.promise;
		}, options);
		await until(() => started);
		const stop = lifecycle.stop(null);
		let settled = false;
		void stop.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		await expect(lifecycle.request(owner, 1)).rejects.toBeInstanceOf(supervisor.UnavailableError);
		startup.resolve(created.worker);
		await stop;
		expect(created.stops).toBe(1);
		expect(created.calls).toBe(0);
		expect((await lifecycle.closed).reason).toBe(null);
	});
	it('cancels backoff and never creates a replacement after stop', async () => {
		let waiting = false;
		let cancelled = false;
		const clock = {
			...new context.TestClock(),
			now: () => new context.TestClock().now(),
			sleep(_ms: number, signal?: AbortSignal): Promise<void> {
				waiting = true;
				return new Promise((_resolve, reject) => {
					signal?.addEventListener('abort', () => {
						cancelled = true;
						reject(signal.reason);
					}, { once: true });
				});
			},
		};
		await using owner = context.create({ id: 'backoff', clock });
		let attempts = 0;
		const lifecycle = supervisor.create(owner, () => {
			attempts++;
			throw new Error('startup');
		}, { ...options, backoff: 10 });
		await until(() => waiting);
		await lifecycle.stop('cancel');
		expect(cancelled).toBe(true);
		expect(attempts).toBe(1);
	});
	it('halts on unconfirmed termination without double resource ownership', async () => {
		await using owner = context.create({ id: 'unconfirmed' });
		const first = generation();
		let attempts = 0;
		const failure = new Error('native terminate failed');
		const lifecycle = supervisor.create(owner, () => {
			attempts++;
			return first.worker;
		}, options);
		await lifecycle.ready;
		first.terminal.resolve({ status: 'failed', forced: true, reason: failure });
		expect(await lifecycle.closed).toEqual({ status: 'failed', attempts: 1, reason: failure });
		await expect(lifecycle.stop()).rejects.toBe(failure);
		expect(attempts).toBe(1);
	});
});
