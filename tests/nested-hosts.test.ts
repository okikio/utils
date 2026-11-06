/** Native Node placement reaches physical hosts through the public memory scheduler. */
import { it } from 'node:test';
import process from 'node:process';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as workflow from '@okikio/workflow';
import { compute, Engine } from './fixtures/nested-contract.ts';
import { open, run, scheduler as createScheduler } from './fixtures/nested-host.ts';

for (const kind of ['thread', 'process'] as const) {
	it(
		`pins nested memory work to one actual ${kind} and joins borrowed-resource releases`,
		{ timeout: 20000 },
		async () => {
			await using owner = context.create({ id: `nested:${kind}` });
			await using wrong = await open(owner, kind, 'wrong');
			await using right = await open(owner, kind, 'right');
			await using scheduler = createScheduler();
			await using _wrong = await scheduler.register({
				engine: Engine,
				provider: wrong,
				hostId: 'wrong',
				compute: compute('wrong', kind),
				capacity: 2,
			});
			await using _right = await scheduler.register({
				engine: Engine,
				provider: right,
				hostId: 'right',
				compute: compute('right', kind),
				capacity: 2,
			});
			const receipts = await run(owner, scheduler, workflow.placement.on({ id: `${kind}:right`, generation: 1 }));
			expect(receipts).toHaveLength(2);
			const [a, b] = receipts;
			expect(a!.owner).toBe('right');
			expect(b!.owner).toBe('right');
			expect(b!.instance).toBe(a!.instance);
			expect(b!.count).toBe(2);
			expect(b!.finished).toBe(1);
			expect(wrong.stats().idle + wrong.stats().leased + wrong.stats().creating).toBe(0);
			if (kind === 'thread') {
				expect(a!.thread).toBeGreaterThan(0);
				expect(a!.pid).toBe(process.pid);
			} else {
				expect(a!.thread).toBe(0);
				expect(a!.pid).not.toBe(process.pid);
			}
		},
	);
}
