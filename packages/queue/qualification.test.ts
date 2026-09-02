import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as context from '@okikio/context';
import * as queue from './mod.ts';

describe('queue qualification', () => {
	it('never grants the same logical item to two simultaneous claims', async () => {
		await using ctx = context.create({ id: 'queue-pressure', clock: new context.TestClock() });
		await using jobs = queue.memory<number, number>();
		for (let value = 0; value < 100; value += 1) await jobs.add(ctx, value);

		const groups = await Promise.all(Array.from({ length: 20 }, (_, index) =>
			jobs.claim(ctx, { owner: `consumer-${index}`, limit: 5, duration: { minutes: 1 } })
		));
		const claims = groups.flat();
		const itemIds = claims.map((claim) => claim.itemId);
		expect(new Set(itemIds).size).toBe(itemIds.length);
		expect(claims).toHaveLength(100);

		await Promise.all(claims.map((claim) => jobs.complete(ctx, claim, claim.value)));
		expect(await jobs.stats()).toMatchObject({ queued: 0, claimed: 0, completed: 100 });
	});

	it('keeps terminal result authority stable while many callers wait', async () => {
		await using ctx = context.create({ id: 'queue-result-pressure', clock: new context.TestClock() });
		await using jobs = queue.memory<string, string>();
		const ref = await jobs.add(ctx, 'work');
		const claim = (await jobs.claim(ctx, { owner: 'consumer' }))[0]!;
		const waiters = Array.from({ length: 50 }, () => jobs.result(ctx, ref));
		await jobs.complete(ctx, claim, 'done');
		expect(await Promise.all(waiters)).toEqual(Array.from({ length: 50 }, () => 'done'));
		expect((await jobs.stats()).waitingResults).toBe(0);
	});
});
