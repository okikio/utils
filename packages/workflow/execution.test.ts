import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as schema from '@okikio/schema';
import {
	ControlOptionsSchema,
	ControlSchema,
	FinalizationSchema,
	OutcomeSchema,
	PolicySchema,
	ReferenceSchema,
	SnapshotSchema,
	ValueSchema,
} from './execution.ts';

const operation = { kind: 'activity', id: 'import', version: '1' };
/** A complete consumer policy. Tests change one persisted boundary at a time. */
const policy = {
	id: 'imports',
	version: '1',
	limits: {
		inputBytes: 1024,
		resultBytes: 1024,
		historyBytes: 4096,
		pendingRoots: 10,
		reservedSuccessors: 0,
		pendingChildren: 0,
		pendingFinalizers: 0,
	},
	claims: { leaseMs: 1000, renewEveryMs: 100, recoverEveryMs: 50 },
	activities: [{
		definition: operation,
		maxAttempts: 3,
		deadlineMs: 1000,
		recovery: 'retry',
		retry: 'transient',
		delay: { initialMs: 10, maximumMs: 100 },
		requires: [],
	}],
	workflows: [],
	successors: [],
	finalizers: [],
	retention: { dedupeMs: 1000, resultsMs: 1000, auditMs: 1000 },
};

describe('saved workflow contracts without a schema-library dependency', () => {
	it('validates persisted control separately from attempt recovery state', () => {
		const ref = { id: crypto.randomUUID(), namespace: 'imports', scope: 'customer', definition: operation };
		expect(SnapshotSchema.parse({ ref, state: 'waiting', epoch: 9, control: { paused: true, revision: 2 } }).control)
			.toEqual({ paused: true, revision: 2 });
		for (
			const control of [{ paused: 1, revision: 0 }, { paused: false, revision: -1 }, {
				paused: true,
				revision: 0,
				extra: true,
			}]
		) {
			expect(() => ControlSchema.parse(control)).toThrow();
		}
		for (
			const change of [{ actor: ' ', reason: 'Inspect', revision: 0 }, { actor: 'operator', reason: '', revision: 0 }, {
				actor: 'operator',
				reason: 'Inspect',
				revision: 0.5,
			}]
		) {
			expect(() => ControlOptionsSchema.parse(change)).toThrow();
		}
	});
	it('accepts authored definitions, supplies defaults, and snapshots policy data', async () => {
		const authored = structuredClone(policy);
		const result = await schema.parse(PolicySchema, authored);
		expect(result.failures).toEqual([]);
		authored.activities[0]!.maxAttempts = 99;
		expect(result.activities[0]!.maxAttempts).toBe(3);
	});
	it('keeps continuation opt-in without changing the encoding of older workflow policies', () => {
		const authored = {
			...policy,
			workflows: [{ definition: { kind: 'workflow', id: 'scan', version: '1' }, maxInstructions: 10, requires: [] }],
		};
		expect(Object.hasOwn(PolicySchema.parse(authored).workflows[0]!, 'maxContinuations')).toBe(false);
		expect(
			PolicySchema.parse({ ...authored, workflows: [{ ...authored.workflows[0], maxContinuations: 5 }] }).workflows[0]!
				.maxContinuations,
		).toBe(5);
		for (const maximum of [-1, 1001, 0.5]) {
			expect(() =>
				PolicySchema.parse({ ...authored, workflows: [{ ...authored.workflows[0], maxContinuations: maximum }] })
			).toThrow();
		}
	});
	it('rejects unknown fields, unsafe limits, invalid renewals, and duplicate code identities', () => {
		for (
			const input of [
				{ ...policy, typo: true },
				{ ...policy, limits: { ...policy.limits, inputBytes: 0 } },
				{ ...policy, retention: { ...policy.retention, auditMs: Infinity } },
				{ ...policy, claims: { ...policy.claims, renewEveryMs: 500 } },
				{ ...policy, activities: [...policy.activities, ...policy.activities] },
				{ ...policy, activities: [{ ...policy.activities[0], definition: { ...operation, kind: 'workflow' } }] },
			]
		) expect(() => PolicySchema.parse(input)).toThrow(schema.SchemaValidationError);
	});
	it('rejects promised children that exceed the parent limit', () => {
		expect(() =>
			PolicySchema.parse({
				...policy,
				workflows: [{
					definition: { kind: 'workflow', id: 'research', version: '1' },
					maxInstructions: 10,
					maximumChildren: 1,
					children: [{ definition: operation, maximum: 2 }],
					requires: [],
				}],
			})
		).toThrow('Child choices exceed maximumChildren');
	});
	it('validates result variants and rejects cycles, extra fields, and live values', () => {
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		for (
			const input of [
				{ type: 'success', value: { kind: 'value', value: cycle } },
				{ type: 'success', value: { kind: 'undefined' }, extra: true },
				{ type: 'failure', id: 'failure', data: new Date(), message: '' },
				{ type: 'fault', code: 'fault', message: 'x'.repeat(2049) },
			]
		) expect(() => OutcomeSchema.parse(input)).toThrow(schema.SchemaValidationError);
		expect(ValueSchema.parse({ kind: 'undefined' })).toEqual({ kind: 'undefined' });
	});
	it('keeps references and finalizer inputs usable through Standard Schema', async () => {
		const ref = { id: crypto.randomUUID(), namespace: 'imports', scope: 'customer', definition: operation };
		expect(await schema.parse(ReferenceSchema, ref)).toEqual(ref);
		expect(
			(await schema.parse(FinalizationSchema, {
				run: { id: ref.id, scope: ref.scope, definition: operation, input: { source: 'file' } },
				exit: { type: 'success', value: { kind: 'undefined' } },
			})).run.input,
		).toEqual({ source: 'file' });
		expect(() => ReferenceSchema.parse({ ...ref, id: 'not-a-uuid' })).toThrow();
		expect(() =>
			FinalizationSchema.parse({
				run: { id: ref.id, scope: ref.scope, definition: operation },
				exit: { type: 'success', value: { kind: 'undefined' } },
			})
		).toThrow('Finalizer run input is required');
	});
});
