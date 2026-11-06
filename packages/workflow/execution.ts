import type { ComputeType, EngineAffinityType, WorkflowDurableValue } from './types.ts';
import type { SelectionType } from './placement.ts';
import type { ContractInput, ContractOutput } from '@okikio/schema/codec';
import type { EffectDefinition, EffectEmitter, EffectEncoded } from '@okikio/capability/effect';
/** Data saved for accepted background work. Live clients and temporary attempt permission stay in the worker. @module */
import type { TraceType } from '@okikio/telemetry/instrument';

import type { Context } from '@okikio/context';
import type { ResourceCollection, ResourceDefinition } from '@okikio/capability/resource';
import * as schema from '@okikio/schema';
import { restore, snapshot, value } from './durable.ts';
import { choice, integer, list, object, text, uuid } from './validation.ts';
import type { ActivityReference, WorkflowReference } from './types.ts';

/** Name and version of the code that can run this work. A saved workflow version must keep the same program. */
export const IdentitySchema: schema.Reader<{ kind: 'activity' | 'workflow'; id: string; version: string }, unknown> =
	schema.define((input) => {
		const data = object(input, ['kind', 'id', 'version']);
		return {
			kind: choice(data.kind, ['activity', 'workflow']),
			id: text(data.id, 1, 256),
			version: text(data.version, 1, 128),
		};
	});
/** Serializable identity of one exact definition. */
export type IdentityType = schema.Output<typeof IdentitySchema>;
/** Address of one saved run. It contains no code and grants no user permission. */
export const ReferenceSchema: schema.Reader<
	{
		id: string;
		namespace: string;
		scope: string;
		definition: { kind: 'activity' | 'workflow'; id: string; version: string };
	},
	unknown
> = schema.define((input) => {
	const data = object(input, ['id', 'namespace', 'scope', 'definition']);
	return {
		id: uuid(data.id),
		namespace: text(data.namespace, 1, 128),
		scope: text(data.scope, 1, 256),
		definition: IdentitySchema.parse(data.definition),
	};
});
/** A run reference that can travel in an HTTP response or saved application row. */
export type ReferenceType = schema.Output<typeof ReferenceSchema>;
/** Activity and workflow definitions that can be submitted as saved work. */
export type DefinitionType = ActivityReference | WorkflowReference;
/** Result inferred from an explicitly supplied definition. */
export type ValueType<D extends DefinitionType> = ContractOutput<D['result']>;
/** Input inferred from an explicitly supplied definition. */
export type InputType<D extends DefinitionType> = ContractInput<D['input']>;

/** Explicit encoding distinguishes undefined from an absent result. */
export const ValueSchema: schema.Reader<
	{
		kind: 'undefined';
		value?: undefined;
	} | {
		kind: 'value';
		value: WorkflowDurableValue;
	},
	unknown
> = schema.define((input) => {
	const data = object(input, ['kind', 'value']);
	if (data.kind === 'undefined') {
		object(data, ['kind']);
		return { kind: 'undefined' as const };
	}
	if (data.kind !== 'value') schema.reject('Expected an encoded workflow value.');
	return { kind: 'value' as const, value: snapshot(data.value, 'value') };
});
/** Accepted result or bounded failure; raw Errors and causes do not enter storage. */
export const OutcomeSchema: schema.Reader<
	{
		type: 'success';
		value: {
			kind: 'undefined';
			value?: undefined;
		} | {
			kind: 'value';
			value: WorkflowDurableValue;
		};
		id?: undefined;
		data?: undefined;
		message?: undefined;
		code?: undefined;
		reason?: undefined;
	} | {
		type: 'failure';
		id: string;
		data: WorkflowDurableValue;
		message: string;
		value?: undefined;
		code?: undefined;
		reason?: undefined;
	} | {
		type: 'fault';
		code: string;
		message: string;
		value?: undefined;
		id?: undefined;
		data?: undefined;
		reason?: undefined;
	} | {
		type: 'cancelled';
		reason: string;
		value?: undefined;
		id?: undefined;
		data?: undefined;
		message?: undefined;
		code?: undefined;
	},
	unknown
