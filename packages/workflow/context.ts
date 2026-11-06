/** Derive workflow contexts with validated inputs, declared triggers, and inherited cancellation checkpoints. @module */

import * as codec from '@okikio/schema/codec';
import { createTrigger } from './trigger.ts';
import * as contextCore from '@okikio/context';
import * as recordCore from '@okikio/collection/record';
import type { WorkflowContext, WorkflowContextOptions, WorkflowDefinition } from './types.ts';
import { assertIdentifier } from './assert.ts';

/** Create a validated workflow context by deriving local cancellation from a parent context. */
export async function context<Workflow extends WorkflowDefinition>(
	options: WorkflowContextOptions<Workflow>,
): Promise<WorkflowContext<Workflow> & AsyncDisposable> {
	recordCore.assert(options, 'workflow context options');
	const normalized = Object.freeze({ ...options } satisfies WorkflowContextOptions<Workflow>);
	assertIdentifier(normalized.runId, 'workflow run');
	const input = await codec.read(normalized.definition.input, normalized.input) as import('./types.ts').WorkflowInput<
		Workflow
	>;
	const owned = contextCore.child(normalized.ctx, { id: normalized.runId });
	const checkpoint = inheritedCheckpoint(normalized.ctx, owned);
	return Object.freeze({
		id: owned.id,
		...(owned.traceId === undefined ? {} : { traceId: owned.traceId }),
		...(owned.deploymentId === undefined ? {} : { deploymentId: owned.deploymentId }),
		...(owned.idempotencyKey === undefined ? {} : { idempotencyKey: owned.idempotencyKey }),
		startedAt: owned.startedAt,
		...(owned.deadline === undefined ? {} : { deadline: owned.deadline }),
		signal: owned.signal,
		clock: owned.clock,
		workflow: normalized.definition,
		trigger: createTrigger(normalized.definition),
		runId: normalized.runId,
		input,
		version: normalized.definition.version,
		checkpoint,
		/**
		 * Releases owned state and waits for cleanup completion when used with `await using`.
		 *
		 * @internal
		 */
		async [Symbol.asyncDispose]() {
			await owned[Symbol.asyncDispose]();
		},
	});
}

/**
 * Give a child branch its own signal while retaining the parent run identity and input.
 *
 * Ordinary branches inherit the parent pause checkpoint. Cleanup can opt out of
 * pause, but still checks its own cancellation before doing more work.
 *
 * @internal
 */
export function workflowContext(
	parent: WorkflowContext,
	owned: contextCore.Owned,
	inheritPause = true,
): WorkflowContext {
	const checkpoint = inheritPause
		? async (): Promise<void> => {
			contextCore.check(owned);
			await parent.checkpoint();
			contextCore.check(owned);
		}
		: async (): Promise<void> => contextCore.check(owned);
	return Object.freeze({
		id: owned.id,
		...(owned.traceId === undefined ? {} : { traceId: owned.traceId }),
		...(owned.deploymentId === undefined ? {} : { deploymentId: owned.deploymentId }),
		...(owned.idempotencyKey === undefined ? {} : { idempotencyKey: owned.idempotencyKey }),
		startedAt: owned.startedAt,
		...(owned.deadline === undefined ? {} : { deadline: owned.deadline }),
		signal: owned.signal,
		clock: owned.clock,
		workflow: parent.workflow,
		trigger: parent.trigger,
		runId: parent.runId,
		input: parent.input,
		version: parent.version,
		checkpoint,
	});
}

/** Build the checkpoint inherited from a live Task without making Task ownership mandatory for durable workflows. */
function inheritedCheckpoint(parent: import('@okikio/context').Context, owned: contextCore.Owned): () => Promise<void> {
	const candidate = (parent as import('@okikio/context').Context & { readonly checkpoint?: unknown }).checkpoint;
	if (typeof candidate !== 'function') return async () => contextCore.check(owned);
	return async () => {
		contextCore.check(owned);
		await (candidate as () => Promise<void>).call(parent);
		contextCore.check(owned);
	};
}
