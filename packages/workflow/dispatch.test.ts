import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as context from '@okikio/context';
import * as dispatch from './dispatch.ts';
import type {
	ActivityDispatch,
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
	return Object.freeze({ type: 'success', value: Object.freeze({ kind: 'value', value }) } satisfies ActivityJobResultType);
}

describe('activity dispatch memory contract', () => {
	it('keeps compute topology optional while preserving parent metadata when supplied', async () => {
		await using ctx = context.create({ id: 'dispatch-compute' });
		await using store = dispatch.memory();
		const flat = await store.join(ctx, host('flat', 'flat-1'));
		const nested = await store.join(ctx, host('threaded', 'thread-1', {
			compute: { id: 'thread-1', kind: 'thread', parent: 'process-7', attributes: { pool: 'analysis' } },
		}));

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
		await store.add(ctx, item(ctx, 'east-only', [{ engine: 'browser', mode: 'required' }], { region: 'east' }), { key: 'east-only' });

		expect(await store.claim(ctx, west, { duration: { seconds: 5 } })).toHaveLength(0);
		const claimed = await store.claim(ctx, east, { duration: { seconds: 5 } });
		expect(claimed[0]?.value.input).toBe('east-only');
	});

	it('requeues work on host replacement and rejects the stale generation result', async () => {
		await using ctx = context.create({ id: 'dispatch-generation' });
		await using store = dispatch.memory();
		const first = await store.join(ctx, host('engine', 'same-host'));
		const ref = await store.add(ctx, item(ctx, 'replace', [{ engine: 'engine', mode: 'required' }]), { key: 'replace' });
		const firstClaim = (await store.claim(ctx, first, { duration: { seconds: 5 } }))[0]!;
		const second = await store.join(ctx, host('engine', 'same-host'));

		expect(second.generation).toBe(first.generation + 1);
		await expect(store.complete(ctx, firstClaim, success('stale'))).rejects.toBeInstanceOf(dispatch.StaleActivityClaimError);
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
		await store.add(ctx, item(ctx, 'virtual-retry', [{ engine: 'engine', mode: 'required' }]), { key: 'virtual-retry' });
		const first = (await store.claim(ctx, executor, { duration: { seconds: 5 } }))[0]!;
		await store.retry(ctx, first, { delay: { seconds: 5 } });
		const waiting = store.claim(ctx, executor, { duration: { seconds: 5 }, wait: true });
		await Promise.resolve();
		clock.advance({ seconds: 5 });
		const claimed = await waiting;
		expect(claimed[0]?.attempt).toBe(2);
	});

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
		const ref = await store.add(ctx, item(ctx, 'cancel-snapshot', [{ engine: 'engine', mode: 'required' }]), { key: 'cancel-snapshot' });
		const reason = { value: 'stored' };
		await store.cancel(ctx, ref, { kind: 'value', value: reason });
		reason.value = 'changed';
		expect(await store.result(ctx, ref)).toEqual({ type: 'cancelled', reason: { kind: 'value', value: { value: 'stored' } } });
	});

	it('rejects accessor-backed compute metadata without invoking the getter', async () => {
		await using ctx = context.create({ id: 'dispatch-compute-accessor' });
		await using store = dispatch.memory();
		let reads = 0;
		const compute = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(compute, 'id', { enumerable: true, get() { reads += 1; return 'unsafe'; } });
		await expect(store.join(ctx, host('engine', 'host', { compute: compute as never }))).rejects.toBeInstanceOf(TypeError);
		expect(reads).toBe(0);
	});
});
