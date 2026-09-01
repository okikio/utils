import type { Context as BaseContext, Resources as OwnedResources } from '@okikio/context';
import type { RequirementContext, RequirementRuntime } from '@okikio/requirement';
import type { ResourceCollection, ResourceDefinition, ResourceValue } from '@okikio/resource';

/** Lifecycle state of one process-local Task. */
export type TaskStatusType = 'running' | 'pausing' | 'paused' | 'cancelling' | 'completed' | 'failed' | 'cancelled';

/** Context supplied to one process-local Task operation. */
export interface TaskContext<Allowed extends ResourceDefinition = never> extends RequirementContext<BaseContext>, OwnedResources {
	/** Borrow one allowed resource under the current Task's active requirements. */
	get<Resource extends Allowed>(definition: Resource): Promise<ResourceValue<Resource>>;
	/** Wait at one cooperative pause point and always recheck cancellation before returning. */
	checkpoint(): Promise<void>;
}

/** Options accepted by `tasks.start()`. */
export interface TaskOptions<Allowed extends ResourceDefinition = never> {
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
export interface Task<Value> extends AsyncDisposable {
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
