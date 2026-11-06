import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
import { effect, requirement, resource, scope } from './mod.ts';

describe('borrowed capability composition', () => {
	it('applies the borrower policy and effect recipient while one collection owns the client', async () => {
		const Store = resource.define<Map<string, string>>()({ id: 'notes', description: 'Saved notes.' });
		const Other = resource.define<number>()({ id: 'other', description: 'Not declared by this operation.' });
		const Saved = effect.define({ id: 'note.saved', value: schema.object({ id: schema.string() }) });
		const CanSave = requirement.define({ family: 'notes', action: 'save', definition: Store });
		const accepted: string[] = [];
		let checks = 0;
		let cleanup = 0;
		await using owner = context.create({ id: 'save-note' });
		const enriched = context.view(owner, { requestPath: '/notes' });
		const live = resource.implement(Store, {
			create({ ctx }) {
				ctx.defer(() => {
					cleanup++;
				});
				return new Map<string, string>();
			},
		});
		{
			await using clients = resource.create(resource.implementations(live), { ctx: owner, host: {} });
			const ctx = scope(enriched, {
				resources: { collection: clients, allowed: [Store] },
				requirements: {
					interpreters: {
						notes: {
							async apply() {
								checks++;
							},
						},
					},
				},
				effects: {
					effects: [Saved],
					emitter: {
						async emit(_ctx, occurrence) {
							accepted.push(occurrence.key);
						},
					},
				},
			});
			await requirement.apply(ctx, [CanSave]);
			const store = await ctx.get(Store);
			store.set('1', 'Remember the photo');
			await effect.emit(ctx, Saved, { id: '1' }, { key: 'save:1' });
			expect(ctx.requestPath).toBe('/notes');
			expect(ctx.signal).toBe(owner.signal);
			expect(store.get('1')).toBe('Remember the photo');
			expect(checks).toBe(1);
			expect(accepted).toEqual(['save:1']);
			expect(ctx.has(Other as unknown as typeof Store)).toBe(false);
			await expect(ctx.get(Other as unknown as typeof Store)).rejects.toBeInstanceOf(
				resource.MissingImplementationError,
			);
			expect(cleanup).toBe(0);
			const inspection = scope(ctx);
			await requirement.apply(inspection, [CanSave]);
			await effect.emit(inspection, Saved, { id: '2' }, { key: 'save:2' });
			expect(checks).toBe(2);
			expect(accepted).toEqual(['save:1', 'save:2']);
			expect(inspection.has(Store as never)).toBe(false);
		}
		expect(cleanup).toBe(1);
		expect(owner.signal.aborted).toBe(false);
	});

	it('retains fail-closed requirements and cleanup failures without adding an owner', async () => {
		const denied = requirement.define({ family: 'upload', action: 'admit', definition: { id: 'small', kind: 'rule' } });
		const owner = context.create({ id: 'plain-capabilities' });
		const ctx = scope(owner);
		const cleanup = new Error('Cleanup failed.');
		ctx.defer(() => {
			throw cleanup;
		});
		await expect(requirement.apply(ctx, [denied])).rejects.toBeInstanceOf(requirement.UnsupportedRequirementError);
		await expect(owner[Symbol.asyncDispose]()).rejects.toBe(cleanup);
		await expect(ctx[Symbol.asyncDispose]()).rejects.toBe(cleanup);
	});
});
