import type { StandardSchemaV1 } from '@standard-schema/spec';
import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as context from '@okikio/context';
import * as history from './history.ts';
import * as workflow from './mod.ts';

/** Creates one minimal Standard Schema contract for history tests. */
function schema(): StandardSchemaV1<unknown, unknown> {
	return Object.freeze({
		'~standard': Object.freeze({
			version: 1,
			vendor: 'test',
			validate(value: unknown) { return { value }; },
		}),
	});
}

/** Creates one real workflow context used to exercise history identity and replay. */
async function createContext(runId: string) {
	const definition = workflow.define({
		id: 'history.test',
		version: '1',
		input: schema(),
		result: schema(),
	});
	const parent = context.create({ id: `parent:${runId}` });
	const ctx = await workflow.context({ definition, runId, input: {}, ctx: parent });
	return Object.freeze({ parent, ctx });
}

/** Adds the JSON-safe completion codec required by the generic History contract. */
function codec<Input extends Omit<workflow.HistoryInput, 'encode' | 'decode'>>(input: Input): workflow.HistoryInput {
	return Object.freeze({
		...input,
		async encode(completion: workflow.WorkflowCompletionAny) {
			if (completion.type !== 'success') throw new TypeError('History unit fixture expects a success completion.');
			if (completion.value === undefined) return Object.freeze({ type: 'success', value: Object.freeze({ kind: 'undefined' }) });
			if (typeof completion.value !== 'string') throw new TypeError('History unit fixture expects a string result.');
			return Object.freeze({ type: 'success', value: Object.freeze({ kind: 'value', value: completion.value }) });
		},
		async decode(completion: workflow.HistoryCompletionType) {
			if (completion.type !== 'success') throw new TypeError('History unit fixture expects a success completion.');
			return workflow.success(completion.value.kind === 'undefined' ? undefined : completion.value.value);
		},
	});
}

/** Returns one serializable sleep instruction and its stable identity. */
async function instruction(path: string) {
	const iterator = workflow.sleep('PT1S')[Symbol.iterator]();
	const step = iterator.next();
	if (step.done) throw new Error('Sleep operation did not yield an instruction.');
	return Object.freeze({ value: step.value, identity: await workflow.identify(step.value, path) });
}

describe('@okikio/workflow/history', () => {
	it('replays one recorded completion without dispatching the instruction again', async () => {
		await using records = history.memory({ maximumEntries: 8 });
		const owned = await createContext('run-replay');
		try {
			const entry = await instruction('history.test@1/0:sleep');
			let calls = 0;
			const input = {
				ctx: owned.ctx,
				instruction: entry.value,
				path: 'history.test@1/0:sleep',
				identity: entry.identity,
				next: async () => { calls += 1; return workflow.success('done'); },
			};

			expect(await records.schedule(codec(input))).toEqual(workflow.success('done'));
			expect(await records.schedule(codec(input))).toEqual(workflow.success('done'));
			expect(calls).toBe(1);
			expect(records.inspect('run-replay').entries).toHaveLength(1);
		} finally {
			await owned.ctx[Symbol.asyncDispose]();
			await owned.parent[Symbol.asyncDispose]();
		}
	});

	it('coalesces concurrent scheduling of the same unresolved instruction', async () => {
		await using records = history.memory({ maximumEntries: 8 });
		const owned = await createContext('run-concurrent');
		try {
			const entry = await instruction('history.test@1/0:sleep');
			let release!: () => void;
			const gate = new Promise<void>((resolve) => release = resolve);
			let calls = 0;
			const input = {
				ctx: owned.ctx,
				instruction: entry.value,
				path: 'history.test@1/0:sleep',
				identity: entry.identity,
				next: async () => { calls += 1; await gate; return workflow.success('done'); },
			};
			const first = records.schedule(codec(input));
			const second = records.schedule(codec(input));
			expect(calls).toBe(1);
			release();
			expect(await Promise.all([first, second])).toEqual([workflow.success('done'), workflow.success('done')]);
		} finally {
			await owned.ctx[Symbol.asyncDispose]();
			await owned.parent[Symbol.asyncDispose]();
		}
	});

	it('rejects a changed fingerprint at an existing deterministic path', async () => {
		await using records = history.memory({ maximumEntries: 8 });
		const owned = await createContext('run-divergence');
		try {
			const first = await instruction('history.test@1/0:sleep');
			await records.schedule(codec({
				ctx: owned.ctx,
				instruction: first.value,
				path: 'history.test@1/0:sleep',
				identity: first.identity,
				next: async () => workflow.success('done'),
			}));
			const changed = workflow.sleep('PT2S')[Symbol.iterator]().next();
			if (changed.done) throw new Error('Sleep operation did not yield an instruction.');
			const identity = await workflow.identify(changed.value, 'history.test@1/0:sleep');
			await expect(records.schedule(codec({
				ctx: owned.ctx,
				instruction: changed.value,
				path: 'history.test@1/0:sleep',
				identity,
				next: async () => workflow.success('unexpected'),
			}))).rejects.toBeInstanceOf(history.ReplayError);
		} finally {
			await owned.ctx[Symbol.asyncDispose]();
			await owned.parent[Symbol.asyncDispose]();
		}
	});

	it('rejects a new retained instruction after the configured memory limit', async () => {
		await using records = history.memory({ maximumEntries: 1 });
		const owned = await createContext('run-capacity');
		try {
			const first = await instruction('history.test@1/0:sleep');
			await records.schedule(codec({
				ctx: owned.ctx,
				instruction: first.value,
				path: 'history.test@1/0:sleep',
				identity: first.identity,
				next: async () => workflow.success('first'),
			}));
			const second = await instruction('history.test@1/1:sleep');
			await expect(records.schedule(codec({
				ctx: owned.ctx,
				instruction: second.value,
				path: 'history.test@1/1:sleep',
				identity: second.identity,
				next: async () => workflow.success('second'),
			}))).rejects.toBeInstanceOf(history.HistoryCapacityError);
		} finally {
			await owned.ctx[Symbol.asyncDispose]();
			await owned.parent[Symbol.asyncDispose]();
		}
	});
});
