import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as context from '@okikio/context';
import * as dispatch from './dispatch.ts';
import type {
	ActivityJobResultType,
	ActivityJobType,
	EngineChoiceModeType,
	ExecutorJoinOptions,
	WorkflowDurableValue,
} from './types.ts';

/** Build one JSON-safe activity item without importing live activity definitions. */
function item(
	ctx: context.Context,
	input: string,
	placement: readonly Readonly<{ readonly engine: string; readonly mode: EngineChoiceModeType }>[],
	affinity?: Readonly<Record<string, string | number | boolean>>,
): ActivityJobType {
	return Object.freeze({
		activityId: 'test.store',
		activityVersion: '1',
		input,
		origin: Object.freeze({
			workflowId: 'test.workflow',
			workflowVersion: '1',
			runId: 'test-run',
			instructionPath: input,
			instructionFingerprint: `fingerprint:${input}`,
		}),
		context: context.snapshot(ctx),
		...(affinity === undefined ? {} : { affinity }),
		placement: Object.freeze(placement.map((choice) => Object.freeze({ ...choice }))),
	});
}

/** Build one executor advertisement for low-level dispatch tests. */
function host(engineId: string, hostId: string, input: Partial<ExecutorJoinOptions> = {}): ExecutorJoinOptions {
	return Object.freeze({
		engineId,
		hostId,
		activities: Object.freeze([{ id: 'test.store', version: '1' }]),
		capacity: 1,
		protocolVersion: 1,
		...input,
	});
}

/** Return one successful stored terminal value. */
function success(value: WorkflowDurableValue): ActivityJobResultType {
	return Object.freeze(
		{ type: 'success', value: Object.freeze({ kind: 'value', value }) } satisfies ActivityJobResultType,
	);
}

/** Track real TestClock ownership and publish registrations without polling microtasks. */
function trackedClock() {
	const time = new context.TestClock();
	const active = new Set<object>();
	const registrations: number[] = [];
	const readers: ((milliseconds: number) => void)[] = [];
	const clock: context.Clock = {
		now: () => time.now(),
		sleep(milliseconds, signal) {
			const token = {};
			active.add(token);
			const reader = readers.shift();
			if (reader === undefined) registrations.push(milliseconds);
			else reader(milliseconds);
			try {
				return time.sleep(milliseconds, signal).finally(() => active.delete(token));
			} catch (error) {
				active.delete(token);
				throw error;
			}
		},
	};
	return {
		clock,
		time,
		active: () => active.size,
		nextSleep: () => {
			const registered = registrations.shift();
			return registered === undefined
				? new Promise<number>((resolve) => readers.push(resolve))
				: Promise.resolve(registered);
		},
	};
}

