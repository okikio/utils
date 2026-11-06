import * as codecs from '@okikio/schema/codec';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as schemaCore from '@okikio/schema';
import * as workflow from '@okikio/workflow';
import type { AdmissionType, ClientStore, ReferenceType, SnapshotType } from '@okikio/workflow';

const Text = workflow.define({
	id: 'test.text',
	version: '1',
	input: codecs.identity(schemaCore.transform(schemaCore.string(), (value) => value.trim())),
	result: schemaCore.string(),
});
const Policy = workflow.PolicySchema.parse({
	id: 'test.policy',
	version: '1',
	limits: {
		inputBytes: 1024,
		resultBytes: 1024,
		historyBytes: 4096,
		pendingRoots: 1,
		reservedSuccessors: 0,
		pendingChildren: 0,
		pendingFinalizers: 0,
	},
	claims: { leaseMs: 600, renewEveryMs: 100, recoverEveryMs: 25 },
	activities: [],
	workflows: [{ definition: Text, maxInstructions: 10, requires: [] }],
	successors: [],
	finalizers: [],
	retention: { dedupeMs: 1000, resultsMs: 1000, auditMs: 1000 },
});

/** Compile-time consumer contract: input and result inference must survive the durable client boundary. */
async function types(client: workflow.ClientType): Promise<void> {
	const ref = await client.submit(Text, 'text', { scope: 'scope', key: 'key' });
	const value: string = await client.wait(Text, ref, { signal: new AbortController().signal });
	void value;
	// @ts-expect-error Admission validates the definition's input type before runtime validation.
	await client.submit(Text, 42, { scope: 'scope', key: 'key' });
	// @ts-expect-error The definition's result remains string through observation.
	const wrong: number = await client.wait(Text, ref, { signal: new AbortController().signal });
	void wrong;
}
void types;

