import * as codec from '@okikio/schema/codec';
/** Bridge durable attempts to existing engine providers. Pools and transports remain provider-owned. @module */
import * as context from '@okikio/context';

import { ExecutionError } from './execution.ts';
import type { InvocationType, LocalActivity } from './execution.ts';
import type { EngineProvider, EngineReference } from './types.ts';

/** One borrowed provider and its durable dispatch budget. */
export interface EngineBinding {
	/** Exact engine identity used by activity placement. */
	readonly engine: EngineReference;
	/** Borrowed provider. Join the durable worker before disposing its process or thread pool. */
	readonly provider: EngineProvider;
	/** Total simultaneous attempts. Keep this within physical pool maximum × per-host concurrency. */
	readonly capacity: number;
	/** Slots ordinary work cannot use. Reserve these when this engine runs cleanup. */
	readonly reserved?: number;
}

/** Admission counters stay in the coordinator; attempts retain slots through provider cleanup. */
export interface BoundEngine {
	readonly binding: EngineBinding;
	readonly activities: readonly LocalActivity[];
	available(cleanup: boolean): boolean;
}

/** Adapt without replacing the provider's process/channel/worker ownership machinery. */
export function bind(binding: EngineBinding): BoundEngine {
	const { capacity, reserved = 0 } = binding;
	if (
		!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1024 ||
		!Number.isSafeInteger(reserved) || reserved < 0 || reserved >= capacity
	) {
		throw new RangeError('Engine capacity must be 1..1024; reserved slots must be smaller.');
	}
	// Copy the validated assembly. Later caller mutation must not change admitted capacity or replace the borrowed provider.
	const selected = Object.freeze({ engine: binding.engine, provider: binding.provider, capacity, reserved });
	let active = 0;
	const activities = selected.provider.activities.map((reference): LocalActivity => {
		const definition = reference as LocalActivity['definition'];
		if (
			!Array.isArray(definition.effects) || !Array.isArray(definition.resources) ||
			!definition.placement.choices.some((choice) => choice.engine.id === selected.engine.id)
		) {
			throw new ExecutionError('engine_binding');
		}
		if (definition.requirements.length) {
			throw new ExecutionError(
				'unsupported_activity_requirements',
				'Remote durable activity admission requirements need an explicit authority.',
			);
		}
		return Object.freeze({
			definition,
			/**
			 * Send one claimed activity to its registered provider with the saved operation identity. Join the
			 * provider call before releasing local invocation accounting.
			 */
			async invoke(options: InvocationType) {
				active++;
				try {
					if (!options.origin) {
						throw new ExecutionError('engine_origin', 'The store must supply a saved operation path for remote work.');
					}
					const result = await selected.provider.run(options.ctx, {
						jobId: options.jobId,
						location: options.location,
						attempt: options.attempt,
						claimId: `${options.jobId}:${options.claim.generation}`,
						activityId: definition.id,
						activityVersion: definition.version,
						engineId: selected.engine.id,
						registrationId: options.claim.hostId,
						hostId: options.claim.hostId,
						generation: options.claim.hostGeneration,
						origin: options.origin,
						context: context.snapshot(options.ctx),
						input: options.input,
						admitted: true,
					}, {
						heartbeat: options.heartbeat ?? (async () => options.ctx.signal.throwIfAborted()),
						effect: options.effect,
					});
					if (result.type === 'success') {
						return await codec.read(definition.result, await codec.write(definition.result, result.value));
					}
					if (result.type === 'failure') throw result.failure;
					if (result.type === 'lost') {
						throw new ExecutionError(
							result.code === 'busy' ? 'host_busy' : result.code === 'lost' ? 'host_lost' : 'engine_lost',
						);
					}
					throw result.type === 'fault' ? result.fault : result.reason;
				} finally {
					active--;
				}
			},
		});
	});
	return Object.freeze({
		binding: selected,
		activities,
		available: (cleanup: boolean) => active < capacity - (cleanup ? 0 : reserved),
	});
}
