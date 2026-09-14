import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as context from '@okikio/context';
import * as history from '@okikio/workflow/history';
import * as workflow from '@okikio/workflow';

/** Minimal unconstrained schema for durable workflow scenario values. */
const AnySchema = Object.freeze({
	'~standard': Object.freeze({
		version: 1 as const,
		vendor: 'scenario',
		validate(value: unknown) {
			return { value };
		},
	}),
});

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
	await using owned = await workflow.context({ definition, runId: 'run-1', input: { account: 'example.com' }, ctx: parent });
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
