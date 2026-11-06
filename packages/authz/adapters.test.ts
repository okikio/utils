import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
import { entitlement, permission, role } from './mod.ts';

describe('static role policy adapter', () => {
	it('requires exact grants and still checks each target and current tenant', async () => {
		await using owner = context.create({ id: 'tenant-a' });
		const Read = permission.define({ id: 'read', target: schema.string() });
		const Foreign = permission.define({ id: 'read', target: schema.string() });
		const Member = role.define({ id: 'member', permissions: [Read] });
		let calls = 0;
		const checker = role.checker([Member], {
			maximumRoles: 1,
			maximumGrants: 1,
			maximumChecks: 3,
			policy(ctx, request) {
				calls++;
				return { allowed: request.target === ctx.id };
			},
		});
		const answers = await checker.check(owner, [{ definition: Read, target: 'tenant-a' }, {
			definition: Read,
			target: 'tenant-b',
		}, { definition: Foreign, target: 'tenant-a' }]);
		expect(answers).toEqual([{ allowed: true }, { allowed: false }, { allowed: false }]);
		expect(calls).toBe(2);
	});
	it('rejects conflicting roles and exceeded bounds; missing policy never grants', async () => {
		const Read = permission.define({ id: 'read' });
		const A = role.define({ id: 'member', permissions: [Read] });
		const B = role.define({ id: 'member', permissions: [Read] });
		const options = { maximumRoles: 2, maximumGrants: 2, maximumChecks: 1, policy: () => ({ allowed: true as const }) };
		expect(() => role.checker([A, B], options)).toThrow(TypeError);
		expect(() => role.checker([A, A], { ...options, maximumGrants: 1 })).toThrow(RangeError);
		expect(() => role.checker([A], { ...options, policy: undefined as never })).toThrow(TypeError);
		await using owner = context.create({ id: 'bounds' });
		await expect(
			role.checker([A], options).check(owner, [{ definition: Read, target: undefined }, {
				definition: Read,
				target: undefined,
			}]),
		).rejects.toThrow(RangeError);
	});
	it('propagates exact policy faults and rejects malformed decisions', async () => {
		await using owner = context.create({ id: 'fault' });
		const Read = permission.define({ id: 'read' });
		const Member = role.define({ id: 'member', permissions: [Read] });
		const options = { maximumRoles: 1, maximumGrants: 1, maximumChecks: 1 };
		await expect(
			role.checker([Member], {
				...options,
				policy() {
					throw undefined;
				},
			}).check(owner, [{ definition: Read, target: undefined }]),
		).rejects.toBe(undefined);
		await expect(
			role.checker([Member], { ...options, policy: () => ({ allowed: 'yes' }) as never }).check(owner, [{
				definition: Read,
				target: undefined,
			}]),
		).rejects.toThrow(TypeError);
	});
});

describe('bounded entitlement explanations', () => {
	it('retains authored order and exact identities, separates fault/denial and redacts by default', async () => {
		await using owner = context.create({ id: 'explain' });
		const A = entitlement.define({ id: 'a' });
		const B = entitlement.define({ id: 'b' });
		const checks = [entitlement.require(A), entitlement.require(B), entitlement.require(A)];
		const checker = {
			async check() {
				return [{ allowed: true as const, reason: 'secret' }, {
					allowed: false as const,
					reason: 'denied because secret',
				}, { error: new Error('secret') }];
			},
		};
		const limits = { maximumChecks: 3, maximumReasonLength: 6 };
		const report = await entitlement.explain(owner, checker, checks, limits);
		expect(report.status).toBe('fault');
		expect(report.entries.map((item) => item.status)).toEqual(['allowed', 'denied', 'fault']);
		expect(report.entries[0]?.definition).toBe(A);
		expect(JSON.stringify(report)).not.toContain('secret');
		const detailed = await entitlement.explain(owner, checker, checks, { ...limits, details: true });
		expect(detailed.entries[1]?.reason).toBe('denied');
		expect(Object.isFrozen(detailed.entries)).toBe(true);
	});
	it('bounds before provider calls, rejects malformed answers and represents thrown provider faults', async () => {
		await using owner = context.create({ id: 'limits' });
		const A = entitlement.define({ id: 'a' });
		let calls = 0;
		const checker = {
			maximumChecks: 1,
			async check() {
				calls++;
				return [];
			},
		};
		const limits = { maximumChecks: 2, maximumReasonLength: 0 };
		await expect(entitlement.explain(owner, checker, [entitlement.require(A), entitlement.require(A)], limits)).rejects
			.toBeInstanceOf(entitlement.EntitlementCheckLimitError);
		expect(calls).toBe(0);
		await expect(entitlement.explain(owner, checker, [entitlement.require(A)], limits)).rejects.toBeInstanceOf(
			entitlement.EntitlementDecisionError,
		);
		expect(
			(await entitlement.explain(
				owner,
				{
					async check() {
						throw undefined;
					},
				},
				[entitlement.require(A)],
				limits,
			)).status,
		).toBe('fault');
		expect(await entitlement.explain(owner, checker, [], limits)).toEqual({ status: 'allowed', entries: [] });
	});
});