> = schema.define((input) => {
	const data = object(input, ['type', 'value', 'id', 'data', 'message', 'code', 'reason']);
	switch (data.type) {
		case 'success':
			object(data, ['type', 'value']);
			return { type: 'success' as const, value: ValueSchema.parse(data.value) };
		case 'failure':
			object(data, ['type', 'id', 'data', 'message']);
			return {
				type: 'failure' as const,
				id: text(data.id),
				data: snapshot(data.data, 'failure data'),
				message: text(data.message, 0, 2048),
			};
		case 'fault':
			object(data, ['type', 'code', 'message']);
			return { type: 'fault' as const, code: text(data.code), message: text(data.message, 0, 2048) };
		case 'cancelled':
			object(data, ['type', 'reason']);
			return { type: 'cancelled' as const, reason: text(data.reason, 0, 2048) };
		default:
			schema.reject('Unknown workflow outcome.');
	}
});
/** Saved result or failure. A finalizer receives this intended exit before it becomes terminal. */
export type OutcomeType = schema.Output<typeof OutcomeSchema>;
/** Input for the exit-recording activity. The intended result stays fixed while that activity runs. */
export const FinalizationSchema: schema.Reader<{
	run: {
		id: string;
		scope: string;
		definition: {
			kind: 'activity' | 'workflow';
			id: string;
			version: string;
		};
		input: unknown;
	};
	exit: OutcomeType;
}, unknown> = schema.define((input) => {
	const data = object(input, ['run', 'exit']);
	const run = object(data.run, ['id', 'scope', 'definition', 'input']);
	if (!Object.hasOwn(run, 'input')) schema.reject('Finalizer run input is required.');
	return {
		run: {
			id: uuid(run.id),
			scope: text(run.scope),
			definition: IdentitySchema.parse(run.definition),
			input: run.input,
		},
		exit: OutcomeSchema.parse(data.exit),
	};
});

/** Copy identity fields without serializing a definition's schemas or live values. */
export function identity(definition: Pick<DefinitionType, 'kind' | 'id' | 'version'>): IdentityType {
	return IdentitySchema.parse({ kind: definition.kind, id: definition.id, version: definition.version });
}
/** Stable composite used only for exact catalog matching. */
export function address(definition: IdentityType): string {
	return JSON.stringify([definition.kind, definition.id, definition.version]);
}

