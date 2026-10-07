import { run } from '../../bench/run.ts';
import { bench, do_not_optimize, group } from 'mitata';

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
async function cycle(verify = false): Promise<import('./types.ts').ActivityDispatchStatsType> {
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
	const refs: import('./types.ts').ActivityRefType[] = [];

	for (let index = 0; index < ITEMS; index += 1) {
		const item = Object.freeze(
			{
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
			} satisfies ActivityJobType,
		);
		refs.push(await store.add(ctx, item, { key: `benchmark-${index}` }));
	}
	const claims = await store.claim(ctx, executor, { limit: ITEMS, duration: { seconds: 30 } });
	for (const claim of claims) {
		if (typeof claim.value.input !== 'number') throw new TypeError('Dispatch fixture input must remain numeric.');
		await store.complete(
			ctx,
			claim,
			Object.freeze(
				{
					type: 'success',
					value: Object.freeze({ kind: 'value', value: claim.value.input }),
				} satisfies ActivityJobResultType,
			),
		);
	}
	if (verify) {
		if (claims.length !== ITEMS || new Set(claims.map((claim) => claim.value.input)).size !== ITEMS) {
			throw new Error('Dispatch duplicated or dropped admitted inputs.');
		}
		for (let index = 0; index < refs.length; index += 1) {
			const result = await store.result(ctx, refs[index]!);
			if (result.type !== 'success' || result.value.kind !== 'value' || result.value.value !== index) {
				throw new Error('Dispatch result is attached to the wrong logical job.');
			}
		}
	}
	return await store.stats();
}

const initial = await cycle(true);
if (initial.completed !== ITEMS || initial.queued !== 0 || initial.claimed !== 0) {
	throw new Error('Dispatch lifecycle benchmark did not complete its fixed work set.');
}

group('memory activity dispatch lifecycle', () => {
	bench('dispatch.memory: add + place + claim + complete 1k items', async () => {
		do_not_optimize(await cycle());
	});
});

await run();
