import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as context from '@okikio/context';
import * as pool from '@okikio/pool';
import * as queue from '@okikio/queue';
import * as task from '@okikio/task';

/** Return stable identifiers in scenario order so queue assertions never depend on random IDs. */
function ids(...values: string[]): () => string {
	let index = 0;
	return () => values[index++] ?? `generated-${index}`;
}

test('queue retry releases an invalid provider before durable work resumes', async () => {
	const clock = new context.TestClock();
	await using owner = context.create({ id: 'scenario-owner', clock });
	const closed: number[] = [];
	let generation = 0;

	await using providers = await pool.create({
		ctx: owner,
		maximum: 1,
		create() {
			return { generation: ++generation };
		},
		close(value) {
			closed.push(value.generation);
		},
	});
	await using jobs = queue.memory<string, string>({
		clock,
		id: ids('job-1', 'claim-1', 'claim-2'),
	});
	const ref = await jobs.add(owner, 'research example.com', { key: 'research:example.com:v1' });

	await using first = task.start(async (ctx) => {
		const claim = (await jobs.claim(ctx, { ref, owner: 'attempt-1', duration: { seconds: 30 } }))[0];
		assert.ok(claim);
		await using lease = await providers.acquire(ctx);
		assert.equal(lease.value.generation, 1);
		lease.invalidate(new Error('browser provider crashed'));
		await jobs.retry(ctx, claim, { delay: { seconds: 5 } });
		return claim.attempt;
	}, { id: 'first-attempt', ctx: owner });
	assert.equal(await first.done, 1);
	assert.deepEqual(await jobs.claim(owner, { ref }), []);
	assert.deepEqual(closed, [1]);
	assert.deepEqual(providers.stats(), {
		state: 'active',
		minimum: 0,
		maximum: 1,
		idle: 0,
		leased: 0,
		creating: 0,
		waiting: 0,
	});

	clock.advance({ seconds: 5 });
	await using second = task.start(async (ctx) => {
		const claim = (await jobs.claim(ctx, { ref, owner: 'attempt-2', duration: { seconds: 30 } }))[0];
		assert.ok(claim);
		assert.equal(claim.attempt, 2);
		await using lease = await providers.acquire(ctx);
		assert.equal(lease.value.generation, 2);
		await jobs.complete(ctx, claim, `completed by provider ${lease.value.generation}`);
		return lease.value.generation;
	}, { id: 'second-attempt', ctx: owner });

	assert.equal(await second.done, 2);
	assert.equal(await jobs.result(owner, ref), 'completed by provider 2');
	assert.deepEqual(await jobs.stats(), {
		queued: 0,
		claimed: 0,
		completed: 1,
		failed: 0,
		cancelled: 0,
		waitingClaims: 0,
		waitingResults: 0,
	});
});
