import { bench, do_not_optimize, group, run } from 'mitata';

import * as context from '@okikio/context';
import * as dispatch from './dispatch.ts';
import type { ActivityJobResultType, ActivityJobType } from './types.ts';

const ITEMS = 1_000;

/** Create deterministic identities so the benchmark measures dispatch work instead of UUID generation. */
function ids(): () => string {
	let next = 0;
	return () => `dispatch-benchmark-${++next}`;
}

/** Run admission, placement, claiming, and completion for one bounded batch. */
async function cycle(): Promise<import('./types.ts').ActivityDispatchStatsType> {
	const clock = new context.TestClock();
	await using ctx = context.create({ id: 'dispatch-benchmark', clock });
	await using store = dispatch.memory({ clock, id: ids() });
	const executor = await store.join(ctx, {
		engineId: 'benchmark',
		hostId: 'benchmark-host',
		activities: [{ id: 'benchmark.run', version: '1' }],
		capacity: ITEMS,
		protocolVersion: 1,
	});
	const snapshot = context.snapshot(ctx);

	for (let index = 0; index < ITEMS; index += 1) {
		const item = Object.freeze({
			activityId: 'benchmark.run',
			activityVersion: '1',
			input: index,
			origin: Object.freeze({
				workflowId: 'benchmark.workflow',
				workflowVersion: '1',
				runId: 'benchmark-run',
				instructionPath: String(index),
				instructionFingerprint: `fingerprint-${index}`,
			}),
			context: snapshot,
			placement: Object.freeze([{ engine: 'benchmark', mode: 'required' as const }]),
		} satisfies ActivityJobType);
		await store.add(ctx, item, { key: `benchmark-${index}` });
	}
	const claims = await store.claim(ctx, executor, { limit: ITEMS, duration: { seconds: 30 } });
	for (const claim of claims) {
		await store.complete(ctx, claim, Object.freeze({
			type: 'success',
			value: Object.freeze({ kind: 'value', value: null }),
		} satisfies ActivityJobResultType));
	}
	return await store.stats();
}

const initial = await cycle();
if (initial.completed !== ITEMS || initial.queued !== 0 || initial.claimed !== 0) {
	throw new Error('Dispatch lifecycle benchmark did not complete its fixed work set.');
}

group('memory activity dispatch lifecycle', () => {
	bench('dispatch.memory: add + place + claim + complete 1k items', async () => {
		do_not_optimize(await cycle());
	});
});

await run();
