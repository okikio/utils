/**
 * Internal serializable activity-attempt protocol shared by Worker and process providers.
 *
 * Live permission definitions, effect definitions, schemas, resources, and loggers
 * never cross runtime seams. Messages carry stable IDs and schema-safe values;
 * each receiving host resolves those IDs against its own imported exact definitions.
 *
 * @internal
 */
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Context } from '@okikio/context';
import * as effect from '@okikio/effect';
import * as failure from '@okikio/failure';
import * as faultCore from '@okikio/fault';
import type { EffectEmitter, EffectEncoded } from '@okikio/effect';
import * as permissions from '@okikio/permission';
import type { PermissionChecker, PermissionDecision, PermissionRequest } from '@okikio/permission';
import * as requirement from '@okikio/requirement';
import * as resource from '@okikio/resource';
import * as schema from '@okikio/schema';
import type {
	ActivityAttemptControl,
	ActivityAttemptResultType,
	ActivityAttemptType,
} from '@okikio/workflow';
import type { ActivityDefinition } from './types.ts';

/** Cloneable atomic permission request carried to the authority-owning host. */
export interface PermissionWireType {
	/** Stable permission definition ID resolved by the authority-owning host. */
	readonly id: string;
	/** Cloneable permission target validated again by the authority-owning host. */
	readonly target: unknown;
}

/** Reverse calls made by one remote activity attempt. */
export type HostCallType =
	| Readonly<{ readonly type: 'permission'; readonly requests: readonly PermissionWireType[] }>
	| Readonly<{ readonly type: 'effect'; readonly effect: EffectEncoded }>
	| Readonly<{ readonly type: 'heartbeat'; readonly value?: unknown }>;

/** Replies returned by the authority-owning host. */
export type HostReplyType =
	| Readonly<{ readonly type: 'permission'; readonly decisions: readonly PermissionDecision[] }>
	| Readonly<{ readonly type: 'effect'; readonly accepted: true }>
	| Readonly<{ readonly type: 'heartbeat'; readonly accepted: true }>;

/** Terminal activity result safe for Worker structured clone and process JSON framing. */
export type WireResultType =
	| Readonly<{ readonly type: 'success'; readonly value: unknown }>
	| Readonly<{ readonly type: 'failure'; readonly failure: failure.Encoded }>
	| Readonly<{ readonly type: 'fault'; readonly fault: unknown }>
	| Readonly<{ readonly type: 'cancelled'; readonly reason: unknown }>;

/** Optional remote-activity observation. Heartbeats are authoritative reverse calls instead. */
export interface NoticeType {
	/** Notice discriminant retained across Worker and process transports. */
	readonly type: 'observation';
	/** Cloneable optional observation payload. */
	readonly value: unknown;
}

/** Host services required to answer remote activity reverse calls. */
export interface HostServices {
	/** Optional policy checker used to answer reverse permission calls. */
	readonly permission?: PermissionChecker;
	/** Optional required-effect owner used to answer reverse effect calls. */
	readonly effect?: EffectEmitter;
}

/** Structural schemas used by both Worker and process channel protocols. */
export const AttemptSchema = contract<ActivityAttemptType>(attempt, 'Expected an activity attempt envelope.');
/** Structural schema for one terminal remote activity-attempt result. */
export const ResultSchema = contract<WireResultType>(wireResult, 'Expected an activity terminal result.');
/** Structural schema for one optional remote activity observation notice. */
export const NoticeSchema = contract<NoticeType>(notice, 'Expected an activity observation.');
/** Structural schema for one reverse permission, effect, or heartbeat request. */
export const CallSchema = contract<HostCallType>(hostCall, 'Expected an activity host call.');
/** Structural schema for one reverse-call acknowledgement or permission decision batch. */
export const ReplySchema = contract<HostReplyType>(hostReply, 'Expected an activity host reply.');

/** Create a permission checker that delegates one logical batch to the owning host. */
export function checker(
	call: (request: HostCallType) => Promise<HostReplyType>,
	maximumChecks: number,
): PermissionChecker {
	if (!Number.isSafeInteger(maximumChecks) || maximumChecks < 1) {
		throw new TypeError('Remote permission maximumChecks must be a positive safe integer.');
	}
	return Object.freeze({
		maximumChecks,
		async check(_ctx: Context, requests: readonly PermissionRequest[]) {
			const reply = await call(Object.freeze({
				type: 'permission',
				requests: Object.freeze(requests.map((request: PermissionRequest) => Object.freeze({
					id: request.definition.id,
					target: request.target,
				}))),
			}));
			if (reply.type !== 'permission') throw new TypeError('Remote permission call returned the wrong reply type.');
			return reply.decisions;
		},
	});
}

