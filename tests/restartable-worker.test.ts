import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as activityWorker from '@okikio/activity/worker';
import * as context from '@okikio/context';
import type { EffectOccurrence } from '@okikio/effect';
import * as queue from '@okikio/queue';
import * as workflow from '@okikio/workflow';
import { Committed, Engine, InputSchema, Persist, ResultSchema } from './fixtures/restartable-activity.ts';

interface DurableEntry {
	readonly fingerprint: string;
	completion?: workflow.HistoryCompletionType;
}

/**
 * Tiny shared history backend that retains data but no process-local promises.
 * A new instance models a restarted Scheduler process using the same durable row.
 */
function history(store: Map<string, DurableEntry>): workflow.History {
	let closed = false;
	return Object.freeze({
		async schedule(input: workflow.HistoryInput): Promise<workflow.WorkflowCompletionAny> {
			if (closed) throw new Error('Scenario history replica is closed.');
			const key = `${input.ctx.runId.length}:${input.ctx.runId}:${input.path}`;
			let entry = store.get(key);
			if (entry !== undefined && entry.fingerprint !== input.identity.fingerprint) {
				throw new Error(`Replay divergence at ${input.path}.`);
			}
			if (entry?.completion !== undefined) return await input.decode(entry.completion);
			if (entry === undefined) {
				entry = { fingerprint: input.identity.fingerprint };
				store.set(key, entry);
			}

			try {
				const completion = await input.next();
				const encoded = await input.encode(completion);
				// A stale replica may finish after a replacement has already committed.
				// First durable completion wins; every replica converges through decode.
				entry.completion ??= encoded;
				return await input.decode(entry.completion);
			} catch (error) {
				if (entry.completion !== undefined) return await input.decode(entry.completion);
				throw error;
			}
		},
		async close() { closed = true; },
		async [Symbol.asyncDispose]() { closed = true; },
	});
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => resolve = done);
	return Object.freeze({ promise, resolve });
}

/** Bound one scenario stage so lifecycle regressions fail with the blocked ownership step. */
async function within<Value>(promise: Promise<Value>, label: string, milliseconds = 5_000): Promise<Value> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), milliseconds);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

const Definition = workflow.define({
	id: 'scenario.restartable-worker.workflow',
	version: '1',
	input: InputSchema,
	result: ResultSchema,
	activities: [Persist],
});
const Implementation = workflow.implement(Definition, function* (ctx) {
	return yield* workflow.activity(Persist, ctx.input);
});

test('worker activity survives Scheduler restart without duplicating the external commit', async () => {
	const clock = context.SystemClock;
	await using parent = context.create({ id: 'scenario.restartable-worker.parent', clock });
	const jobs = queue.memory<workflow.ActivityJobType, workflow.ActivityJobResultType>({
		clock,
		defaultClaimDuration: { seconds: 3 },
	});
	const durable = new Map<string, DurableEntry>();
	const committed = new Map<string, EffectOccurrence>();
	const attempts: number[] = [];
	const firstCommit = deferred();
	const secondCommit = deferred();
	const emitter = Object.freeze({
		async emit(_ctx: context.Context, occurrence: EffectOccurrence) {
			if (occurrence.definition !== Committed) throw new TypeError('Unexpected effect definition.');
			attempts.push((occurrence.value as { attempt: number }).attempt);
			if (!committed.has(occurrence.key)) committed.set(occurrence.key, occurrence);
			const attempt = (occurrence.value as { attempt: number }).attempt;
			if (attempt === 1) firstCommit.resolve();
			if (attempt === 2) secondCommit.resolve();
		},
	});

	const workerModule = new URL('./fixtures/restartable-worker.ts', import.meta.url);
	const firstProvider = await activityWorker.create({
		ctx: parent,
		engine: Engine,
		activities: [Persist],
		module: workerModule,
		maximum: 1,
		shutdownMs: 50,
		effect: emitter,
	});
	const firstHistory = history(durable);
	const firstScheduler = workflow.scheduler({
		id: 'scenario-scheduler-a',
		clock,
		history: firstHistory,
		activityQueue: jobs,
		claimDuration: { seconds: 3 },
	});
	const firstRegistration = await firstScheduler.register({
		engine: Engine,
		hostId: 'worker-a',
		provider: firstProvider,
	});
	const firstCtx = await workflow.context({
		definition: Definition,
		runId: 'restartable-run',
		input: { value: 'acme', stallFirst: true },
		ctx: parent,
	});
	const firstRun = workflow.run({ ctx: firstCtx, implementation: Implementation, scheduler: firstScheduler });
	await within(Promise.race([
		firstCommit.promise,
		firstRun.then(
			() => Promise.reject(new Error('Attempt 1 completed before announcing its external effect.')),
			(error: unknown) => Promise.reject(error),
		),
	]), 'attempt 1 external commit');

	// A fresh Scheduler/history/provider replica starts from persisted data only.
	const secondHistory = history(durable);
	const secondProvider = await activityWorker.create({
		ctx: parent,
		engine: Engine,
		activities: [Persist],
		module: workerModule,
		maximum: 1,
		shutdownMs: 50,
		effect: emitter,
	});
	const secondScheduler = workflow.scheduler({
		id: 'scenario-scheduler-b',
		clock,
		history: secondHistory,
		activityQueue: jobs,
		claimDuration: { seconds: 3 },
	});
	const secondRegistration = await secondScheduler.register({
		engine: Engine,
		hostId: 'worker-b',
		provider: secondProvider,
	});
	const secondCtx = await workflow.context({
		definition: Definition,
		runId: 'restartable-run',
		input: { value: 'acme', stallFirst: true },
		ctx: parent,
	});
	const recovered = workflow.run({ ctx: secondCtx, implementation: Implementation, scheduler: secondScheduler });

	// Attempt 1 renewed immediately before committing. Replica B must observe the
	// same durable logical job after the real lease expires and own attempt 2.
	await within(secondCommit.promise, 'replacement attempt external commit');
	assert.deepEqual(await within(recovered, 'replacement workflow completion'), { stored: 'acme' });
	assert.deepEqual(attempts, [1, 2]);
	assert.equal(committed.size, 1, 'external sink must expose one idempotent commit');
	assert.equal((await jobs.stats()).completed, 1);

	// Tear down the abandoned worker after recovery. Its late result/fault cannot
	// replace the terminal queue result or the durable history completion.
	await within(Promise.resolve(firstProvider[Symbol.asyncDispose]()), 'abandoned Worker provider teardown');
	assert.deepEqual(await within(firstRun, 'stale Scheduler convergence'), { stored: 'acme' });
	assert.deepEqual(
		await within(workflow.run({ ctx: secondCtx, implementation: Implementation, scheduler: secondScheduler }), 'durable replay'),
		{ stored: 'acme' },
	);
	assert.deepEqual(attempts, [1, 2]);
	assert.equal(committed.size, 1);

	await firstCtx[Symbol.asyncDispose]();
	await secondCtx[Symbol.asyncDispose]();
	await firstRegistration[Symbol.asyncDispose]();
	await secondRegistration[Symbol.asyncDispose]();
	await firstScheduler.close();
	await secondScheduler.close();
	await firstHistory.close();
	await secondHistory.close();
	await secondProvider[Symbol.asyncDispose]();
	await jobs.close();
});