/** Accept complete authored definitions, but save only their kind, name, and version. */
function definition(input: unknown): IdentityType {
	if (typeof input !== 'object' || input === null) schema.reject('Expected a workflow or activity definition.');
	return identity(input as IdentityType);
}
/** Validate the rules common to an ordinary attempt and an exit-recording attempt. */
function tries(data: Readonly<Record<string, unknown>>) {
	const delay = object(data.delay, ['initialMs', 'maximumMs']);
	const initialMs = integer(delay.initialMs, 1, 60_000), maximumMs = integer(delay.maximumMs, 1, 3_600_000);
	if (initialMs > maximumMs) schema.reject('Initial delay exceeds maximum delay.');
	return {
		/** Total tries, including attempts whose worker died before returning a result. */
		maxAttempts: integer(data.maxAttempts, 1, 1000),
		/** Maximum milliseconds for one try. Renewal cannot extend this deadline. */
		deadlineMs: integer(data.deadlineMs, 1, 86_400_000),
		/** Whether a classified transient failure may use another try. */
		retry: choice(data.retry, ['transient', 'never']),
		/** Millisecond delays double from initialMs up to maximumMs. The chosen due time is saved. */
		delay: { initialMs, maximumMs },
	};
}
/** Validate one activity's bounded retry rules. The caller checks its complete record keys. */
function attempt(
	data: Readonly<Record<string, unknown>>,
): {
	recovery: 'retry' | 'reconcile';
	requires: string[];
	maxAttempts: number;
	deadlineMs: number;
	retry: 'transient' | 'never';
	delay: { initialMs: number; maximumMs: number };
} {
	return {
		...tries(data),
		/** Retry after worker loss only when the application says repetition is safe; otherwise block for inspection. */
		recovery: choice(data.recovery, ['retry', 'reconcile']),
		/** Storage or provider guarantees the actual worker must supply for this activity. */
		requires: list(data.requires, (input) => text(input, 1), 32),
	};
}
/** Attempt count, time limit, crash response, and required storage or provider guarantees. */
export type AttemptType = ReturnType<typeof attempt>;
/** Plain saved rules for queue limits, retry safety, child work, and finalization. It contains no live code or clients. */
export const PolicySchema: schema.Reader<{
	id: string;
	version: string;
	limits: {
		inputBytes: number;
		resultBytes: number;
		historyBytes: number;
		pendingRoots: number;
		reservedSuccessors: number;
		pendingChildren: number;
		pendingFinalizers: number;
	};
	claims: {
		leaseMs: number;
		renewEveryMs: number;
		recoverEveryMs: number;
	};
	failures: {
		definition: string;
		disposition: 'transient' | 'permanent';
	}[];
	activities: {
		definition: {
			kind: 'activity' | 'workflow';
			id: string;
			version: string;
		};
		recovery: 'retry' | 'reconcile';
		requires: string[];
		maxAttempts: number;
		deadlineMs: number;
		retry: 'transient' | 'never';
		delay: {
			initialMs: number;
			maximumMs: number;
		};
	}[];
	workflows: {
		maximumChildren: number;
		children: {
			definition: {
				kind: 'activity' | 'workflow';
				id: string;
				version: string;
			};
			maximum: number;
		}[];
		requires: string[];
		maxContinuations?: number | undefined;
		definition: {
			kind: 'activity' | 'workflow';
			id: string;
			version: string;
		};
		maxInstructions: number;
	}[];
	successors: {
		from: {
			kind: 'activity' | 'workflow';
			id: string;
			version: string;
		};
		maximum: number;
		choices: {
			kind: 'activity' | 'workflow';
			id: string;
			version: string;
		}[];
	}[];
	finalizers: {
		roots: {
			kind: 'activity' | 'workflow';
			id: string;
			version: string;
		}[];
		activity: {
			kind: 'activity' | 'workflow';
			id: string;
			version: string;
		};
		maxAttempts: number;
		deadlineMs: number;
		retry: 'transient' | 'never';
		delay: {
			initialMs: number;
			maximumMs: number;
		};
	}[];
	retention: {
		dedupeMs: number;
		resultsMs: number;
		auditMs: number;
	};
}, unknown> = schema.define((input) => {
	const data = object(input, [
		'id',
		'version',
		'limits',
		'claims',
		'failures',
		'activities',
		'workflows',
		'successors',
		'finalizers',
		'retention',
	]);
	const limits = object(data.limits, [
		'inputBytes',
		'resultBytes',
		'historyBytes',
		'pendingRoots',
		'reservedSuccessors',
		'pendingChildren',
		'pendingFinalizers',
	]);
	const claims = object(data.claims, ['leaseMs', 'renewEveryMs', 'recoverEveryMs']);
	const leaseMs = integer(claims.leaseMs, 100, 600_000), renewEveryMs = integer(claims.renewEveryMs, 10);
	if (renewEveryMs * 2 >= leaseMs) schema.reject('Renewal must leave room before claim expiry.');
	const retention = object(data.retention, ['dedupeMs', 'resultsMs', 'auditMs']);
	const policy = {
		id: text(data.id, 1, 256),
		version: text(data.version, 1, 128),
		limits: {
			/** Maximum bytes of one encoded input. Store large sources elsewhere and pass their references. */
			inputBytes: integer(limits.inputBytes, 1, 16_777_216),
			/** Maximum bytes of one encoded result. */
			resultBytes: integer(limits.resultBytes, 1, 16_777_216),
			/** Total bytes for requested steps and outcomes. Overflow blocks further progress. */
			historyBytes: integer(limits.historyBytes, 1, 268_435_456),
			/** Maximum externally accepted commands that still hold completion obligations. */
			pendingRoots: integer(limits.pendingRoots, 1, 1_000_000),
			/** Capacity reserved for promised follow-up runs. */
			reservedSuccessors: integer(limits.reservedSuccessors, 0, 1_000_000),
			/** Capacity reserved for promised child workflows. */
			pendingChildren: integer(limits.pendingChildren, 0, 1_000_000),
			/** Capacity reserved for exit-recording activities. */
			pendingFinalizers: integer(limits.pendingFinalizers, 0, 1_000_000),
		},
		claims: {
			/** Milliseconds an attempt retains permission without renewal. */
			leaseMs,
			/** Milliseconds between renewals. Leave room for database and event-loop delays. */
			renewEveryMs,
			/** Milliseconds between bounded recovery scans. */
			recoverEveryMs: integer(claims.recoverEveryMs, 10, 60_000),
		},
		failures: list(data.failures === undefined ? [] : data.failures, (input) => {
			const entry = object(input, ['definition', 'disposition']);
			const id = typeof entry.definition === 'object' && entry.definition !== null
				? (entry.definition as { id: unknown }).id
				: entry.definition;
			return { definition: text(id), disposition: choice(entry.disposition, ['transient', 'permanent']) };
		}),
		activities: list(data.activities, (input) => {
			const entry = object(input, [
				'maxAttempts',
				'deadlineMs',
				'recovery',
				'retry',
				'delay',
				'requires',
				'definition',
			]);
			return { ...attempt(entry), definition: definition(entry.definition) };
		}, 1000),
		workflows: list(data.workflows, (input) => {
			const entry = object(input, [
				'definition',
				'maxInstructions',
				'maxContinuations',
				'maximumChildren',
				'children',
				'requires',
			]);
			return {
				definition: definition(entry.definition),
				maxInstructions: integer(entry.maxInstructions, 1, 100_000),
				/** Maximum additional root-chain segments. Omission disables continuation and preserves existing policy identity. */
				...(entry.maxContinuations === undefined ? {} : { maxContinuations: integer(entry.maxContinuations, 0, 1000) }),
				maximumChildren: integer(entry.maximumChildren === undefined ? 0 : entry.maximumChildren, 0, 1000),
				children: list(entry.children === undefined ? [] : entry.children, (input) => {
					const child = object(input, ['definition', 'maximum']);
					return { definition: definition(child.definition), maximum: integer(child.maximum, 1, 1000) };
				}),
				requires: list(entry.requires, (input) => text(input), 32),
			};
		}, 1000),
		successors: list(data.successors, (input) => {
			const entry = object(input, ['from', 'maximum', 'choices']);
			return {
				from: definition(entry.from),
				maximum: integer(entry.maximum, 1, 1000),
				choices: list(entry.choices, definition, Infinity, 1),
			};
		}, 1000),
		finalizers: list(data.finalizers, (input) => {
			const entry = object(input, ['maxAttempts', 'deadlineMs', 'retry', 'delay', 'roots', 'activity']);
			return {
				...tries(entry),
				roots: list(entry.roots, definition, Infinity, 1),
				activity: definition(entry.activity),
			};
		}, 1000),
		/** Minimum preservation periods. This profile does not automatically delete these records. */
		retention: {
			dedupeMs: integer(retention.dedupeMs, 1),
			resultsMs: integer(retention.resultsMs, 1),
			auditMs: integer(retention.auditMs, 1),
		},
	};
	const seen = new Set<string>();
	for (const entry of [...policy.activities, ...policy.workflows]) {
		const key = address(entry.definition);
		if (seen.has(key)) schema.reject(`Duplicate policy definition ${key}.`);
		seen.add(key);
	}
	for (const entry of policy.activities) {
		if (entry.definition.kind !== 'activity') schema.reject('Activity policy requires an activity.');
	}
	for (const entry of policy.workflows) {
		if (entry.definition.kind !== 'workflow') schema.reject('Workflow policy requires a workflow.');
		if (entry.children.reduce((sum, child) => sum + child.maximum, 0) > entry.maximumChildren) {
			schema.reject('Child choices exceed maximumChildren.');
		}
	}
	for (const entry of policy.finalizers) {
		if (entry.activity.kind !== 'activity') schema.reject('Finalizer must be an activity.');
	}
	return policy;
});
/** Resolved JSON-safe policy stored with every admitted run. */
export type PolicyType = schema.Output<typeof PolicySchema>;
/** Persisted run phases; blocked work retains its obligations and can be repaired. */
export const StateSchema: schema.Reader<
	'failed' | 'ready' | 'advancing' | 'waiting' | 'settling' | 'blocked' | 'completed' | 'cancelled' | 'continued',
	unknown