/** Create an effect emitter whose acceptance comes from the authority-owning host. */
export function emitter(call: (request: HostCallType) => Promise<HostReplyType>): EffectEmitter {
	return Object.freeze({
		async emit(_ctx: Context, occurrence: effect.EffectOccurrence) {
			const encoded = await effect.encode(occurrence);
			const reply = await call(Object.freeze({ type: 'effect', effect: encoded }));
			if (reply.type !== 'effect' || reply.accepted !== true) {
				throw new TypeError('Remote effect call returned the wrong reply type.');
			}
		},
	});
}

/** Forward one activity heartbeat and wait until the Scheduler renews the exact claim. */
export async function heartbeat(
	call: (request: HostCallType) => Promise<HostReplyType>,
	value?: unknown,
): Promise<void> {
	const reply = await call(Object.freeze({ type: 'heartbeat', ...(value === undefined ? {} : { value }) }));
	if (reply.type !== 'heartbeat' || reply.accepted !== true) throw new TypeError('Remote heartbeat returned the wrong reply type.');
}

/**
 * Answer one remote host call after resolving IDs against the exact activity contract.
 *
 * Permission targets are revalidated on the authority-owning side before the
 * provider receives them. Effects are decoded only through effects declared by
 * this exact activity. A heartbeat resolves only after the Scheduler renews the
 * current queue claim.
 */
export async function answer(
	ctx: Context,
	activity: ActivityDefinition,
	control: ActivityAttemptControl,
	services: HostServices,
	call: HostCallType,
): Promise<HostReplyType> {
	if (call.type === 'heartbeat') {
		await control.heartbeat(call.value);
		return Object.freeze({ type: 'heartbeat', accepted: true });
	}
	if (call.type === 'effect') {
		if (services.effect === undefined) throw new effect.MissingEffectEmitterError();
		const occurrence = await effect.decode(call.effect, activity.effects);
		await services.effect.emit(ctx, occurrence);
		return Object.freeze({ type: 'effect', accepted: true });
	}
	if (services.permission === undefined) throw new permissions.MissingPermissionCheckerError();
	if (call.requests.length > services.permission.maximumChecks) {
		throw new permissions.PermissionCheckLimitError(call.requests.length, services.permission.maximumChecks);
	}
	const definitions = getPermissions(activity);
	const requests: PermissionRequest[] = [];
	for (const wire of call.requests) {
		const definition = definitions.find((candidate) => candidate.id === wire.id);
		if (definition === undefined) throw new permissions.UndeclaredPermissionError(permissionDefinition(wire.id));
		const target = definition.target === undefined
			? targetless(wire.target, definition)
			: await schema.parse(definition.target, wire.target);
		requests.push(Object.freeze({ definition, target }) as PermissionRequest);
	}
	const decisions = await services.permission.check(ctx, Object.freeze(requests));
	if (decisions.length !== requests.length) {
		throw new permissions.PermissionDecisionError(`Permission evaluator returned ${decisions.length} decisions for ${requests.length} requests.`);
	}
	return Object.freeze({
		type: 'permission',
		decisions: Object.freeze(decisions.map(cloneDecision)),
	});
}

/** Decode a remote terminal result through the parent activity's exact failures. */
export async function result(activity: ActivityDefinition, value: WireResultType): Promise<ActivityAttemptResultType> {
	if (value.type === 'failure') {
		return Object.freeze({ type: 'failure', failure: await failure.decode(value.failure, activity.failures) });
	}
	return value;
}

/** Encode one child-side terminal activity result for transport. */
export async function wire(activity: ActivityDefinition, value: ActivityAttemptResultType): Promise<WireResultType> {
	if (value.type === 'failure') {
		if (!isFailureOccurrence(value.failure) || !activity.failures.includes(value.failure.definition)) {
			return Object.freeze({ type: 'fault', fault: safeFault(new TypeError('Remote activity returned an undeclared failure.')) });
		}
		return Object.freeze({ type: 'failure', failure: await failure.encode(value.failure) });
	}
	if (value.type === 'lost') return Object.freeze({ type: 'fault', fault: safeFault(value.reason) });
	if (value.type === 'fault') return Object.freeze({ type: 'fault', fault: safeFault(value.fault) });
	if (value.type === 'cancelled') return Object.freeze({ type: 'cancelled', reason: safeFault(value.reason) });
	return value;
}

/**
 * Gets permission definitions reachable through the activity and its resource graph.
 *
 * The returned definitions include direct activity requirements and requirements
 * contributed by reachable resources. The function does not authorize an actor.
 * It only resolves the declarations that a remote attempt is allowed to check.
 */