describe('durable client boundary', () => {
	it('separates accepted input, application values and saved representations', async () => {
		const dates = codecs.define({
			decode: schemaCore.transform(schemaCore.string(), (text) => new Date(text)),
			encode: schemaCore.transform(schemaCore.date(), (date) => date.toISOString()),
		});
		const Dated = workflow.define({ id: 'test.dated', version: '1', input: dates, result: dates });
		const policy = workflow.PolicySchema.parse({
			...Policy,
			workflows: [{ definition: Dated, maxInstructions: 10, requires: [] }],
		});
		const ref: ReferenceType = {
			id: crypto.randomUUID(),
			namespace: 'test',
			scope: 'scope',
			definition: { kind: 'workflow', id: Dated.id, version: Dated.version },
		};
		let admitted: AdmissionType | undefined;
		const store: ClientStore = {
			namespace: 'test',
			async accept(value) {
				admitted = value;
				return ref;
			},
			async get() {
				return {
					ref,
					state: 'completed',
					epoch: 1,
					exit: { type: 'success', value: { kind: 'value', value: '2026-02-03T04:05:06.000Z' } },
				};
			},
			async cancel() {
				return 'too_late';
			},
			async repair() {},
		};
		const client = workflow.client({ store, policy });
		await client.submit(Dated, '2026-01-02T03:04:05Z', { scope: 'scope', key: 'date' });
		expect(admitted?.input).toEqual({ kind: 'value', value: '2026-01-02T03:04:05.000Z' });
		const result: Date = await client.wait(Dated, ref, { signal: AbortSignal.timeout(1000) });
		expect(result).toEqual(new Date('2026-02-03T04:05:06Z'));
	});

	it('follows explicit continuation links for results while physical inspection remains available', async () => {
		const first: ReferenceType = {
			id: crypto.randomUUID(),
			namespace: 'test',
			scope: 'scope',
			definition: { kind: 'workflow', id: Text.id, version: Text.version },
		};
		const second: ReferenceType = { ...first, id: crypto.randomUUID() };
		let destination = second;
		const store: ClientStore = {
			namespace: 'test',
			async accept() {
				return first;
			},
			async get(ref) {
				return ref.id === first.id ? { ref: first, state: 'continued', epoch: 1, continuedTo: destination } : {
					ref: second,
					state: 'completed',
					epoch: 1,
					exit: { type: 'success', value: { kind: 'value', value: 'finished' } },
				};
			},
			async cancel() {
				return 'too_late';
			},
			async repair() {},
		};
		const client = workflow.client({ store, policy: Policy });
		expect((await client.get(Text, first)).state).toBe('continued');
		expect((await client.get(Text, first, { follow: true })).ref.id).toBe(second.id);
		expect(await client.wait(Text, first, { signal: AbortSignal.timeout(1000) })).toBe('finished');
		destination = first;
		await expect(client.get(Text, first, { follow: true })).rejects.toMatchObject({ code: 'continuation_limit' });
		destination = { ...second, scope: 'other' };
		await expect(client.wait(Text, first, { signal: AbortSignal.timeout(1000) })).rejects.toMatchObject({
			code: 'reference_conflict',
		});
	});
	it('is inert, validates input, copies policy and cannot override admission fields through options', async () => {
		const accepted: AdmissionType[] = [];
		const ref: ReferenceType = {
			id: crypto.randomUUID(),
			namespace: 'test',
			scope: 'scope',
			definition: { kind: 'workflow', id: Text.id, version: Text.version },
		};
		const store: ClientStore = {
			namespace: 'test',
			async accept(input) {
				accepted.push(input);
				return ref;
			},
			async get() {
				throw new Error('not requested');
			},
			async cancel() {
				throw new Error('not requested');
			},
			async repair() {
				throw new Error('not requested');
			},
		};
		const policy = structuredClone(Policy);
		const client = workflow.client({ store, policy });
		policy.version = 'changed';
		expect(accepted).toHaveLength(0);
		await client.submit(Text, '  accepted  ', { scope: 'scope', key: 'key', ...{ input: 'override', policy: null } });
		expect(accepted[0]!.input).toEqual({ kind: 'value', value: 'accepted' });
		expect(accepted[0]!.policy.version).toBe('1');
		await expect(client.submit(Text, 42 as never, { scope: 'scope', key: 'invalid' })).rejects.toThrow();
		expect(accepted).toHaveLength(1);
	});

	it('validates stored results and ends an observer without cancelling durable work', async () => {
		const ref: ReferenceType = {
			id: crypto.randomUUID(),
			namespace: 'test',
			scope: 'scope',
			definition: { kind: 'workflow', id: Text.id, version: Text.version },
		};
		let state: SnapshotType = { ref, state: 'waiting', epoch: 1 };
		let cancelled = 0;
		const store: ClientStore = {
			namespace: 'test',
			async accept() {
				return ref;
			},
			async get() {
				return state;
			},
			async cancel() {
				cancelled++;
				return 'requested';
			},
			async repair() {},
		};
		const client = workflow.client({ store, policy: Policy });
		const stopped = new AbortController();
		const observing = client.wait(Text, ref, { signal: stopped.signal, intervalMs: 1 });
		await Promise.resolve();
		stopped.abort(new Error('observer ended'));
		await expect(observing).rejects.toThrow('observer ended');
		expect(cancelled).toBe(0);
		state = { ref, state: 'completed', epoch: 1, exit: { type: 'success', value: { kind: 'value', value: 42 } } };
		await expect(client.get(Text, ref)).rejects.toThrow();
		state = { ref, state: 'blocked', epoch: 2, reason: 'reconciliation' };
		await expect(client.wait(Text, ref, { signal: AbortSignal.timeout(1000) })).rejects.toMatchObject({
			code: 'blocked',
			snapshot: { epoch: 2, reason: 'reconciliation' },
		});
	});

	it('rejects duplicate policy definitions and unsafe lease timing', () => {
		expect(() => workflow.PolicySchema.parse({ ...Policy, workflows: [...Policy.workflows, ...Policy.workflows] }))
			.toThrow();
		expect(() => workflow.PolicySchema.parse({ ...Policy, claims: { ...Policy.claims, renewEveryMs: 500 } })).toThrow();
	});

	it('ends observation while a borrowed store read is still pending and consumes its later rejection', async () => {
		const pending = Promise.withResolvers<SnapshotType>();
		const ref: ReferenceType = {
			id: crypto.randomUUID(),
			namespace: 'test',
			scope: 'scope',
			definition: { kind: 'workflow', id: Text.id, version: Text.version },
		};
		const store: ClientStore = {
			namespace: 'test',
			async accept() {
				return ref;
			},
			get() {
				return pending.promise;
			},
			async cancel() {
				throw new Error('must not cancel work');
			},
			async repair() {},
		};
		const client = workflow.client({ store, policy: Policy });
		const stop = new AbortController();
		const observing = client.wait(Text, ref, { signal: stop.signal });
		stop.abort(new Error('observer ended during read'));
		await expect(observing).rejects.toThrow('observer ended during read');
		pending.reject(new Error('late read failure'));
		await Promise.resolve();
	});

	it('validates operator control before calling the store and preserves its independent revision', async () => {
		const ref: ReferenceType = {
			id: crypto.randomUUID(),
			namespace: 'test',
			scope: 'scope',
			definition: { kind: 'workflow', id: Text.id, version: Text.version },
		};
		const decisions: { action: string; options: workflow.ControlOptions }[] = [];
		const store: ClientStore = {
			namespace: 'test',
			async accept() {
				return ref;
			},
			async get() {
				return { ref, state: 'waiting', epoch: 7 };
			},
			async cancel() {
				return 'requested';
			},
			async repair() {},
			async pause(_ref, options) {
				decisions.push({ action: 'pause', options });
				return { paused: true, revision: options.revision + 1 };
			},
			async resume(_ref, options) {
				decisions.push({ action: 'resume', options });
				return { paused: false, revision: options.revision + 1 };
			},
		};
		const client = workflow.client({ store, policy: Policy });
		const options = { actor: 'operator', reason: 'Inspect delayed source', revision: 2 };
		await expect(client.pause({ ...ref, namespace: 'other' }, options)).rejects.toMatchObject({
			code: 'reference_conflict',
		});
		await expect(client.pause(ref, { ...options, reason: ' ' })).rejects.toThrow();
		await expect(client.pause(ref, { ...options, revision: -1 })).rejects.toThrow();
		expect(decisions).toHaveLength(0);
		expect(await client.pause(ref, options)).toEqual({ paused: true, revision: 3 });
		expect(await client.resume(ref, { ...options, revision: 3 })).toEqual({ paused: false, revision: 4 });
		expect(decisions.map((entry) => entry.action)).toEqual(['pause', 'resume']);
		expect((await client.get(Text, ref)).epoch).toBe(7);
	});

	it('reports unsupported durable control without substituting cancellation', async () => {
		const ref: ReferenceType = {
			id: crypto.randomUUID(),
			namespace: 'test',
			scope: 'scope',
			definition: { kind: 'workflow', id: Text.id, version: Text.version },
		};
		const client = workflow.client({
			policy: Policy,
			store: {
				namespace: 'test',
				async accept() {
					return ref;
				},
				async get() {
					return { ref, state: 'ready', epoch: 1 };
				},
				async cancel() {
					throw new Error('Control must not cancel work.');
				},
				async repair() {},
			},
		});
		const options = { actor: 'operator', reason: 'Maintenance', revision: 0 };
		await expect(client.pause(ref, options)).rejects.toMatchObject({ code: 'control_binding' });
		await expect(client.resume(ref, options)).rejects.toMatchObject({ code: 'control_binding' });
	});
});