> = schema.define((input) =>
	choice(input, [
		'ready',
		'advancing',
		'waiting',
		'settling',
		'blocked',
		'completed',
		'failed',
		'cancelled',
		'continued',
	])
);

/** Persisted admission control. Pausing does not revoke permission held by an already claimed attempt. */
export const ControlSchema: schema.Reader<{
	paused: boolean;
	revision: number;
}, unknown> = schema.define((input) => {
	const data = object(input, ['paused', 'revision']);
	if (typeof data.paused !== 'boolean') schema.reject('paused must be a boolean.');
	return { paused: data.paused, revision: integer(data.revision, 0) };
});
/** Admission state and its optimistic revision, separate from attempt recovery epochs. */
export type ControlType = schema.Output<typeof ControlSchema>;
/** An authorized operator supplies attribution and the control revision they inspected. */
export const ControlOptionsSchema: schema.Reader<{
	actor: string;
	reason: string;
	revision: number;
}, unknown> = schema
	.define((input) => {
		const data = object(input, ['actor', 'reason', 'revision']);
		const actor = text(data.actor, 1, 256), reason = text(data.reason, 1, 2048);
		if (!actor.trim() || !reason.trim()) schema.reject('Operator actor and reason cannot be blank.');
		return { actor, reason, revision: integer(data.revision, 0) };
	});
/** Audit attribution and compare-and-set revision. Applications own operator authorization. */
export type ControlOptions = schema.Output<typeof ControlOptionsSchema>;

