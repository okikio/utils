import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as placement from './placement.ts';
import * as workflow from './mod.ts';
import * as dispatch from './dispatch.ts';
import type { ActivityJobType, ComputeType } from './types.ts';

/** Five independently named compute boundaries; only the leaf accepts work. */
function compute(id: string, generation = 1): ComputeType {
	return {
		id,
		generation: 1,
		parent: 'process',
		ancestors: [
			{ id: 'node', generation },
			{ id: 'pod', generation: 1, parent: 'node' },
			{ id: 'container', generation: 1, parent: 'pod', capacity: 1 },
			{ id: 'process', generation: 1, parent: 'container' },
		],
	};
}

function item(ctx: context.Context, id: string, location?: placement.SelectionType): ActivityJobType {
	return {
		activityId: 'work',
		activityVersion: '1',
		input: id,
		context: context.snapshot(ctx),
		origin: { workflowId: 'flow', workflowVersion: '1', runId: 'run', instructionPath: id, instructionFingerprint: id },
		placement: [{ engine: 'engine', mode: 'required' }],
		...(location === undefined ? {} : { location }),
	};
}

describe('nested placement', () => {
	it('intersects deep boundaries, rejects sibling escape and atomically shares ancestor capacity', async () => {
		await using ctx = context.create({ id: 'placement' });
		await using store = dispatch.memory();
		const join = (id: string) =>
			store.join(ctx, {
				engineId: 'engine',
				hostId: id,
				compute: compute(id),
				capacity: 4,
				activities: [{ id: 'work', version: '1' }],
				protocolVersion: 1,
			});
		const a = await join('thread-a'), b = await join('thread-b');
		const required = placement.intersect(
			placement.within({ id: 'pod', generation: 1 }),
			placement.on({ id: 'thread-a', generation: 1 }),
		);
		for (const id of ['first', 'second']) await store.add(ctx, item(ctx, id, required), { key: id });
		expect(await store.claim(ctx, b, { duration: 'PT1M', limit: 4 })).toEqual([]);
		const claims = await store.claim(ctx, a, { duration: 'PT1M', limit: 4 });
		expect(claims).toHaveLength(1);
		expect(await store.claim(ctx, a, { duration: 'PT1M', limit: 4 })).toEqual([]);
		await store.complete(ctx, claims[0]!, { type: 'success', value: { kind: 'undefined' } });
		expect(await store.claim(ctx, a, { duration: 'PT1M', limit: 4 })).toHaveLength(1);
	});

	it('fences every descendant after ancestor replacement and rejects generation rollback', async () => {
		await using ctx = context.create({ id: 'placement-replace' });
		await using store = dispatch.memory();
		const join = (generation: number) =>
			store.join(ctx, {
				engineId: 'engine',
				hostId: 'thread',
				compute: compute('thread', generation),
				capacity: 1,
				activities: [{ id: 'work', version: '1' }],
				protocolVersion: 1,
			});
		const old = await join(1);
		await store.add(ctx, item(ctx, 'first'), { key: 'first' });
		const [claim] = await store.claim(ctx, old, { duration: 'PT1M' });
		const current = await join(2);
		await expect(store.complete(ctx, claim!, { type: 'success', value: { kind: 'undefined' } })).rejects.toBeInstanceOf(
			dispatch.StaleActivityClaimError,
		);
		await expect(join(1)).rejects.toThrow();
		expect(await store.claim(ctx, current, { duration: 'PT1M' })).toHaveLength(1);
	});

	it('rejects contradictory generations, exact targets, cycles and incomplete ancestry', () => {
		expect(() =>
			placement.intersect(
				placement.within({ id: 'pod', generation: 1 }),
				placement.within({ id: 'pod', generation: 2 }),
			)
		).toThrow();
		expect(() =>
			placement.intersect(placement.on({ id: 'a', generation: 1 }), placement.on({ id: 'b', generation: 1 }))
		).toThrow();
		expect(() => placement.path({ ...compute('thread'), parent: 'wrong' })).toThrow();
		expect(() => placement.path(compute('pod'))).toThrow();
		expect(
			placement.matches(
				placement.within({ id: 'pod', generation: 1 }),
				placement.path({ id: 'thread', parent: 'pod' }),
			),
		).toBe(false);
	});

	it('rejects sparse and accessor-backed paths without reading a getter', () => {
		let reads = 0;
		const refs = Object.defineProperty([], 0, {
			get() {
				reads++;
				return { id: 'pod', generation: 1 };
			},
		});
		expect(() => placement.SelectionSchema.parse({ within: refs })).toThrow();
		expect(() => placement.path({ id: 'thread', parent: 'pod', ancestors: refs })).toThrow();
		expect(() => placement.SelectionSchema.parse({ within: new Array(1) })).toThrow();
		expect(reads).toBe(0);
	});

	it('scopes controls and cleanup, preserves generator finally and fingerprints placement', async () => {
		const Activity = { kind: 'activity' as const, id: 'work', version: '1' } as workflow.ActivityReference;
		const a = placement.within({ id: 'pod', generation: 1 });
		let finalized = false;
		const program: workflow.WorkflowOperation<void> = {
			*[Symbol.iterator]() {
				try {
					yield* workflow.parallel({ branch: workflow.activity(Activity, 'input') });
				} finally {
					finalized = true;
					yield* workflow.activity(Activity, 'cleanup');
				}
			},
		};
		const iterator = placement.scope(a, program)[Symbol.iterator]();
		const first = iterator.next();
		if (first.done || first.value.type !== 'parallel') throw new Error('Expected parallel.');
		const child = first.value.operations.branch![Symbol.iterator]().next();
		if (child.done || child.value.type !== 'activity') throw new Error('Expected activity.');
		expect(child.value.options.location).toEqual(a);
		const cleanup = iterator.return();
		if (cleanup.done || cleanup.value.type !== 'activity') throw new Error('Expected cleanup.');
		expect(finalized).toBe(true);
		expect(cleanup.value.options.location).toEqual(a);
		const changed = { ...child.value, options: { location: placement.within({ id: 'other', generation: 1 }) } };
		expect((await workflow.identify(child.value, '0')).fingerprint).not.toBe(
			(await workflow.identify(changed, '0')).fingerprint,
		);
	});
});

it('keeps exact physical identity through nested intersections and rejects conflicting hosts or executors', () => {
	const executor = { id: 'thread-pool', generation: 2 };
	const host = { pool: 'provider:one', id: 'host:two' };
	const exact = placement.host(executor, host);
	expect(placement.intersect(placement.within({ id: 'container', generation: 1 }), exact).host).toEqual(host);
	expect(placement.intersect(exact, placement.on(executor)).host).toEqual(host);
	expect(() => placement.intersect(exact, placement.host(executor, { ...host, id: 'other' }))).toThrow();
	expect(() => placement.intersect(exact, placement.on({ ...executor, generation: 3 }))).toThrow();
	expect(() => placement.SelectionSchema.parse({ within: [], host })).toThrow();
});
