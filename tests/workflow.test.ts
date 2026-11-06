// @installed-consumer: Run this public-import scenario against packed artifacts too.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as context from '@okikio/context';
import * as history from '@okikio/workflow/history';
import * as workflow from '@okikio/workflow';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';

/** Minimal unconstrained schema for durable workflow scenario values. */
const AnySchema = schema.unknown();

/** Attach durable success encoding to one history input while preserving the supplied instruction identity. */
function historyCodec(input: Omit<workflow.HistoryInput, 'encode' | 'decode'>): workflow.HistoryInput {
	return Object.freeze({
		...input,
		async encode(completion: workflow.WorkflowCompletionAny) {
			if (completion.type !== 'success') throw new TypeError('Scenario history expects success.');
			return completion.value === undefined
				? Object.freeze({ type: 'success' as const, value: Object.freeze({ kind: 'undefined' as const }) })
				: Object.freeze({
					type: 'success' as const,
					value: Object.freeze({ kind: 'value' as const, value: completion.value as workflow.WorkflowDurableValue }),
				});
		},
		async decode(completion: workflow.HistoryCompletionType) {
			if (completion.type !== 'success') throw new TypeError('Scenario history expects success.');
			return workflow.success(completion.value.kind === 'undefined' ? undefined : completion.value.value);
		},
	});
}

test('durable history replays one instruction without dispatching external work twice', async () => {
	const definition = workflow.define({
		id: 'scenario.workflow',
		version: '1',
		input: AnySchema,
		result: AnySchema,
	});
	await using parent = context.create({ id: 'scenario-parent' });
	await using owned = await workflow.context({
		definition,
		runId: 'run-1',
		input: { account: 'example.com' },
		ctx: parent,
	});
	await using records = history.memory({ maximumEntries: 16 });

	const iterator = workflow.sleep('PT1S')[Symbol.iterator]();
	const step = iterator.next();
	if (step.done) throw new Error('sleep did not produce an instruction');
	const path = 'scenario.workflow@1/0:sleep';
	const identity = await workflow.identify(step.value, path);
	let dispatches = 0;
	const input = historyCodec({
		ctx: owned,
		instruction: step.value,
		path,
		identity,
		next: async () => {
			dispatches += 1;
			return workflow.success('timer-fired');
		},
	});

	assert.deepEqual(await records.schedule(input), workflow.success('timer-fired'));
	assert.deepEqual(await records.schedule(input), workflow.success('timer-fired'));
	assert.equal(dispatches, 1);
	assert.equal(identity.fingerprint.length, 64);
	assert.equal(records.inspect('run-1').entries.length, 1);
});

test('the public durable client preserves typed admission, result validation and observer-only cancellation', async () => {
	const Text = workflow.define({
		id: 'scenario.text',
		version: '1',
		input: codec.define({
			decode: schema.transform(schema.string(), (value) => value.trim()),
			encode: schema.string(),
		}),
		result: schema.string(),
	});
	const policy = workflow.PolicySchema.parse({
		id: 'scenario.policy',
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
	const ref: workflow.ReferenceType = {
		id: crypto.randomUUID(),
		namespace: 'scenario',
		scope: 'scope',
		definition: { kind: 'workflow', id: Text.id, version: Text.version },
	};
	const accepted: workflow.AdmissionType[] = [];
	let reading: Promise<workflow.SnapshotType> | undefined = undefined;
	let state: workflow.SnapshotType = {
		ref,
		state: 'completed',
		epoch: 1,
		exit: { type: 'success', value: { kind: 'value', value: 'saved' } },
	};
	const store: workflow.ClientStore = {
		namespace: 'scenario',
		async accept(entry) {
			accepted.push(entry);
			return ref;
		},
		get() {
			return reading ?? Promise.resolve(state);
		},
		async cancel() {
			throw new Error('observer must not cancel work');
		},
		async repair() {},
	};
	const client = workflow.client({ store, policy });
	assert.equal(accepted.length, 0);
	policy.version = 'changed';
	assert.deepEqual(await client.submit(Text, '  input  ', { scope: 'scope', key: 'key' }), ref);
	assert.deepEqual(accepted[0]!.input, { kind: 'value', value: 'input' });
	assert.equal(accepted[0]!.policy.version, '1');
	// @ts-expect-error Public admission retains the definition's string input.
	await assert.rejects(client.submit(Text, 42, { scope: 'scope', key: 'bad' }));
	const value: string = await client.wait(Text, ref, { signal: AbortSignal.timeout(1000) });
	assert.equal(value, 'saved');
	state = { ...state, exit: { type: 'success', value: { kind: 'value', value: 42 } } };
	await assert.rejects(client.get(Text, ref));
	const pending = Promise.withResolvers<workflow.SnapshotType>();
	reading = pending.promise;
	const stopped = new AbortController();
	const waiting = client.wait(Text, ref, { signal: stopped.signal });
	stopped.abort(new Error('observation ended'));
	await assert.rejects(waiting, /observation ended/);
	pending.reject(new Error('late read rejection'));
	await Promise.resolve();
});