export function getPermissions(activity: ActivityDefinition): readonly permissions.PermissionDefinition[] {
	const reachable = requirement.compose(activity.requirements, resource.reachable(activity.resources));
	return Object.freeze(reachable.filter((entry) => entry.family === 'permission').map((entry) => entry.definition as permissions.PermissionDefinition));
}

/** Construct one descriptive placeholder only for undeclared-ID error reporting. */
function permissionDefinition(id: string): permissions.PermissionDefinition {
	return Object.freeze({ kind: 'permission', id });
}

/** Reject a target value for a permission whose target is derived from execution state. */
function targetless(value: unknown, definition: permissions.PermissionDefinition): undefined {
	if (value !== undefined) throw new TypeError(`Permission ${JSON.stringify(definition.id)} does not accept a runtime target.`);
	return undefined;
}

/** Preserve allow/deny/error shape while bounding Error objects for process JSON transport. */
function cloneDecision(value: PermissionDecision): PermissionDecision {
	if ('error' in value) return Object.freeze({ error: safeFault(value.error) });
	return Object.freeze({ allowed: value.allowed, ...(value.reason === undefined ? {} : { reason: value.reason }) });
}

/** Return whether a value is an expected failure occurrence from `@okikio/failure`. */
function isFailureOccurrence(value: unknown): value is failure.Occurrence {
	return failure.isOccurrence(value);
}

/** Convert faults to bounded cloneable diagnostics before crossing a runtime seam. */
function safeFault(value: unknown): faultCore.FaultValue {
	return faultCore.encode(value);
}

/** Build one small Standard Schema adapter around a structural protocol predicate. */
function contract<Value>(
	check: (value: unknown) => value is Value,
	message: string,
): StandardSchemaV1<unknown, Value> {
	return Object.freeze({
		'~standard': Object.freeze({
			version: 1 as const,
			vendor: 'utils-activity',
			validate(value: unknown) {
				return check(value) ? { value } : { issues: [{ message }] };
			},
		}),
	});
}

/** Validate the identity and minimum serializable fields of one activity attempt. */
function attempt(value: unknown): value is ActivityAttemptType {
	if (!record(value)) return false;
	return strings(value, ['jobId', 'claimId', 'activityId', 'activityVersion', 'engineId', 'registrationId', 'hostId']) &&
		Number.isSafeInteger(value.attempt) && Number(value.attempt) > 0 &&
		Number.isSafeInteger(value.generation) && Number(value.generation) > 0 &&
		record(value.origin) && strings(value.origin, ['workflowId', 'workflowVersion', 'runId', 'instructionPath', 'instructionFingerprint']) &&
		record(value.context) && typeof value.context.id === 'string' && typeof value.context.startedAt === 'string' && 'input' in value;
}

/** Validate the serializable terminal result envelope without interpreting activity schemas. */
function wireResult(value: unknown): value is WireResultType {
	if (!record(value) || typeof value.type !== 'string') return false;
	if (value.type === 'success') return 'value' in value;
	if (value.type === 'failure') return encodedFailure(value.failure);
	if (value.type === 'fault') return 'fault' in value;
	if (value.type === 'cancelled') return 'reason' in value;
	return false;
}

/** Validate an optional activity observation envelope. */
function notice(value: unknown): value is NoticeType {
	return record(value) && value.type === 'observation' && 'value' in value;
}

/** Validate one reverse-call envelope before a provider sees its contents. */
function hostCall(value: unknown): value is HostCallType {
	if (!record(value) || typeof value.type !== 'string') return false;
	if (value.type === 'heartbeat') return true;
	if (value.type === 'effect') return record(value.effect) && typeof value.effect.id === 'string' && typeof value.effect.key === 'string' && 'value' in value.effect;
	if (value.type === 'permission') return Array.isArray(value.requests) && value.requests.every((item) => record(item) && typeof item.id === 'string' && 'target' in item);
	return false;
}

/** Validate one reverse-call reply discriminant and payload. */
function hostReply(value: unknown): value is HostReplyType {
	if (!record(value) || typeof value.type !== 'string') return false;
	if (value.type === 'heartbeat' || value.type === 'effect') return value.accepted === true;
	return value.type === 'permission' && Array.isArray(value.decisions) && value.decisions.every((decision) =>
		record(decision) && (typeof decision.allowed === 'boolean' || 'error' in decision)
	);
}

/** Validate the encoded failure fields shared with `@okikio/failure`. */
function encodedFailure(value: unknown): value is failure.Encoded {
	return record(value) && typeof value.id === 'string' && typeof value.message === 'string' && 'data' in value;
}

/** Test several required string fields on one already-narrowed object. */
function strings(value: Record<string, unknown>, fields: readonly string[]): boolean {
	return fields.every((field) => typeof value[field] === 'string');
}

/** Narrow unknown transport values before structural field access. */
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
