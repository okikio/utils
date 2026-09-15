/**
 * Shared contracts for activity providers that execute attempts outside the Scheduler host.
 *
 * Process and Worker providers have different transport and lifecycle behavior.
 * They still use the same activity identity, catalog validation, and serializable
 * attempt protocol. This module owns only that common contract.
 *
 * @internal
 */
import * as faultCore from '@okikio/fault';
import type { ActivityAttemptType } from '@okikio/workflow';
import * as activity from './mod.ts';
import * as transport from './transport.ts';
import type { EngineDefinition } from './engine.ts';
import type { ActivityDefinition, ActivityImplementation } from './types.ts';

/** Return the stable activity identity shared by parent contracts and remote implementations. */
export function identity(id: string, version: string): string {
	return `${id}@${version}`;
}

/** Index advertised activity contracts and reject conflicting definitions at one stable identity. */
export function definitions(input: readonly ActivityDefinition[], owner: string): Map<string, ActivityDefinition> {
	if (input.length === 0) throw new TypeError(`${owner} requires at least one activity definition.`);
	const output = new Map<string, ActivityDefinition>();
	for (const definition of input) {
		const key = identity(definition.id, definition.version);
		const existing = output.get(key);
		if (existing !== undefined && existing !== definition) {
			throw new TypeError(`Activity identity ${JSON.stringify(key)} belongs to different definitions.`);
		}
		output.set(key, definition);
	}
	return output;
}

/** Index remote implementations and reject duplicate ownership of one activity identity. */
export function implementations(input: readonly ActivityImplementation[], owner: string): Map<string, ActivityImplementation> {
	if (input.length === 0) throw new TypeError(`${owner} requires at least one activity implementation.`);
	const output = new Map<string, ActivityImplementation>();
	for (const implementation of input) {
		const key = identity(implementation.definition.id, implementation.definition.version);
		if (output.has(key)) throw new TypeError(`${owner} has more than one implementation for ${JSON.stringify(key)}.`);
		output.set(key, implementation);
	}
	return output;
}

/** Resolve one Scheduler attempt to an advertised activity contract. */
export function definition(
	activities: ReadonlyMap<string, ActivityDefinition>,
	engine: EngineDefinition,
	attempt: ActivityAttemptType,
	missing: (id: string, version: string) => Error,
): ActivityDefinition {
	if (attempt.engineId !== engine.id) throw new activity.InvalidEngineError(attempt.activityId, attempt.engineId);
	const value = activities.get(identity(attempt.activityId, attempt.activityVersion));
	if (value === undefined) throw missing(attempt.activityId, attempt.activityVersion);
	return value;
}

/** Validate an activity engine before a provider starts a remote host. */
export function engine(value: EngineDefinition, owner: string): void {
	if (typeof value !== 'object' || value === null || value.kind !== 'activity-engine' || typeof value.id !== 'string') {
		throw new TypeError(`${owner} requires an activity-engine definition.`);
	}
}

/** Validate the maximum permission leaves accepted in one remote reverse call. */
export function maximumChecks(value: number | undefined, owner: string): number {
	const limit = value ?? 1_000;
	if (!Number.isSafeInteger(limit) || limit < 1) {
		throw new TypeError(`${owner} permission maximumChecks must be a positive safe integer.`);
	}
	return limit;
}

/** Return the structural protocol shared by process framing and Worker messages. */
export function protocol() {
	return Object.freeze({
		request: transport.AttemptSchema,
		response: transport.ResultSchema,
		notice: transport.NoticeSchema,
		call: Object.freeze({ request: transport.CallSchema, response: transport.ReplySchema }),
	});
}

/** Convert an unexpected remote runtime value to bounded serializable diagnostics. */
export function fault(value: unknown): faultCore.FaultValue {
	return faultCore.encode(value);
}
