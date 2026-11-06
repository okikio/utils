import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as requirement from './mod.ts';
const entry = (family: string) =>
	requirement.define({ family, action: 'require', definition: { kind: family, id: 'public.' + family } });
const first = entry('first'), second = entry('second'), third = entry('third');
describe('requirement explanation versus application', () => {
	it('inspection invokes no interpreter and distinguishes unsupported from explicit ignore', async () => {
		await using owner = context.create({ id: 'explain' });
		let calls = 0;
		const ctx = requirement.scope(owner, {
			interpreters: {
				first: {
					async apply() {
						calls++;
					},
				},
			},
		});
		expect(
			(await requirement.explain(ctx, [first, second], { mode: 'inspect', maximumRequirements: 2 })).map((row) =>
				row.outcome
			),
		).toEqual(['configured', 'unsupported']);
		expect(
			(await requirement.explain(requirement.scope(owner, { unknown: 'ignore' }), [second], {
				mode: 'inspect',
				maximumRequirements: 1,
			}))[0]?.outcome,
		).toBe('ignored');
		expect(calls).toBe(0);
	});
	it('uses the ordinary one-batch activation and classifies exact denial without leaking evaluator data', async () => {
		await using owner = context.create({ id: 'apply' });
		const denial = new Error('secret evaluator payload');
		const calls: string[] = [];
		const ctx = requirement.scope(owner, {
			interpreters: {
				first: {
					async apply(_ctx, entries) {
						calls.push('first:' + entries.length);
					},
				},
				second: {
					async apply() {
						calls.push('second');
						throw denial;
					},
				},
				third: {
					async apply() {
						calls.push('third');
					},
				},
			},
		});
		const report = await requirement.explain(ctx, [first, first, second, third], {
			mode: 'apply',
			maximumRequirements: 4,
			denied: (error) => error === denial,
		});
		expect(report.map((row) => row.outcome)).toEqual(['allowed', 'denied', 'unreached']);
		expect(calls).toEqual(['first:1', 'second']);
		expect(JSON.stringify(report)).not.toContain('secret');
		expect((await requirement.explain(ctx, [second], { mode: 'apply', maximumRequirements: 1 }))[0]?.outcome).toBe(
			'fault',
		);
		await expect(requirement.apply(ctx, [second])).rejects.toBe(denial);
	});
	it('refuses the input bound before callbacks and propagates cancellation instead of classifying it as fault', async () => {
		await using owner = context.create({ id: 'cancel' });
		const ctx = requirement.scope(owner, {
			interpreters: {
				first: {
					async apply() {
						context.cancel(owner, 'stop');
					},
				},
			},
		});
		await expect(requirement.explain(ctx, [first], { mode: 'apply', maximumRequirements: 0 })).rejects.toThrow(
			RangeError,
		);
		await expect(requirement.explain(ctx, [first], { mode: 'apply', maximumRequirements: 1, denied: () => true }))
			.rejects.toBeInstanceOf(context.ContextCancelledError);
	});
});

it('never treats Object.prototype names as configured family interpreters', async () => {
	await using owner = context.create({ id: 'prototype-family' });
	for (const family of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
		const value = entry(family);
		expect((await requirement.explain(owner, [value], { mode: 'inspect', maximumRequirements: 1 }))[0]?.outcome).toBe(
			'unsupported',
		);
		await expect(requirement.apply(owner, [value])).rejects.toBeInstanceOf(requirement.UnsupportedRequirementError);
	}
});
