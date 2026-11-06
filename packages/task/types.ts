import type { ExecutionContext } from '@okikio/capability/execution';
import type { ProgressEffect } from './progress.ts';
import type { EffectDefinition, EffectEmitter, EffectOccurrence } from '@okikio/capability/effect';
import type { Observable } from '@okikio/observables/observable';
import type { Context as BaseContext } from '@okikio/context';
import type { RequirementRuntime } from '@okikio/capability/requirement';
import type { ResourceCollection, ResourceDefinition } from '@okikio/capability/resource';

/** Lifecycle state of one process-local Task. */
export type TaskStatusType = 'running' | 'pausing' | 'paused' | 'cancelling' | 'completed' | 'failed' | 'cancelled';

/** Context supplied to one process-local Task operation. */
export interface TaskContext<Allowed extends ResourceDefinition = never> extends ExecutionContext<Allowed> {}

/** Options accepted by `tasks.start()`. */
export interface TaskOptions<Allowed extends ResourceDefinition = never, Progress extends EffectDefinition = never> {
	/** Optional custom progress effect. The standard ProgressEffect is always recognized. */
	readonly progress?: Progress;
	/** Additional effects this task may emit. */
	readonly effects?: readonly EffectDefinition[];
	/** Borrowed recipient for effects other than progress. */
	readonly emitter?: EffectEmitter;
	/** Subscriber failures are diagnostic and never change done. */
	readonly onError?: (error: unknown) => void;
	/** Optional stable local identity used for correlation inside the parent execution. */
	readonly id?: string;
	/** Borrowed parent execution context. The Task creates its own child cancellation lifetime. */
	readonly ctx?: BaseContext;
	/** Borrowed resource collection. The Task never disposes the collection. */
	readonly resources?: ResourceCollection;
	/** Definitions the Task is allowed to borrow from the collection. */
	readonly allowed?: readonly Allowed[];
	/** Requirement interpreters inherited by resource use inside this Task. */
	readonly requirements?: RequirementRuntime;
}

/** One process-local structured execution lifetime. */
export interface Task<Value, Progress extends EffectDefinition = typeof ProgressEffect> extends AsyncDisposable {
	/** Latest accepted progress occurrence. Its value follows the declared effect schema. */
	readonly progress: EffectOccurrence<Progress> | undefined;
	/** Coalesced progress observations. done still owns completion and cleanup. */
	readonly updates: Observable<EffectOccurrence<Progress>>;
	/** Terminal authority for the operation result. */
	readonly done: Promise<Value>;
	/** Abort signal for the Task-owned local execution lifetime. */
	readonly signal: AbortSignal;
	/** Current synchronous lifecycle snapshot. `done` remains terminal authority. */
	readonly status: TaskStatusType;
	/** Request a cooperative pause and resolve when the Task reaches a checkpoint or becomes terminal. */
	pause(): Promise<void>;
	/** Release the current pause generation. */
	resume(): void;
	/** Cancel active work and resolve after its owned cleanup has stopped. */
	cancel(reason?: unknown): Promise<void>;
}
