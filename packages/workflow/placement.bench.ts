/** Same fixed work set with flat versus nested registration and shared ancestor admission. */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as context from '@okikio/context';
import * as dispatch from './dispatch.ts';
import * as placement from './placement.ts';
import type { ActivityDispatchStatsType } from './types.ts';

/** Register hosts, place eight items, settle claims, then inspect the final counts. */
async function cycle(
	hosts: number,
	depth: number,
): Promise<{ readonly claims: number; readonly stats: ActivityDispatchStatsType }> {
	await using ctx = context.create({ id: 'placement-bench' });
	await using store = dispatch.memory();
	const ancestors = Array.from({ length: depth - 1 }, (_, index) => ({
		id: `boundary:${index}`,
		generation: 1,
		...(index === 0 ? {} : { parent: `boundary:${index - 1}` }),
		capacity: 8,
	}));
	const joined = [];
	for (let index = 0; index < hosts; index++) {
		joined.push(
			await store.join(ctx, {
				engineId: 'bench',
				hostId: String(index),
				capacity: 8,
				protocolVersion: 1,
				activities: [{ id: 'work', version: '1' }],
				compute: {
					id: `host:${index}`,
					generation: 1,
					...(depth === 1 ? {} : { parent: ancestors.at(-1)!.id, ancestors }),
				},
			}),
		);
	}
	for (let index = 0; index < 8; index++) {
		await store.add(ctx, {
			activityId: 'work',
			activityVersion: '1',
			input: index,
			context: context.snapshot(ctx),
			origin: {
				workflowId: 'bench',
				workflowVersion: '1',
				runId: 'bench',
				instructionPath: String(index),
				instructionFingerprint: String(index),
			},
			placement: [{ engine: 'bench', mode: 'required' }],
			location: placement.within({ id: depth === 1 ? 'host:0' : 'boundary:0', generation: 1 }),
		}, { key: String(index) });
	}
	const claims = await store.claim(ctx, joined[0]!, { limit: 8, duration: 'PT1M' });
	for (const claim of claims) await store.complete(ctx, claim, { type: 'success', value: { kind: 'undefined' } });
	return { claims: claims.length, stats: await store.stats() };
}
for (const hosts of [1, 32]) {
	for (const depth of [1, 5]) {
		// Check each shape before registering timings so assertion work does not enter the sample.
		const { claims, stats } = await cycle(hosts, depth);
		if (claims !== 8 || stats.claimed !== 0 || stats.completed !== 8) {
			throw new Error(`Placement oracle failed for ${hosts} hosts and ${depth} levels.`);
		}
		group(`${hosts} hosts, ${depth} compute levels, eight fixed attempts`, () => {
			bench('register + place + claim + settle + inspect', async () => do_not_optimize(await cycle(hosts, depth)));
		});
	}
}
await run();
