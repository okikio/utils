import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
import * as permission from './mod.ts';
const Read = permission.define({ id: 'read', target: schema.string() });
const Write = permission.define({ id: 'write' });
const budgets = { maximumNodes: 8, maximumDepth: 4, details: false, maximumDetailCodeUnits: 16 } as const;

describe('bounded permission explanations', () => {
	it('reuses ordinary all/any precedence and redacts targets and faults with one provider batch', async () => {
		await using owner = context.create({ id: 'explain' });
		let calls = 0;
		const ctx = permission.scope(owner, {
			permissions: [Read, Write],
			checker: {
				maximumChecks: 4,
				async check() {
					calls++;
					return [{ allowed: false, reason: 'private-reason' }, { error: new Error('private-fault') }];
				},
			},
		});
		const expression = permission.all(permission.on(Read, 'secret-target'), Write);
		const explanation = await permission.explain(ctx, expression, budgets);
		expect(calls).toBe(1);
		expect(explanation.outcome).toBe('denied');
		expect(explanation.children?.map((child) => child.outcome)).toEqual(['denied', 'fault']);
		expect(await permission.check(ctx, expression)).toBe(false);
		const encoded = JSON.stringify(explanation);
		for (const secret of ['secret-target', 'private-reason', 'private-fault']) {
			expect(encoded.includes(secret)).toBe(false);
		}
		expect(explanation.children?.[0]?.definition).toBeUndefined();
		const alternative = await permission.explain(ctx, permission.any(permission.on(Read, 'other'), Write), budgets);
		expect(alternative.outcome).toBe('fault');
		await expect(permission.check(ctx, permission.any(permission.on(Read, 'other'), Write))).rejects.toBeInstanceOf(
			permission.PermissionEvaluationError,
		);
	});
	it('includes exact definition identity and bounded reason only with explicit detail opt-in', async () => {
		await using owner = context.create({ id: 'details' });
		const ctx = permission.scope(owner, {
			permissions: [Write],
			checker: {
				maximumChecks: 1,
				async check() {
					return [{ allowed: false, reason: 'not allowed' }];
				},
			},
		});
		const explanation = await permission.explain(ctx, Write, { ...budgets, details: true, maximumDetailCodeUnits: 3 });
		expect(explanation.definition).toBe(Write);
		expect(explanation.reason).toBe('not');
		expect(explanation.truncated).toBe(true);
	});
	it('rejects over-budget trees, malformed responses and cancellation without returning an allow', async () => {
		await using owner = context.create({ id: 'budget' });
		let calls = 0;
		const ctx = permission.scope(owner, {
			permissions: [Write],
			checker: {
				maximumChecks: 2,
				async check() {
					calls++;
					return [];
				},
			},
		});
		await expect(permission.explain(ctx, permission.all(Write, Write), { ...budgets, maximumNodes: 2 })).rejects
			.toThrow(RangeError);
		expect(calls).toBe(0);
		await expect(permission.explain(ctx, Write, budgets)).rejects.toBeInstanceOf(permission.PermissionDecisionError);
		context.cancel(owner, 'stop');
		await expect(permission.explain(ctx, Write, budgets)).rejects.toBeInstanceOf(context.ContextCancelledError);
		expect(calls).toBe(1);
	});
});
