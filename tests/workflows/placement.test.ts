/** Real PostgreSQL claims, ancestor budgets, restart inheritance and fencing. @module */
import { after, before, describe, it } from 'node:test';
import { expect } from '@std/expect';
import postgresjs from 'postgres';
import * as postgres from '@okikio/storage/workflow/postgres';
import * as workflow from '@okikio/workflow';
import { encode, identity } from '@okikio/workflow/execution';
import { Policy, Program, Work } from './scenarios/execution.ts';
import { Engine } from './scenarios/events.ts';

const url = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
if (!url) throw new Error('Placement checks requires an explicit disposable PostgreSQL database.');
const sql = postgresjs(url, { max: 8, onnotice() {} });
before(async () => {
	await postgres.migrate({ database: sql });
});
after(async () => {
	await sql.end({ timeout: 2 });
});

/** A trusted five-level path with one budget shared by sibling thread executors. */
function compute(id: string, generation = 1): workflow.ComputeType {
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

describe('durable nested placement', () => {
	it('filters incompatible work before the bounded scan and shares ancestor budgets across competing hosts', async () => {
		const namespace = crypto.randomUUID();
		await using store = postgres.open({ database: sql, namespace });
		const policy = workflow.PolicySchema.parse({ ...Policy, limits: { ...Policy.limits, pendingRoots: 100 } });
		const refs = [];
		for (let index = 0; index < 35; index++) {
			refs.push(
				await store.accept({
					definition: identity(Work),
					input: encode({ value: index }, 1024),
					policy,
					scope: 'placement',
					key: String(index),
					location: workflow.placement.on({ id: index < 34 ? 'elsewhere' : 'a', generation: 1 }),
				}),
			);
		}
		const a = await store.register('a', [identity(Work)], Engine.id, { activations: 1, activities: 4 }, 60_000, {
			compute: compute('a'),
		});
		const b = await store.register('b', [identity(Work)], Engine.id, { activations: 1, activities: 4 }, 60_000, {
			compute: compute('b'),
		});
		const [one, none] = await Promise.all([store.take(a, [identity(Work)]), store.take(b, [identity(Work)])]);
		expect(one?.ref.id).toBe(refs.at(-1)!.id);
		expect(none).toBeUndefined();
		await store.accept({
			definition: identity(Work),
			input: encode({ value: 99 }, 1024),
			policy,
			scope: 'placement',
			key: 'other',
		});
		expect(await store.take(b, [identity(Work)])).toBeUndefined();
		await store.complete(one!, { type: 'success', value: encode(34, 1024) }, 'permanent');
		expect(await store.take(b, [identity(Work)])).toBeDefined();
	});

	it('reserves a shared ancestor atomically when two compatible executors race', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		for (const key of ['one', 'two']) {
			await store.accept({
				definition: identity(Work),
				input: encode({ value: 1 }, 1024),
				policy: Policy,
				scope: 'race',
				key,
				location: workflow.placement.within({ id: 'container', generation: 1 }),
			});
		}
		const join = (id: string) =>
			store.register(id, [identity(Work)], Engine.id, { activations: 1, activities: 4 }, 60_000, {
				compute: compute(id),
			});
		const [a, b] = await Promise.all([join('a'), join('b')]);
		const claims = await Promise.all([store.take(a, [identity(Work)]), store.take(b, [identity(Work)])]);
		expect(claims.filter(Boolean)).toHaveLength(1);
		const claim = claims.find((value) => value !== undefined)!;
		await store.complete(claim, { type: 'success', value: encode(1, 1024) }, 'permanent');
		expect((await Promise.all([store.take(a, [identity(Work)]), store.take(b, [identity(Work)])])).filter(Boolean))
			.toHaveLength(1);
	});

	it('rejects deduplication when the saved placement differs', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		const request = {
			definition: identity(Work),
			input: encode({ value: 1 }, 1024),
			policy: Policy,
			scope: 'dedupe',
			key: 'same',
		};
		await store.accept(request);
		await expect(store.accept({ ...request, location: workflow.placement.within({ id: 'pod', generation: 1 }) }))
			.rejects.toMatchObject({ code: 'admission_conflict' });
	});

	it('persists child placement across store replacement and releases the parked parent activation slot', async () => {
		const namespace = crypto.randomUUID();
		const parent = { kind: 'workflow' as const, id: 'placement.parent', version: '1' };
		const policy = workflow.PolicySchema.parse({
			...Policy,
			limits: { ...Policy.limits, pendingChildren: 1 },
			workflows: [
				{
					definition: parent,
					maxInstructions: 5,
					requires: [],
					maximumChildren: 1,
					children: [{ definition: Program, maximum: 1 }],
				},
				{ definition: Program, maxInstructions: 5, requires: [] },
			],
		});
		const store = postgres.open({ database: sql, namespace });
		try {
			await store.accept({ definition: parent, input: encode({}, 1024), policy, scope: 'placement', key: 'parent' });
			const coordinator = await store.register('coordinator', [parent, identity(Program)], Engine.id, {
				activations: 1,
				activities: 1,
			}, 60_000);
			const activation = (await store.activate(coordinator, [parent]))!;
			await store.instruction(activation, {
				type: 'child-workflow',
				path: '0',
				fingerprint: 'child',
				definition: identity(Program),
				input: encode({ mode: 'parallel' }, 1024),
				location: workflow.placement.within({ id: 'pod', generation: 1 }),
			});
			await store[Symbol.asyncDispose]();
			await using restored = postgres.open({ database: sql, namespace });
			const child = (await restored.activate(coordinator, [identity(Program)]))!;
			expect(child).toBeDefined();
			expect(child.location).toEqual(workflow.placement.within({ id: 'pod', generation: 1 }));
			await restored.instruction(child, {
				type: 'activity',
				path: '0',
				fingerprint: 'work',
				definition: identity(Work),
				input: encode({ value: 1 }, 1024),
			});
			const wrong = await restored.register(
				'wrong',
				[identity(Work)],
				Engine.id,
				{ activations: 1, activities: 1 },
				60_000,
			);
			expect(await restored.take(wrong, [identity(Work)])).toBeUndefined();
			const right = await restored.register(
				'right',
				[identity(Work)],
				Engine.id,
				{ activations: 1, activities: 1 },
				60_000,
				{ compute: compute('thread') },
			);
			expect(await restored.take(right, [identity(Work)])).toBeDefined();
		} finally {
			await store[Symbol.asyncDispose]();
		}
	});

	it('fences a late descendant result after ancestor replacement and rejects rollback', async () => {
		await using store = postgres.open({ database: sql, namespace: crypto.randomUUID() });
		await store.accept({
			definition: identity(Work),
			input: encode({ value: 1 }, 1024),
			policy: Policy,
			scope: 'placement',
			key: 'fence',
		});
		const join = (id: string, generation: number) =>
			store.register(id, [identity(Work)], Engine.id, { activations: 1, activities: 1 }, 60_000, {
				compute: compute(id, generation),
			});
		const old = await join('a', 1);
		const job = (await store.take(old, [identity(Work)]))!;
		await join('b', 2);
		await expect(store.complete(job, { type: 'success', value: encode(1, 1024) }, 'permanent')).rejects.toMatchObject({
			code: 'stale_claim',
		});
		await expect(join('c', 1)).rejects.toMatchObject({ code: 'compute_conflict' });
	});
});