describe('activity dispatch memory contract', () => {
	for (const action of ['complete', 'cancel', 'close', 'abort'] as const) {
		it(`releases a watched claim's timer after ${action} without canceling borrowed ownership`, async () => {
			const tracked = trackedClock();
			await using ctx = context.create({ id: `dispatch-wait-cleanup-${action}`, clock: tracked.clock });
			await using store = dispatch.memory({ clock: tracked.clock });
			const executor = await store.join(ctx, host('engine', 'host'));
			const ref = await store.add(ctx, item(ctx, 'watched', [{ engine: 'engine', mode: 'required' }]), {
				key: 'watched',
			});
			const claim = (await store.claim(ctx, executor, { duration: { seconds: 5 } }))[0]!;
			const waiting = store.watch(ctx, claim);
			const terminal = Promise.allSettled([waiting]);
			try {
				expect(await tracked.nextSleep()).toBeGreaterThan(0);
				expect(tracked.active()).toBeGreaterThan(0);
				if (action === 'complete') await store.complete(ctx, claim, success('finished'));
				else if (action === 'cancel') await store.cancel(ctx, ref);
				else if (action === 'close') await store.close('Dispatch owner finished.');
				else context.cancel(ctx, 'Caller canceled.');
				const result = (await terminal)[0]!;
				if (action === 'complete' || action === 'cancel') {
					expect(result.status).toBe('fulfilled');
					if (result.status === 'fulfilled') expect(result.value).toBe(action === 'complete' ? 'lost' : 'cancelled');
				} else {
					expect(result.status).toBe('rejected');
					if (result.status === 'rejected') {
						if (action === 'close') expect(result.reason).toBeInstanceOf(dispatch.DispatchClosedError);
						else expect(result.reason).toBe(ctx.signal.reason);
					}
				}
				expect(tracked.active()).toBe(0);
				expect(ctx.signal.aborted).toBe(action === 'abort');
			} finally {
				await store.close('Wait cleanup fixture finished.');
				await terminal;
			}
		});
	}

	it('cancels a replaced claim-wait timer when an executor mutation admits work', async () => {
		const tracked = trackedClock();
		await using ctx = context.create({ id: 'dispatch-capacity-wake-cleanup', clock: tracked.clock });
		await using store = dispatch.memory({ clock: tracked.clock });
		const executor = await store.join(ctx, host('engine', 'host'));
		await store.add(ctx, item(ctx, 'first', [{ engine: 'engine', mode: 'required' }]), { key: 'first' });
		const first = (await store.claim(ctx, executor, { duration: { seconds: 5 } }))[0]!;
		await store.add(ctx, item(ctx, 'second', [{ engine: 'engine', mode: 'required' }]), { key: 'second' });
		const waiting = store.claim(ctx, executor, { duration: { seconds: 5 }, wait: true });
		const terminal = Promise.allSettled([waiting]);
		try {
			expect(await tracked.nextSleep()).toBeGreaterThan(0);
			await store.resize(ctx, executor, 2);
			const claims = await waiting;
			expect(claims.map((claim) => claim.value.input)).toEqual(['second']);
			expect(tracked.active()).toBe(0);
			expect(ctx.signal.aborted).toBe(false);
			await store.complete(ctx, first, success('first'));
			await store.complete(ctx, claims[0]!, success('second'));
		} finally {
			await store.close('Capacity wake fixture finished.');
			await terminal;
		}
	});

	it('waits through bounded long retry slices and rechecks actual availability', async () => {
		const tracked = trackedClock();
		await using ctx = context.create({ id: 'dispatch-long-retry', clock: tracked.clock });
		await using store = dispatch.memory({ clock: tracked.clock });
		const executor = await store.join(ctx, host('engine', 'host'));
		await store.add(ctx, item(ctx, 'long-retry', [{ engine: 'engine', mode: 'required' }]), { key: 'long-retry' });
		const first = (await store.claim(ctx, executor, { duration: { seconds: 5 } }))[0]!;
		const availableAt = tracked.time.now().add({ milliseconds: 2 * 2_147_483_647 + 5 });
		await store.retry(ctx, first, { delay: { milliseconds: 2 * 2_147_483_647 + 5 } });
		const waiting = store.claim(ctx, executor, { duration: { seconds: 5 }, wait: true });
		const terminal = Promise.allSettled([waiting]);
		try {
			let milliseconds = await tracked.nextSleep();
			for (let slice = 0; slice < 2; slice += 1) {
				expect(milliseconds).toBeGreaterThan(0);
				expect(milliseconds).toBeLessThanOrEqual(2_147_483_647);
				const next = tracked.nextSleep();
				tracked.time.advance({ milliseconds });
				const outcome = await Promise.race([
					next.then((delay) => ({ kind: 'sleep' as const, delay })),
					waiting.then(() => ({ kind: 'premature' as const })),
				]);
				expect(outcome.kind).toBe('sleep');
				if (outcome.kind !== 'sleep') throw new Error('Retry was claimed before its availability boundary.');
				milliseconds = outcome.delay;
			}
			expect(milliseconds).toBeGreaterThan(0);
			expect(milliseconds).toBeLessThanOrEqual(2_147_483_647);
			expect(tracked.active()).toBe(1);
			tracked.time.set(availableAt);
			const claims = await waiting;
			expect(claims.map((claim) => [claim.value.input, claim.attempt])).toEqual([['long-retry', 2]]);
			expect(tracked.active()).toBe(0);
			expect(ctx.signal.aborted).toBe(false);
			await store.complete(ctx, claims[0]!, success('finished'));
		} finally {
			await store.close('Long retry fixture finished.');
			await terminal;
		}
	});

	it('keeps compute topology optional while preserving parent metadata when supplied', async () => {
		await using ctx = context.create({ id: 'dispatch-compute' });
		await using store = dispatch.memory();
		const flat = await store.join(ctx, host('flat', 'flat-1'));
		const nested = await store.join(
			ctx,
			host('threaded', 'thread-1', {
				compute: { id: 'thread-1', kind: 'thread', parent: 'process-7', attributes: { pool: 'analysis' } },
			}),
		);

		expect(flat.compute).toBeUndefined();
		expect(nested.compute).toEqual({
			id: 'thread-1',
			kind: 'thread',
			parent: 'process-7',
			attributes: { pool: 'analysis' },
		});
	});

	it('routes preferred work before fallback and uses fallback after preferred capacity fills', async () => {
		await using ctx = context.create({ id: 'dispatch-placement' });
		await using store = dispatch.memory();
		const preferred = await store.join(ctx, host('preferred', 'preferred-1'));
		const fallback = await store.join(ctx, host('fallback', 'fallback-1'));
		const placement = Object.freeze([
			Object.freeze({ engine: 'preferred', mode: 'preferred' as const }),
			Object.freeze({ engine: 'fallback', mode: 'allowed' as const }),
		]);
		await store.add(ctx, item(ctx, 'first', placement), { key: 'first' });
		expect(await store.claim(ctx, fallback, { duration: { seconds: 5 } })).toHaveLength(0);
		const first = await store.claim(ctx, preferred, { duration: { seconds: 5 } });
		expect(first).toHaveLength(1);

		await store.add(ctx, item(ctx, 'second', placement), { key: 'second' });
		const second = await store.claim(ctx, fallback, { duration: { seconds: 5 } });
		expect(second).toHaveLength(1);
		await store.complete(ctx, first[0]!, success('first'));
		await store.complete(ctx, second[0]!, success('second'));
	});

	it('matches activity version and affinity before transferring attempt ownership', async () => {
		await using ctx = context.create({ id: 'dispatch-affinity' });
		await using store = dispatch.memory();
		const west = await store.join(ctx, host('browser', 'west', { affinity: { region: 'west', browser: 'chromium' } }));
		const east = await store.join(ctx, host('browser', 'east', { affinity: { region: 'east', browser: 'chromium' } }));
		await store.add(ctx, item(ctx, 'east-only', [{ engine: 'browser', mode: 'required' }], { region: 'east' }), {
			key: 'east-only',
		});

		expect(await store.claim(ctx, west, { duration: { seconds: 5 } })).toHaveLength(0);
		const claimed = await store.claim(ctx, east, { duration: { seconds: 5 } });
		expect(claimed[0]?.value.input).toBe('east-only');
	});

	it('requeues work on host replacement and rejects the stale generation result', async () => {
		await using ctx = context.create({ id: 'dispatch-generation' });
		await using store = dispatch.memory();
		const first = await store.join(ctx, host('engine', 'same-host'));
		const ref = await store.add(ctx, item(ctx, 'replace', [{ engine: 'engine', mode: 'required' }]), {
			key: 'replace',
		});
		const firstClaim = (await store.claim(ctx, first, { duration: { seconds: 5 } }))[0]!;
		const second = await store.join(ctx, host('engine', 'same-host'));

		expect(second.generation).toBe(first.generation + 1);
		await expect(store.complete(ctx, firstClaim, success('stale'))).rejects.toBeInstanceOf(
			dispatch.StaleActivityClaimError,
		);
		const secondClaim = (await store.claim(ctx, second, { duration: { seconds: 5 } }))[0]!;
		expect(secondClaim.attempt).toBe(2);
		await store.complete(ctx, secondClaim, success('current'));
		expect(await store.result(ctx, ref)).toEqual(success('current'));
	});

	it('wakes the current executor when producer cancellation settles its item', async () => {
		await using ctx = context.create({ id: 'dispatch-cancel' });
		await using store = dispatch.memory();
		const executor = await store.join(ctx, host('engine', 'host'));
		const ref = await store.add(ctx, item(ctx, 'cancel', [{ engine: 'engine', mode: 'required' }]), { key: 'cancel' });
		const claim = (await store.claim(ctx, executor, { duration: { seconds: 5 } }))[0]!;
		const watched = store.watch(ctx, claim);
		await store.cancel(ctx, ref);

		expect(await watched).toBe('cancelled');
		expect((await store.result(ctx, ref)).type).toBe('cancelled');
		expect((await store.stats()).claimed).toBe(0);
	});

	it('uses the dispatch clock to wake a waiter after a delayed retry', async () => {
		const clock = new context.TestClock();
		await using ctx = context.create({ id: 'dispatch-virtual-retry', clock });
		await using store = dispatch.memory({ clock });
		const executor = await store.join(ctx, host('engine', 'host'));
		await store.add(ctx, item(ctx, 'virtual-retry', [{ engine: 'engine', mode: 'required' }]), {
			key: 'virtual-retry',
		});
		const first = (await store.claim(ctx, executor, { duration: { seconds: 5 } }))[0]!;
		await store.retry(ctx, first, { delay: { seconds: 5 } });
		const waiting = store.claim(ctx, executor, { duration: { seconds: 5 }, wait: true });
		await Promise.resolve();
		clock.advance({ seconds: 5 });
		const claimed = await waiting;
		expect(claimed[0]?.attempt).toBe(2);
	});

	for (const foreign of [false, true]) {
		it(`wakes a sub-millisecond retry${foreign ? ' beside ready foreign work' : ''}`, async () => {
			const time = new context.TestClock('2000-01-01T00:00:00.000100000Z');
			const sleeps: number[] = [];
			const clock: context.Clock = {
				now: () => time.now(),
				sleep(milliseconds, signal) {
					sleeps.push(milliseconds);
					return time.sleep(milliseconds, signal);
				},
			};
			await using ctx = context.create({ id: 'dispatch-fractional-retry', clock });
			await using store = dispatch.memory({ clock });
			const executor = await store.join(ctx, host('engine', 'host'));
			if (foreign) {
				await store.add(ctx, item(ctx, 'foreign', [{ engine: 'other', mode: 'required' }]), { key: 'foreign' });
			}
			await store.add(ctx, item(ctx, 'fractional', [{ engine: 'engine', mode: 'required' }]), { key: 'fractional' });
			const first = (await store.claim(ctx, executor, { duration: { seconds: 5 } }))[0]!;
			await store.retry(ctx, first, { delay: { microseconds: 700 } });
			const waiting = store.claim(ctx, executor, { duration: { seconds: 5 }, wait: true });
			try {
				// Eligibility uses full instants. A future retry needs a wake even when
				// both instants have the same integer millisecond or foreign work is ready.
				expect(sleeps.some((milliseconds) => milliseconds > 0)).toBe(true);
				time.advance({ milliseconds: 1 });
				const claims = await waiting;
				expect(claims.map((claim) => [claim.value.input, claim.attempt])).toEqual([['fractional', 2]]);
			} finally {
				context.cancel(ctx, 'Fractional retry fixture finished.');
				await Promise.allSettled([waiting]);
			}
		});
	}

	it('waits for a queued result without polling when no executor has joined', async () => {
		const time = new context.TestClock();
		const sleeps: number[] = [];
		const clock: context.Clock = {
			now: () => time.now(),
			sleep(milliseconds, signal) {
				sleeps.push(milliseconds);
				return time.sleep(milliseconds, signal);
			},
		};
		await using ctx = context.create({ id: 'dispatch-no-executor', clock });
		await using store = dispatch.memory({ clock });
		const ref = await store.add(ctx, item(ctx, 'waiting', [{ engine: 'engine', mode: 'required' }]), {
			key: 'waiting',
		});
		const waiting = store.result(ctx, ref);
		try {
			expect(sleeps).toEqual([]);
			const executor = await store.join(ctx, host('engine', 'host'));
			const claim = (await store.claim(ctx, executor, { duration: { seconds: 5 } }))[0]!;
			await store.complete(ctx, claim, success('delivered'));
			expect(await waiting).toEqual(success('delivered'));
		} finally {
			context.cancel(ctx, 'Queued result fixture finished.');
			await Promise.allSettled([waiting]);
		}
	});

	for (const action of ['replace', 'expire'] as const) {
		it(`finishes a drain after its executor is ${action === 'replace' ? 'replaced' : 'expired'}`, async () => {
			const clock = new context.TestClock();
			await using ctx = context.create({ id: `dispatch-drain-${action}`, clock });
			await using store = dispatch.memory({ clock });
			const first = await store.join(ctx, host('engine', 'host', { duration: { milliseconds: 1 } }));
			const ref = await store.add(ctx, item(ctx, 'transfer', [{ engine: 'engine', mode: 'required' }]), {
				key: 'transfer',
			});
			const old = (await store.claim(ctx, first, { duration: { seconds: 5 } }))[0]!;
			const draining = store.drain(ctx, first);
			try {
				if (action === 'expire') {
					clock.advance({ milliseconds: 2 });
					await draining;
				}
				const replacement = await store.join(ctx, host('engine', 'host'));
				await draining;
				await expect(store.complete(ctx, old, success('stale'))).rejects.toBeInstanceOf(
					dispatch.StaleActivityClaimError,
				);
				const next = (await store.claim(ctx, replacement, { duration: { seconds: 5 } }))[0]!;
				expect(next.attempt).toBe(2);
				await store.complete(ctx, next, success('transferred'));
				expect(await store.result(ctx, ref)).toEqual(success('transferred'));
			} finally {
				context.cancel(ctx, 'Drain transfer fixture finished.');
				await Promise.allSettled([draining]);
			}
		});
	}

	it('snapshots admitted items and terminal results at the durable boundary', async () => {
		await using ctx = context.create({ id: 'dispatch-snapshot' });
		await using store = dispatch.memory();
		const executor = await store.join(ctx, host('engine', 'host'));
		const input = { value: 'original' };
		const placement = [{ engine: 'engine', mode: 'required' as const }];
		const mutable = { ...item(ctx, 'snapshot', placement), input, placement };
		const ref = await store.add(ctx, mutable, { key: 'snapshot' });
		input.value = 'changed';
		placement[0]!.engine = 'other';
		const claim = (await store.claim(ctx, executor, { duration: { seconds: 5 } }))[0]!;
		expect(claim.value.input).toEqual({ value: 'original' });
		expect(claim.value.placement).toEqual([{ engine: 'engine', mode: 'required' }]);

		const output = { value: 'stored' };
		await store.complete(ctx, claim, { type: 'success', value: { kind: 'value', value: output } });
		output.value = 'changed';
		expect(await store.result(ctx, ref)).toEqual(success({ value: 'stored' }));
	});

	it('snapshots producer cancellation data before it becomes a terminal result', async () => {
		await using ctx = context.create({ id: 'dispatch-cancellation-snapshot' });
		await using store = dispatch.memory();
		const ref = await store.add(ctx, item(ctx, 'cancel-snapshot', [{ engine: 'engine', mode: 'required' }]), {
			key: 'cancel-snapshot',
		});
		const reason = { value: 'stored' };
		await store.cancel(ctx, ref, { kind: 'value', value: reason });
		reason.value = 'changed';
		expect(await store.result(ctx, ref)).toEqual({
			type: 'cancelled',
			reason: { kind: 'value', value: { value: 'stored' } },
		});
	});

	it('rejects accessor-backed compute metadata without invoking the getter', async () => {
		await using ctx = context.create({ id: 'dispatch-compute-accessor' });
		await using store = dispatch.memory();
		let reads = 0;
		const compute = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(compute, 'id', {
			enumerable: true,
			get() {
				reads += 1;
				return 'unsafe';
			},
		});
		await expect(store.join(ctx, host('engine', 'host', { compute: compute as never }))).rejects.toBeInstanceOf(
			TypeError,
		);
		expect(reads).toBe(0);
	});
});