/** Latest accepted effect for one activity job and effect ID. Old attempts cannot replace it. */
export interface ProgressType {
	/** Owning run and deterministic operation path, including child runs when requested. */
	readonly run?: ReferenceType;
	readonly operation?: string;
	/** Plain report value. The effect envelope remains available for existing consumers. */
	readonly progress?: unknown;
	readonly job: string;
	readonly attempt: number;
	readonly revision: string;
	readonly effect: EffectEncoded;
}

/** Saved status of one accepted run. Closing the observer does not change this state. */
export interface SnapshotType {
	/** Address of this saved run and its exact definition version. */
	readonly ref: ReferenceType;
	/** Decoded result added by the client after successful completion. */
	readonly value?: unknown;
	/** Latest effect reports, bounded to one per job and effect ID. */
	readonly progress?: readonly ProgressType[];
	/** More than 1000 reports matched. Query a child run to inspect a smaller subtree. */
	readonly progressTruncated?: boolean;
	/** Current state. Settling still needs its finalizer; blocked needs inspection before it can continue. */
	readonly state: schema.Output<typeof StateSchema>;
	/** Recovery revision. Manual repair increases it while preserving job IDs and external request keys. */
	readonly epoch: number;
	/** Durable admission control, when supplied by the store. Running work can still finish while paused. */
	readonly control?: ControlType;
	/** Next physical segment of a bounded continuation chain. A continued segment has no business result. */
	readonly continuedTo?: ReferenceType;
	/** Intended result or failure, kept unchanged while its finalizer runs or waits for repair. */
	readonly exit?: OutcomeType;
	/** Machine-readable reason automatic progress stopped. Raw database diagnostics are not included. */
	readonly reason?: string;
}
/** Validate the transport view without choosing an HTTP framework or schema vendor. */
export const SnapshotSchema: schema.Reader<SnapshotType, unknown> = schema.define((input): SnapshotType => {
	const data = object(input, [
		'ref',
		'state',
		'epoch',
		'control',
		'continuedTo',
		'exit',
		'reason',
		'progress',
		'progressTruncated',
		'value',
	]);
	if (data.progressTruncated !== undefined && typeof data.progressTruncated !== 'boolean') {
		schema.reject('progressTruncated must be a boolean.');
	}
	const reports = data.progress === undefined ? undefined : list(data.progress, (input): ProgressType => {
		const report = object(input, ['job', 'attempt', 'revision', 'effect', 'run', 'operation', 'progress']);
		const effect = object(report.effect, ['id', 'key', 'value']);
		return {
			job: uuid(report.job),
			attempt: integer(report.attempt, 1),
			revision: text(report.revision),
			effect: { id: text(effect.id), key: text(effect.key), value: effect.value },
			...(report.run === undefined ? {} : { run: ReferenceSchema.parse(report.run) }),
			...(report.operation === undefined ? {} : { operation: text(report.operation) }),
			...(report.progress === undefined ? {} : { progress: report.progress }),
		};
	}, 1000);
	return {
		ref: ReferenceSchema.parse(data.ref),
		state: StateSchema.parse(data.state),
		epoch: integer(data.epoch, 1),
		...(data.control === undefined ? {} : { control: ControlSchema.parse(data.control) }),
		...(data.continuedTo === undefined ? {} : { continuedTo: ReferenceSchema.parse(data.continuedTo) }),
		...(data.exit === undefined ? {} : { exit: OutcomeSchema.parse(data.exit) }),
		...(data.value === undefined ? {} : { value: data.value }),
		...(data.reason === undefined ? {} : { reason: text(data.reason) }),
		...(reports === undefined ? {} : { progress: reports }),
		...(data.progressTruncated === undefined ? {} : { progressTruncated: data.progressTruncated }),
	};
});
/** Temporary permission for one attempt. The store creates it and rejects copied, expired, or replaced permission. */
export interface Claim {
	/** ID of the accepted run. Restarting a workflow advance or repairing the run keeps this ID. */
	readonly runId: string;
	/** ID of the saved job. A short workflow advance uses its run ID instead. */
	readonly jobId: string;
	/** Replacement number checked before a write or result is accepted. Older numbers cannot finish newer work. */
	readonly generation: number;
	/** Recovery revision. Manual repair increases it while preserving job IDs and external request keys. */
	readonly epoch: number;
	/** Attempt number starting at one. A try whose worker died still counts. */
	readonly sequence: number;
	/** Application-supplied ID of this worker registration. Simultaneous workers need distinct IDs. */
	readonly hostId: string;
	/** Worker replacement number. A process with the previous registration cannot publish a result. */
	readonly hostGeneration: number;
}
/** One short advance of a saved workflow. Its program rebuilds local variables from recorded step results. */
export interface ActivationType {
	/** Required saved compute boundaries inherited by nested work. */
	readonly location?: SelectionType;
	/** Optional diagnostic identity from admission. Old work can omit it. */
	readonly trace?: TraceType;
	/** Temporary permission supplied by the store for this attempt. Business authorization still belongs to the application. */
	readonly claim: Claim;
	/** Address of this saved run and its exact definition version. */
	readonly ref: ReferenceType;
	/** Checked input saved as data. Connections, functions, and resource collections do not belong here. */
	readonly input: schema.Output<typeof ValueSchema>;
	/** Copy of the accepted rules. A later deployment cannot silently change this run's retry limits. */
	readonly policy: PolicyType;
}
/** An activity job taken by a currently registered worker, with its saved input and attempt rules. */
export interface JobType extends ActivationType {
	/** Saved operation path. Stores that omit this cannot supply remote attempt provenance. */
	readonly path?: string;
	/** Fingerprint of the saved instruction, or admission for a standalone activity. */
	readonly fingerprint?: string;
	/** Pinned definition kind, ID and version used for exact binding. */
	readonly definition: IdentityType;
	/** Saved attempt limits and crash response for this activity. */
	readonly attempt: AttemptType;
}
/** Worker registration. A replacement changes its generation so the previous worker cannot publish. */
export interface HostType {
	/** Stable host identity supplied by its application. */
	readonly id: string;
	/** Replacement number checked before a write or result is accepted. Older numbers cannot finish newer work. */
	readonly generation: number;
}
/** Saved request for a workflow step. Its digest detects changed work at the same program position. */
export interface IntentType {
	/** Required finite scalar host facts, distinct from compute ancestry. */
	readonly affinity?: EngineAffinityType;
	/** Required saved compute boundaries inherited by nested work. */
	readonly location?: SelectionType;
	/** Step position rebuilt on replay, including the key supplied by the program. */
	readonly path: string;
	/** Digest of the requested work. A changed digest at the same position blocks replay. */
	readonly fingerprint: string;
	/** Pinned definition kind, ID and version used for exact binding. */
	readonly definition?: IdentityType;
	/** Checked input saved as data. Connections, functions, and resource collections do not belong here. */
	readonly input?: schema.Output<typeof ValueSchema>;
	/** Absolute UTC due instant for a durable timer. */
	readonly due?: string;
	/** Relative delay measured once by the storage clock, then saved as an absolute deadline. */
	readonly delay?: number;
	/** Save the child run without waiting for its result. The child still has its own completion obligation. */
	readonly discard?: boolean;
	/** Choose whether parent cancellation follows the child. An independent child keeps running. */
	readonly cancellation?: 'follow-parent' | 'request' | 'independent';
	/** Saved step kind. The store does not inspect a program function to decide what this means. */
	readonly type: 'activity' | 'child-workflow' | 'sleep' | 'sleep-until' | 'wait-event' | 'control' | 'defer';
	/** Saved cleanup request, registered before the generator continues. */
	readonly cleanup?: IntentType;
	readonly event?: string;
	readonly eventKey?: string;
	/** Containing branch path. Root steps have no parent. */
	readonly parent?: string;
	/** Declared branch keys. Used to validate a saved race winner. */
	readonly branches?: readonly string[];
}
/** Data for a checked root instruction that requests a segment with fresh replay history. */
export const ContinuationSchema: schema.Reader<{
	path: string;
	fingerprint: string;
	input: {
		kind: 'undefined';
		value?: undefined;
	} | {
		kind: 'value';
		value: WorkflowDurableValue;
	};
}, unknown> = schema.define((input) => {
	const data = object(input, ['path', 'fingerprint', 'input']);
	return {
		/** Root instruction position. Nested branches cannot roll over the entire execution. */
		path: text(data.path, 1, 1024),
		/** Instruction identity checked before publishing the successor. */
		fingerprint: text(data.fingerprint, 1, 128),
		/** Same-definition input, validated and encoded by the worker before storage. */
		input: ValueSchema.parse(data.input),
	};
});
/** Persisted continuation instruction; it does not carry a successful business result. */
export type ContinuationType = schema.Output<typeof ContinuationSchema>;
/** Admission joins the caller transaction only through the store's explicit concrete bridge. */
export interface AdmissionType {
	/** Required saved compute boundaries inherited by nested work. */
	readonly location?: SelectionType;
	/** Optional diagnostic identity. It is excluded from command matching and authorization. */
	readonly trace?: TraceType;
	/** Pinned definition kind, ID and version used for exact binding. */
	readonly definition: IdentityType;
	/** Checked input saved as data. Connections, functions, and resource collections do not belong here. */
	readonly input: schema.Output<typeof ValueSchema>;
	/** Copy of the accepted rules. A later deployment cannot silently change this run's retry limits. */
	readonly policy: PolicyType;
	/** Application-authorized tenant or domain scope, included in dedupe and lookups. */
	readonly scope: string;
	/** Stable scoped command or write key; changed content under the key conflicts. */
	readonly key: string;
	/** Temporary permission supplied by the store for this attempt. Business authorization still belongs to the application. */
	readonly claim?: Claim;
}
/** Storage operations used by clients and workers. Each state change must commit as one consistent operation. */
export interface ExecutionStore extends AsyncDisposable {
	/** Namespace isolation boundary included in every storage lookup. */
	readonly namespace: string;
	/** Storage guarantees checked when accepting work and starting a worker. */
	readonly capabilities: readonly string[];
	/** Subscribe before scanning. Notifications are hints; recovery must also work without them. */
	subscribe?(notify: () => void): Promise<() => Promise<void>>;
	/** Milliseconds until queued work or a saved deadline needs attention, measured by the database clock. Supply definitions with available worker capacity. */
	next?(options?: {
		readonly workflows?: readonly IdentityType[];
		readonly activities: readonly IdentityType[];
		readonly finalizers: readonly IdentityType[];
	}): Promise<number | undefined>;
	/** Save progress only while this exact attempt still owns the job. */
	report?(claim: Claim, effect: EffectEncoded, sequence: number): Promise<void>;
	/** Save one event for a run, including delivery before the wait is installed. */
	send?(ref: ReferenceType, event: string, key: string, value: schema.Output<typeof ValueSchema>): Promise<void>;
	/** Save the command and first job together, returning an existing matching command when appropriate. */
	accept(input: AdmissionType, tx?: unknown): Promise<ReferenceType>;
	/** Read saved state without taking a job or changing its owner. */
	get(ref: ReferenceType, options?: { readonly children?: boolean }): Promise<SnapshotType>;
	/** Stop new ordinary claims for this run. Active claims, cleanup, cancellation, and saved event delivery can settle. */
	pause?(ref: ReferenceType, options: ControlOptions): Promise<ControlType>;
	/** Permit new claims after a revision-checked operator decision. This does not repair blocked work. */
	resume?(ref: ReferenceType, options: ControlOptions): Promise<ControlType>;
	/** Request cancellation of unfinished work. Return too_late if the run already has an intended exit. */
	cancel(ref: ReferenceType, reason: string): Promise<'requested' | 'too_late'>;
	/** Record the operator and reason, invalidate prior attempt permission, and grant a bounded number of extra tries. */
	repair(
		ref: ReferenceType,
		options: { readonly actor: string; readonly reason: string; readonly epoch: number; readonly attempts: number },
	): Promise<void>;
	/** Check the schema and database connection. A client can accept work while all workers are offline. */
	check(signal?: AbortSignal): Promise<void>;
	/** Register this worker's code versions, engine, and capacity without creating application resources. */
	register(
		id: string,
		definitions: readonly IdentityType[],
		engine: string,
		capacity: { readonly activations: number; readonly activities: number },
		leaseMs: number,
		placement?: { readonly compute?: ComputeType; readonly affinity?: EngineAffinityType },
	): Promise<HostType>;
	/** Extend a still-live matching registration; an expired generation cannot be revived. */
	renewHost(host: HostType, leaseMs: number): Promise<void>;
	/** Mark this matching registration as drained after its local work has settled. */
	leave(host: HostType): Promise<void>;
	/** Take permission to advance one matching workflow without exceeding worker capacity. */
	activate(host: HostType, definitions: readonly IdentityType[]): Promise<ActivationType | undefined>;
	/** Take one eligible queued activity and save its started attempt in the same transaction. */
	take(host: HostType, definitions: readonly IdentityType[], finalizer?: boolean): Promise<JobType | undefined>;
	/** Renew current attempt permission up to its fixed deadline. Renewal does not mean the business work advanced. */
	renew(claim: Claim): Promise<void>;
	/** Compare replay identity or atomically admit one job/child/timer and its waiting condition. */
	instruction(
		activation: ActivationType,
		intent: IntentType,
		options?: { readonly park: boolean },
	): Promise<OutcomeType | undefined>;
	/** Release this replay slot after saving every currently runnable branch. Recheck completions under the run lock. */
	park?(activation: ActivationType, pending: readonly string[]): Promise<void>;
	/** Close one branch's saved cleanup scope. False means cleanup work is still pending. */
	cleanupScope?(activation: ActivationType, parent: string): Promise<boolean>;
	/** Reject a completed branch whose recorded instruction count changed during replay. */
	verify?(activation: ActivationType, parent: string, instructions: number): Promise<void>;
	/** Save the first observed race winner and revoke losing queued attempts in the same transaction. */
	choose?(activation: ActivationType, path: string, key: string): Promise<string>;
	/** Propose an immutable exit after verifying the complete recorded instruction count. */
	finish(activation: ActivationType, outcome: OutcomeType, instructions: number): Promise<void>;
	/** Persist a bounded root-chain rollover. Registered durable cleanup must finish before the next segment is visible. */
	continue?(activation: ActivationType, intent: ContinuationType, instructions: number): Promise<void>;
	/** Block a workflow advance that cannot safely continue. Keep its saved evidence available for inspection. */
	block(activation: ActivationType, reason: string): Promise<void>;
	/** Accept the current attempt's result and save the next action: continue, retry later, or block for inspection. */
	complete(job: JobType, outcome: OutcomeType, disposition: 'transient' | 'permanent' | 'unknown'): Promise<void>;
	/** Find interrupted attempts and due waits in bounded groups. Recovery must work without notifications. */
	recover(limit: number): Promise<void>;
}
/** Local provider invocation. The activity package owns validation, requirements, resource access, and joined cleanup. */
export interface InvocationType {
	/** Exact saved job constraints, including physical pool host; pass through provider bridges without dropping them. */
	readonly location?: SelectionType;
	/** Real saved workflow and operation identity for remote diagnostics. */
	readonly origin?: import('./types.ts').ActivityOriginType;
	/** Borrowed cancellation and cleanup parent for this single invocation. */
	readonly ctx: Context;
	/** Explicit local engine; placement never infers a subprocess or remote transport. */
	readonly engine: { readonly kind: 'activity-engine'; readonly id: string };
	/** Borrowed resource collection; the application joins the host before closing it. */
	readonly resources: ResourceCollection;
	/** Checked input saved as data. Connections, functions, and resource collections do not belong here. */
	readonly input: unknown;
	/** ID of the saved job. A short workflow advance uses its run ID instead. */
	readonly jobId: string;
	/** Number of this invocation, starting at one. Previous crashed invocations still count. */
	readonly attempt: number;
	/** Temporary permission supplied by the store for this attempt. Business authorization still belongs to the application. */
	readonly claim: Claim;
	/** Explicit effect recipient selected by the worker. */
	readonly effect?: EffectEmitter;
	/** Renew the durable attempt after a provider heartbeat. */
	readonly heartbeat?: () => Promise<void>;
}
/** Structural provider contract avoids a dependency cycle from workflow back to activity. */
export interface LocalActivity {
	/** Pinned definition kind, ID and version used for exact binding. */
	readonly definition: ActivityReference & {
		readonly resources: readonly ResourceDefinition[];
		readonly effects: readonly EffectDefinition[];
	};
	/** Validate and run one attempt through the activity package's joined resource and cleanup lifecycle. */
	invoke(options: InvocationType): Promise<unknown>;
}
/** Stable runtime rejection, suitable for operator tooling without parsing diagnostic text. */
export class ExecutionError extends Error {
	/** Code that identifies a conflict, invalid attempt permission, capacity limit, or lifetime error. */
	readonly code: string;
	/** Create a durable runtime error without exposing raw database diagnostics. */
	constructor(code: string, message = code) {
		super(message);
		this.name = 'ExecutionError';
		this.code = code;
	}
}
/** Canonical value fingerprint version 1. Existing durable value rules supply sorted keys and safe snapshots. */
export async function fingerprint(input: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(value(input, 'execution identity')));
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	return `1:${Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
/** Encode and bound durable values before allocating database work. */
export function encode(input: unknown, maximum: number): schema.Output<typeof ValueSchema> {
	const encoded = value(input, 'execution value');
	if (new TextEncoder().encode(JSON.stringify(encoded)).byteLength > maximum) throw new ExecutionError('payload_limit');
	ValueSchema.parse(encoded);
	return encoded as schema.Output<typeof ValueSchema>;
}
/** Restore a validated stored value. */
export function decode(input: schema.Output<typeof ValueSchema>): unknown {
	ValueSchema.parse(input);
	return restore(input);
}
/** Snapshot a validated policy so caller mutation cannot change accepted behavior. */
export function policy(input: PolicyType): PolicyType {
	return PolicySchema.parse(snapshot(input, 'policy'));
}
