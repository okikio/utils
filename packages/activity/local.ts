/**
 * Process-local activity engine provider.
 *
 * The provider adapts exact activity implementations to the generic Workflow
 * Scheduler engine protocol. It does not own the Scheduler job, attempt number,
 * retry policy, queue claim, or registration generation.
 *
 * @module
 */
import * as context from '@okikio/context';
import type { EffectEmitter } from '@okikio/effect';
import type { PermissionChecker } from '@okikio/permission';
import type { RequirementRuntime } from '@okikio/requirement';
import type { ResourceCollection } from '@okikio/resource';
import type {
	ActivityAttemptResultType,
	EngineProvider,
} from '@okikio/workflow';
import * as activity from './mod.ts';
import type { ActivityDefinition, ActivityImplementation } from './types.ts';
import type { EngineDefinition } from './engine.ts';

/** Options accepted by `local.create()`. */
export interface LocalProviderOptions {
	/** Exact engine definition represented by this local provider. */
	readonly engine: EngineDefinition;
	/** Implementations available through this provider. */
	readonly implementations: readonly ActivityImplementation[];
	/** Borrowed resource collection shared by local attempts. */
	readonly resources: ResourceCollection;
	/** Optional actor-specific permission evaluator. */
	readonly permission?: PermissionChecker;
	/** Optional authoritative effect owner. */
	readonly effect?: EffectEmitter;
	/** Generic requirement interpreters used by direct attempts and resources. */
	readonly requirements?: RequirementRuntime;
	/** Optional cooperative pause gate supplied by the host. */
	readonly checkpoint?: () => Promise<void>;
}

/** Raised when a provider receives an activity it did not register. */
export class MissingActivityError extends Error {
	/** Stable activity ID requested from this local provider. */
	readonly activityId: string;
	/** Activity contract version requested from this local provider. */
	readonly version: string;

	/** Create one configuration error for an activity/version the provider does not implement. */
	constructor(activityId: string, version: string) {
		super(`Local engine provider has no implementation for ${JSON.stringify(`${activityId}@${version}`)}.`);
		this.name = 'MissingActivityError';
		this.activityId = activityId;
		this.version = version;
	}
}

/**
 * Create one borrowed process-local engine provider.
 *
 * The returned provider owns no resource collection and starts no background
 * worker. Every `run()` call executes one Scheduler-owned attempt immediately.
 */
export function create(options: LocalProviderOptions): EngineProvider {
	assertEngine(options.engine);
	if (options.implementations.length === 0) throw new TypeError('Local engine provider requires at least one implementation.');
	const byDefinition = new Map<ActivityDefinition, ActivityImplementation>();
	const byIdentity = new Map<string, ActivityImplementation>();
	for (const implementation of options.implementations) {
		assertImplementation(implementation);
		if (byDefinition.has(implementation.definition)) {
			throw new TypeError(`Activity ${JSON.stringify(implementation.definition.id)} has more than one local implementation.`);
		}
		const key = identity(implementation.definition);
		if (byIdentity.has(key)) throw new TypeError(`Activity identity ${JSON.stringify(key)} belongs to different local definitions.`);
		byDefinition.set(implementation.definition, implementation);
		byIdentity.set(key, implementation);
	}

	return Object.freeze({
		activities: Object.freeze([...byDefinition.keys()]),
		async run(
			ctx: import('@okikio/context').Context,
			attempt: import('@okikio/workflow').ActivityAttemptType,
			control: import('@okikio/workflow').ActivityAttemptControl,
		): Promise<ActivityAttemptResultType> {
			if (attempt.engineId !== options.engine.id) {
				return Object.freeze({ type: 'fault', fault: new activity.InvalidEngineError(attempt.activityId, attempt.engineId) });
			}
			const implementation = byIdentity.get(`${attempt.activityId}@${attempt.activityVersion}`);
			if (implementation === undefined) {
				return Object.freeze({ type: 'fault', fault: new MissingActivityError(attempt.activityId, attempt.activityVersion) });
			}
			try {
				const value = await activity.run({
					implementation,
					engine: options.engine,
					input: attempt.input,
					ctx,
					resources: options.resources,
					jobId: attempt.jobId,
					attempt: attempt.attempt,
					admitted: attempt.admitted,
					...(options.permission === undefined ? {} : { permission: options.permission }),
					...(options.effect === undefined ? {} : { effect: options.effect }),
					...(options.requirements === undefined ? {} : { requirements: options.requirements }),
					...(options.checkpoint === undefined ? {} : { checkpoint: options.checkpoint }),
					heartbeat(value) { return control.heartbeat(value); },
				});
				return Object.freeze({ type: 'success', value });
			} catch (error) {
				if (activity.isFailure(implementation.definition, error)) {
					return Object.freeze({ type: 'failure', failure: error });
				}
				if (isCancellation(error) || ctx.signal.aborted) {
					return Object.freeze({ type: 'cancelled', reason: ctx.signal.aborted ? ctx.signal.reason : error });
				}
				return Object.freeze({ type: 'fault', fault: error });
			}
		},
	});
}

/** Return the stable in-process identity for one exact activity version. */
function identity(definition: ActivityDefinition): string {
	return `${definition.id}@${definition.version}`;
}

/** Reject a malformed implementation before provider registration. */
function assertImplementation(value: ActivityImplementation): void {
	if (typeof value !== 'object' || value === null || value.definition?.kind !== 'activity' || typeof value.run !== 'function') {
		throw new TypeError('Local provider implementation must bind an activity definition to run().');
	}
}

/** Reject a malformed activity-engine definition before provider creation. */
function assertEngine(value: EngineDefinition): void {
	if (typeof value !== 'object' || value === null || value.kind !== 'activity-engine' || typeof value.id !== 'string') {
		throw new TypeError('Local provider requires an activity-engine definition.');
	}
}

/** Return whether the reason represents cooperative context cancellation. */
function isCancellation(value: unknown): boolean {
	return value instanceof context.ContextCancelledError || value instanceof context.ContextDeadlineExceededError;
}
