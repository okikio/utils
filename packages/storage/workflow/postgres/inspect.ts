/**
 * Inspect saved execution metadata through a borrowed pool. Reads never claim, renew, recover, or
 * migrate work. @module
 */
import type { Sql, TransactionSql } from 'postgres';
import * as record from '@okikio/collection/record';
import * as schema from '@okikio/schema';
import { temporal } from '@okikio/duration/temporal';
import {
	ControlSchema,
	ExecutionError,
	IdentitySchema,
	ReferenceSchema,
	StateSchema,
} from '@okikio/workflow/execution';
import type { ReferenceType } from '@okikio/workflow/execution';

/**

 * Fixed inspection records reject unknown fields so new payloads cannot accidentally enter operator

 * responses.

 */
function object(input: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
	if (!record.is(input)) schema.reject('Inspection data must be an inert record.');
	if (Object.keys(input).some((key) => !keys.includes(key))) schema.reject('Unknown inspection field.');
	return input;
}
/** Wire text is never coerced from credentials, objects, or other arbitrary values. */
function text(input: unknown, maximum = Infinity, minimum = 1): string {
	if (typeof input !== 'string' || input.length < minimum || input.length > maximum) {
		schema.reject('Invalid inspection text.');
	}
	return input;
}
/**
 * Preserve identifiers already accepted by storage, including legacy lengths and exact cursor ordering
 * keys.
 */
function storedText(input: unknown): string {
	return text(input, Infinity, 0);
}
/** Counts fail explicitly outside JavaScript's exact integer range. */
function integer(input: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
	if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0 || input > maximum) {
		schema.reject('Invalid inspection count.');
	}
	return input;
}
/** Only explicit booleans belong in the serialized contract. */
function boolean(input: unknown): boolean {
	if (typeof input !== 'boolean') schema.reject('Invalid inspection boolean.');
	return input;
}
/** Nullable metadata stays explicit after JSON serialization. */
function nullable<Value>(input: unknown, read: (value: unknown) => Value): Value | null {
	return input === null ? null : read(input);
}
/** Read one closed vocabulary without silently accepting a future incompatible state. */
function choice<const Choices extends readonly string[]>(input: unknown, choices: Choices): Choices[number] {
	if (typeof input !== 'string' || !choices.includes(input)) schema.reject('Invalid inspection choice.');
	return input;
}
/** UUIDs use the same validation and normalization as execution references. */
function uuid(input: unknown): string {
	return ReferenceSchema.parse({
		id: input,
		namespace: 'inspection',
		scope: 'inspection',
		definition: { kind: 'workflow', id: 'inspection', version: '1' },
	}).id.toLowerCase();
}
/**
 * Validate a saved UTC timestamp without rewriting its database precision.
 * Inspection accepts exactly milliseconds or microseconds because queue cursor
 * ordering depends on that text. The lexical guard owns this wire format;
 * Temporal rejects impossible calendar dates without normalizing them forward.
 */
function timestamp(input: unknown): string {
	const result = text(input, 32);
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d\.\d{3}(?:\d{3})?Z$/.test(result)) {
		schema.reject('Invalid inspection timestamp.');
	}
	try {
		temporal.Instant.from(result);
	} catch {
		schema.reject('Invalid inspection timestamp.');
	}
	return result;
}
/** Convert driver dates after SQL reads; public schemas accept serialized strings. */
function date(input: unknown): string | null {
	if (input === null) return null;
	return timestamp(input instanceof Date ? input.toISOString() : input);
}
/** PostgreSQL bigint sequences remain decimal strings; Number would lose cursor precision. */
function sequence(input: unknown): string {
	const value = text(input, 19);
	if (!/^[1-9]\d*$/.test(value) || BigInt(value) > 9_223_372_036_854_775_807n) {
		schema.reject('Invalid history sequence.');
	}
	return value;
}
/** Convert PostgreSQL aggregate strings and check exactness before returning public metadata. */
function count(input: unknown): number {
	if (typeof input !== 'string' && typeof input !== 'number') schema.reject('Invalid database count.');
	if (typeof input === 'string' && !/^\d+$/.test(input)) schema.reject('Invalid database count.');
	return integer(Number(input));
}
/** Every public list has the same hard row bound, independently of database size. */
function items<Value>(input: unknown, read: (value: unknown) => Value): Value[] {
	if (!Array.isArray(input) || input.length > 100) schema.reject('Invalid inspection page.');
	return input.map(read);
}
/** Result kinds disclose completion status without returning saved values or exception messages. */
function outcome(input: unknown): 'success' | 'failure' | 'fault' | 'cancelled' | null {
	return nullable(input, (value) => choice(value, ['success', 'failure', 'fault', 'cancelled']));
}

/**

 * Independent page size, 25 by default and at most 100. A cursor is bound to its method, reference,

 * and filters.

 */
export const InspectionOptionsSchema: schema.Reader<{ after?: string | undefined; limit: number }, unknown> = schema
	.define((input) => {
		const data = object(input, ['limit', 'after']);
		const limit = data.limit === undefined ? 25 : integer(data.limit, 100);
		if (limit === 0) schema.reject('Inspection limit must be 1..100.');
		return { limit, ...(data.after === undefined ? {} : { after: text(data.after) }) };
	});
/** Callers may omit the default page size and initial cursor. */
export type InspectionOptions = Partial<schema.Output<typeof InspectionOptionsSchema>>;

/** Safe run metadata, including durable operator control and continuation-chain membership. */
export const InspectedRunSchema: schema.Reader<
	{
		ref: {
			id: string;
			namespace: string;
			scope: string;
			definition: { kind: 'activity' | 'workflow'; id: string; version: string };
		};
		state:
			| 'failed'
			| 'ready'
			| 'advancing'
			| 'waiting'
			| 'settling'
			| 'blocked'
			| 'completed'
			| 'cancelled'
			| 'continued';
		control: { paused: boolean; revision: number };
		epoch: number;
		generation: number;
		family: string;
		parent: string | null;
		chain: { root: string; index: number; continuedTo: string | null };
		createdAt: string;
		updatedAt: string;
		finishedAt: string | null;
		leaseUntil: string | null;
		host: string | null;
		hostGeneration: number | null;
		outcomeType: 'cancelled' | 'success' | 'failure' | 'fault' | null;
		hasReason: boolean;
		policy: { id: string; version: string };
	},
	unknown
> = schema.define((input) => {
	const data = object(input, [
		'ref',
		'state',
		'control',
		'epoch',
		'generation',
		'family',
		'parent',
		'chain',
		'createdAt',
		'updatedAt',
		'finishedAt',
		'leaseUntil',
		'host',
		'hostGeneration',
		'outcomeType',
		'hasReason',
		'policy',
	]);
	const chain = object(data.chain, ['root', 'index', 'continuedTo']);
	const policy = object(data.policy, ['id', 'version']);
	return {
		ref: ReferenceSchema.parse(data.ref),
		state: StateSchema.parse(data.state),
		control: ControlSchema.parse(data.control),
		epoch: integer(data.epoch),
		generation: integer(data.generation),
		family: uuid(data.family),
		parent: nullable(data.parent, uuid),
		chain: { root: uuid(chain.root), index: integer(chain.index), continuedTo: nullable(chain.continuedTo, uuid) },
		createdAt: timestamp(data.createdAt),
		updatedAt: timestamp(data.updatedAt),
		finishedAt: nullable(data.finishedAt, timestamp),
		leaseUntil: nullable(data.leaseUntil, timestamp),
		host: nullable(data.host, storedText),
		hostGeneration: nullable(data.hostGeneration, integer),
		outcomeType: outcome(data.outcomeType),
		hasReason: boolean(data.hasReason),
		policy: { id: text(policy.id, 256), version: text(policy.version, 128) },
	};
});
/** A run summary contains no admission input, result, policy body, trace baggage, or free-form error. */
export type InspectedRun = schema.Output<typeof InspectedRunSchema>;

/** Saved activity metadata. A ready job is not necessarily dispatchable on a particular host. */
export const InspectedJobSchema: schema.Reader<{
	id: string;
	operation: string;
	definition: {
		kind: 'activity' | 'workflow';
		id: string;
		version: string;
	};
	state: 'failed' | 'ready' | 'blocked' | 'completed' | 'claimed';
	finalizer: boolean;
	generation: number;
	attempt: number;
	attemptBudget: number;
	availableAt: string;
	deadlineAt: string | null;
	leaseUntil: string | null;
	host: string | null;
	hostGeneration: number | null;
	outcomeType: 'cancelled' | 'success' | 'failure' | 'fault' | null;
}, unknown> = schema.define((input) => {
	const data = object(input, [
		'id',
		'operation',
		'definition',
		'state',
		'finalizer',
		'generation',
		'attempt',
		'attemptBudget',
		'availableAt',
		'deadlineAt',
		'leaseUntil',
		'host',
		'hostGeneration',
		'outcomeType',
	]);
	return {
		id: uuid(data.id),
		operation: storedText(data.operation),
		definition: IdentitySchema.parse(data.definition),
		state: choice(data.state, ['ready', 'claimed', 'completed', 'failed', 'blocked']),
		finalizer: boolean(data.finalizer),
		generation: integer(data.generation),
		attempt: integer(data.attempt),
		attemptBudget: integer(data.attemptBudget),
		availableAt: timestamp(data.availableAt),
		deadlineAt: nullable(data.deadlineAt, timestamp),
		leaseUntil: nullable(data.leaseUntil, timestamp),
		host: nullable(data.host, storedText),
		hostGeneration: nullable(data.hostGeneration, integer),
		outcomeType: outcome(data.outcomeType),
	};
});
/**
 * Metadata totals cover the entire run, independently of the jobs page. History bytes exclude replay
 * payloads.
 */
export const InspectionSchema: schema.Reader<{
	observedAt: string;
	run: InspectedRun;
	totals: {
		jobs: number;
		readyJobs: number;
		claimedJobs: number;
		waitingInstructions: number;
		attempts: number;
		progress: number;
		historyEvents: number;
		historyBytes: number;
	};
	jobs: schema.Output<typeof InspectedJobSchema>[];
	next: string | null;
}, unknown> = schema.define((input) => {
	const data = object(input, ['observedAt', 'run', 'totals', 'jobs', 'next']);
	const totals = object(data.totals, [
		'jobs',
		'readyJobs',
		'claimedJobs',
		'waitingInstructions',
		'attempts',
		'progress',
		'historyEvents',
		'historyBytes',
	]);
	return {
		observedAt: timestamp(data.observedAt),
		run: InspectedRunSchema.parse(data.run),
		totals: {
			jobs: integer(totals.jobs),
			readyJobs: integer(totals.readyJobs),
			claimedJobs: integer(totals.claimedJobs),
			waitingInstructions: integer(totals.waitingInstructions),
			attempts: integer(totals.attempts),
			progress: integer(totals.progress),
			historyEvents: integer(totals.historyEvents),
			historyBytes: integer(totals.historyBytes),
		},
		jobs: items(data.jobs, InspectedJobSchema.parse),
		next: nullable(data.next, text),
	};
});
/** One consistent run snapshot plus a bounded page of jobs. */
export type Inspection = schema.Output<typeof InspectionSchema>;

/**
 * Persisted attempt times and disposition, with no saved result or exception body.
 * elapsedMs measures from startedAt to endedAt, or to observedAt while unfinished, rounded down to milliseconds.
 * An abandoned attempt can remain without an endedAt in historical records; its elapsed time is then an upper bound.
 */
export const AttemptsSchema: schema.Reader<{
	observedAt: string;
	items: {
		job: string;
		operation: string;
		generation: number;
		attempt: number;
		state: 'cancelled' | 'success' | 'failure' | 'fault' | 'started' | 'abandoned';
		startedAt: string;
		endedAt: string | null;
		elapsedMs: number;
		outcomeType: 'cancelled' | 'success' | 'failure' | 'fault' | null;
	}[];
	next: string | null;
}, unknown> = schema.define((input) => {
	const data = object(input, ['observedAt', 'items', 'next']);
	return {
		observedAt: timestamp(data.observedAt),
		items: items(data.items, (input) => {
			const row = object(input, [
				'job',
				'operation',
				'generation',
				'attempt',
				'state',
				'startedAt',
				'endedAt',
				'elapsedMs',
				'outcomeType',
			]);
			return {
				job: uuid(row.job),
				operation: storedText(row.operation),
				generation: integer(row.generation),
				attempt: integer(row.attempt),
				state: choice(row.state, ['started', 'success', 'failure', 'fault', 'cancelled', 'abandoned']),
				startedAt: timestamp(row.startedAt),
				endedAt: nullable(row.endedAt, timestamp),
				elapsedMs: integer(row.elapsedMs),
				outcomeType: outcome(row.outcomeType),
			};
		}),
		next: nullable(data.next, text),
	};
});
/** Attempts are ordered by job ID and generation, not by wall-clock start time. */
export type InspectedAttempts = schema.Output<typeof AttemptsSchema>;

/** Saved durable waits. Event values and event correlation keys are deliberately omitted. */
export const WaitsSchema: schema.Reader<{
	observedAt: string;
	items: {
		operation: string;
		type: 'sleep' | 'sleep-until' | 'wait-event' | 'child-workflow';
		dueAt: string | null;
		child: string | null;
		event: string | null;
		resolved: boolean;
		outcomeType: 'cancelled' | 'success' | 'failure' | 'fault' | null;
	}[];
	next: string | null;
}, unknown> = schema.define((input) => {
	const data = object(input, ['observedAt', 'items', 'next']);
	return {
		observedAt: timestamp(data.observedAt),
		items: items(data.items, (input) => {
			const row = object(input, ['operation', 'type', 'dueAt', 'child', 'event', 'resolved', 'outcomeType']);
			return {
				operation: storedText(row.operation),
				type: choice(row.type, ['sleep', 'sleep-until', 'wait-event', 'child-workflow']),
				dueAt: nullable(row.dueAt, timestamp),
				child: nullable(row.child, uuid),
				event: nullable(row.event, storedText),
				resolved: boolean(row.resolved),
				outcomeType: outcome(row.outcomeType),
			};
		}),
		next: nullable(data.next, text),
	};
});
/** Saved wait state includes resolved waits until the run's retained data is pruned. */
export type InspectedWaits = schema.Output<typeof WaitsSchema>;

/** Latest accepted progress metadata per job and effect. This is not a replayable progress event stream. */
export const ProgressSchema: schema.Reader<{
	observedAt: string;
	items: {
		job: string;
		operation: string;
		effect: string;
		generation: number;
		attempt: number;
		sequence: number;
		revision: string;
		reportedAt: string;
		bytes: number;
	}[];
	next: string | null;
}, unknown> = schema.define((input) => {
	const data = object(input, ['observedAt', 'items', 'next']);
	return {
		observedAt: timestamp(data.observedAt),
		items: items(data.items, (input) => {
			const row = object(input, [
				'job',
				'operation',
				'effect',
				'generation',
				'attempt',
				'sequence',
				'revision',
				'reportedAt',
				'bytes',
			]);
			return {
				job: uuid(row.job),
				operation: storedText(row.operation),
				effect: storedText(row.effect),
				generation: integer(row.generation),
				attempt: integer(row.attempt),
				sequence: integer(row.sequence),
				revision: uuid(row.revision),
				reportedAt: timestamp(row.reportedAt),
				bytes: integer(row.bytes),
			};
		}),
		next: nullable(data.next, text),
	};
});
/**
 * Times and revision identities let an operator measure freshness without reading application progress
 * payloads.
 */
export type InspectedProgress = schema.Output<typeof ProgressSchema>;

/**
 * Durable lifecycle transitions. Sequences are commit ordered within one run under the adapter's owning-run lock.
 * availableFrom and through describe the retained sequence range at observedAt. bytes sums stored event-row sizes,
 * excluding indexes and replay payloads. hasMore means this snapshot has another page; next is also a durable tail
 * cursor when hasMore is false. Migration baselines do not assert that earlier transitions were recorded.
 */
export const HistorySchema: schema.Reader<{
	observedAt: string;
	coverage: 'empty' | 'created' | 'migration' | 'retained';
	availableFrom: string | null;
	through: string | null;
	events: number;
	bytes: number;
	hasGaps: boolean;
	hasMore: boolean;
	items: {
		sequence: string;
		recordedAt: string;
		kind: 'run' | 'job' | 'baseline' | 'operator';
		job: string | null;
		priorState:
			| 'failed'
			| 'ready'
			| 'advancing'
			| 'waiting'
			| 'settling'
			| 'blocked'
			| 'completed'
			| 'cancelled'
			| 'continued'
			| 'claimed'
			| null;
		state:
			| 'failed'
			| 'ready'
			| 'advancing'
			| 'waiting'
			| 'settling'
			| 'blocked'
			| 'completed'
			| 'cancelled'
			| 'continued'
			| 'claimed';
		control: {
			paused: boolean;
			revision: number;
		};
		epoch: number;
		action: string | null;
		actor: string | null;
		hasReason: boolean;
	}[];
	next: string | null;
}, unknown> = schema.define((input) => {
	const data = object(input, [
		'observedAt',
		'coverage',
		'availableFrom',
		'through',
		'events',
		'bytes',
		'hasGaps',
		'hasMore',
		'items',
		'next',
	]);
	return {
		observedAt: timestamp(data.observedAt),
		coverage: choice(data.coverage, ['created', 'migration', 'retained', 'empty']),
		availableFrom: nullable(data.availableFrom, sequence),
		through: nullable(data.through, sequence),
		events: integer(data.events),
		bytes: integer(data.bytes),
		hasGaps: boolean(data.hasGaps),
		hasMore: boolean(data.hasMore),
		items: items(data.items, (input) => {
			const row = object(input, [
				'sequence',
				'recordedAt',
				'kind',
				'job',
				'priorState',
				'state',
				'control',
				'epoch',
				'action',
				'actor',
				'hasReason',
			]);
			const kind = choice(row.kind, ['baseline', 'run', 'job', 'operator']);
			const state = (input: unknown) =>
				kind === 'job'
					? choice(input, ['ready', 'claimed', 'completed', 'failed', 'blocked'])
					: StateSchema.parse(input);
			return {
				sequence: sequence(row.sequence),
				recordedAt: timestamp(row.recordedAt),
				kind,
				job: nullable(row.job, uuid),
				priorState: nullable(row.priorState, state),
				state: state(row.state),
				control: ControlSchema.parse(row.control),
				epoch: integer(row.epoch),
				action: nullable(row.action, storedText),
				actor: nullable(row.actor, storedText),
				hasReason: boolean(row.hasReason),
			};
		}),
		next: nullable(data.next, text),
	};
});
/** Lifecycle metadata has its own storage cost; it is not charged to the replay historyBytes policy limit. */
export type InspectedHistory = schema.Output<typeof HistorySchema>;

/** Scope is mandatory. The application must authorize it before calling the inspector. */
export const QueueOptionsSchema: schema.Reader<{
	after?: string | undefined;
	limit: number;
	scope: string;
	states:
		('failed' | 'ready' | 'advancing' | 'waiting' | 'settling' | 'blocked' | 'completed' | 'cancelled' | 'continued')[];
}, unknown> = schema.define((input) => {
	const data = object(input, ['scope', 'states', 'limit', 'after']);
	const states = data.states === undefined ? ['ready', 'advancing', 'waiting', 'settling', 'blocked'] : data.states;
	if (!Array.isArray(states) || states.length < 1 || states.length > 9) {
		schema.reject('Expected 1..9 queue states.');
	}
	return {
		scope: text(data.scope, 256),
		states: [...new Set(states.map(StateSchema.parse))].sort(),
		...InspectionOptionsSchema.parse({
			...(data.limit === undefined ? {} : { limit: data.limit }),
			...(data.after === undefined ? {} : { after: data.after }),
		}),
	};
});
/** Omitted states select unfinished runs; pages are ordered by acceptance time and ID. */
export type QueueOptions =
	& Pick<schema.Output<typeof QueueOptionsSchema>, 'scope'>
	& Partial<Omit<schema.Output<typeof QueueOptionsSchema>, 'scope'>>;
/**
 * Counts describe the selected scope and states. dueJobs means time-due, not placement- or capacity-admitted.
 * oldestRunAt is the earliest acceptance time among selected runs. oldestDueAt is the earliest availability time
 * among their ready, time-due jobs; paused runs remain in these counts. Subtract either from observedAt for age.
 */
export const QueueSchema: schema.Reader<{
	observedAt: string;
	scope: string;
	totals: {
		runs: number;
		paused: number;
		dueJobs: number;
		oldestRunAt: string | null;
		oldestDueAt: string | null;
	};
	items: InspectedRun[];
	next: string | null;
}, unknown> = schema.define((input) => {
	const data = object(input, ['observedAt', 'scope', 'totals', 'items', 'next']);
	const totals = object(data.totals, ['runs', 'paused', 'dueJobs', 'oldestRunAt', 'oldestDueAt']);
	return {
		observedAt: timestamp(data.observedAt),
		scope: text(data.scope, 256),
		totals: {
			runs: integer(totals.runs),
			paused: integer(totals.paused),
			dueJobs: integer(totals.dueJobs),
			oldestRunAt: nullable(totals.oldestRunAt, timestamp),
			oldestDueAt: nullable(totals.oldestDueAt, timestamp),
		},
		items: items(data.items, InspectedRunSchema.parse),
		next: nullable(data.next, text),
	};
});
/** Queue ages can be derived from observedAt minus the explicit oldest timestamps. */
export type InspectedQueue = schema.Output<typeof QueueSchema>;

/**
 * Namespace-wide host capacity. Applications should expose this only to namespace operators.
 * Each limit is registered capacity; active counts unexpired claims for the current host generation.
 * expired counts claims awaiting recovery. free subtracts active claims from the limit and is zero when draining
 * or expired. These are database admission counts, not measured threads, CPU availability, or placement guarantees.
 */
export const HostsSchema: schema.Reader<{
	observedAt: string;
	items: {
		id: string;
		generation: number;
		engine: string;
		definitions: number;
		draining: boolean;
		live: boolean;
		leaseUntil: string;
		activations: {
			limit: number;
			active: number;
			free: number;
			expired: number;
		};
		activities: {
			limit: number;
			active: number;
			free: number;
			expired: number;
		};
	}[];
	next: string | null;
}, unknown> = schema.define((input) => {
	const data = object(input, ['observedAt', 'items', 'next']);
	return {
		observedAt: timestamp(data.observedAt),
		items: items(data.items, (input) => {
			const row = object(input, [
				'id',
				'generation',
				'engine',
				'definitions',
				'draining',
				'live',
				'leaseUntil',
				'activations',
				'activities',
			]);
			const capacity = (input: unknown) => {
				const data = object(input, ['limit', 'active', 'free', 'expired']);
				return {
					limit: integer(data.limit),
					active: integer(data.active),
					free: integer(data.free),
					expired: integer(data.expired),
				};
			};
			return {
				id: storedText(row.id),
				generation: integer(row.generation),
				engine: storedText(row.engine),
				definitions: integer(row.definitions),
				draining: boolean(row.draining),
				live: boolean(row.live),
				leaseUntil: timestamp(row.leaseUntil),
				activations: capacity(row.activations),
				activities: capacity(row.activities),
			};
		}),
		next: nullable(data.next, text),
	};
});
/** Capacity counts only claims matching the host's current generation. */
export type InspectedHosts = schema.Output<typeof HostsSchema>;

/**

 * Read-only methods use one repeatable-read transaction per call. Cursors do not hold snapshots

 * across calls.

 */
export interface Inspector {
	/** Inspect one exact reference and a page of its activity jobs. */
	inspect(ref: ReferenceType, options?: InspectionOptions): Promise<Inspection>;
	/** Read attempts, optionally for one job belonging to this exact run. */
	attempts(ref: ReferenceType, options?: InspectionOptions & { readonly job?: string }): Promise<InspectedAttempts>;
	/** Read saved timer, event, and child waits, without their payloads. */
	waits(ref: ReferenceType, options?: InspectionOptions): Promise<InspectedWaits>;
	/** Read latest accepted progress metadata; use client.watch for current application progress values. */
	progress(ref: ReferenceType, options?: InspectionOptions): Promise<InspectedProgress>;
	/**
	 * Resume durable lifecycle history. A removed cursor prefix or interior hole raises
	 * inspection_history_gap.
	 */
	history(ref: ReferenceType, options?: InspectionOptions): Promise<InspectedHistory>;
	/** List a caller-authorized scope; unfinished states are the default. */
	queue(options: QueueOptions): Promise<InspectedQueue>;
	/** List namespace-level host registration and claim capacity. */
	hosts(options?: InspectionOptions): Promise<InspectedHosts>;
}

/** Cursor bindings prevent accidental cross-view or cross-tenant reuse; they are not authentication tokens. */
function cursor(
	operation: string,
	binding: string,
	after: string | undefined,
	length: number,
): readonly string[] | undefined {
	if (after === undefined) return undefined;
	try {
		const data = object(JSON.parse(after), ['version', 'operation', 'binding', 'position']);
		if (
			data.version !== 1 || data.operation !== operation || data.binding !== binding || !Array.isArray(data.position) ||
			data.position.length !== length
		) schema.reject('Cursor binding differs.');
		return data.position.map(storedText);
	} catch {
		throw new ExecutionError('inspection_cursor');
	}
}
/** A cursor remains usable after a process restart; only the supplied database owns its position. */
function next(operation: string, binding: string, position: readonly string[]): string {
	return JSON.stringify({ version: 1, operation, binding, position });
}
/** Canonical reference binding includes the whole definition, not only the UUID. */
function reference(namespace: string, input: ReferenceType): { ref: ReferenceType; binding: string } {
	const ref = ReferenceSchema.parse(input);
	if (ref.namespace !== namespace) throw new ExecutionError('inspection_reference');
	ref.id = ref.id.toLowerCase();
	return {
		ref,
		binding: JSON.stringify([
			ref.namespace,
			ref.id,
			ref.scope,
			ref.definition.kind,
			ref.definition.id,
			ref.definition.version,
		]),
	};
}
/** Select only declared metadata columns; arbitrary saved JSON never enters an operator response. */
function projection(tx: TransactionSql) {
	return tx`id,namespace,scope,kind,definition,version,state,paused,control_revision,epoch,generation,family,parent,
 chain_root,chain_index,continued_to,created,updated_at,finished_at,expires,host,host_generation,
 outcome->>'type' as outcome_type,reason is not null as has_reason,policy->>'id' as policy_id,policy->>'version' as policy_version,
 to_char(created at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_cursor`;
}
/** SQL rows are untrusted driver data; the published schema validates their serialized projection. */
function run(row: Record<string, unknown>): InspectedRun {
	return InspectedRunSchema.parse({
		ref: {
			id: row.id,
			namespace: row.namespace,
			scope: row.scope,
			definition: { kind: row.kind, id: row.definition, version: row.version },
		},
		state: row.state,
		control: { paused: row.paused, revision: row.control_revision },
		epoch: row.epoch,
		generation: row.generation,
		family: row.family,
		parent: row.parent,
		chain: { root: row.chain_root, index: row.chain_index, continuedTo: row.continued_to },
		createdAt: date(row.created),
		updatedAt: date(row.updated_at),
		finishedAt: date(row.finished_at),
		leaseUntil: date(row.expires),
		host: row.host,
		hostGeneration: row.host_generation,
		outcomeType: row.outcome_type,
		hasReason: row.has_reason,
		policy: { id: row.policy_id, version: row.policy_version },
	});
}
/** Verify the entire saved identity in the same transaction as every run-specific read. */
async function owner(tx: TransactionSql, ref: ReferenceType): Promise<InspectedRun> {
	const rows = await tx`select ${
		projection(tx)
	} from utils_workflow.runs where namespace=${ref.namespace} and id=${ref.id}
 and scope=${ref.scope} and kind=${ref.definition.kind} and definition=${ref.definition.id} and version=${ref.definition.version}`;
	if (rows.length !== 1) throw new ExecutionError('inspection_reference');
	return run(rows[0]!);
}
/** Use database time for ages and one MVCC snapshot for all counts and rows returned by a method. */
async function snapshot<Value>(
	database: Sql,
	read: (tx: TransactionSql, observedAt: string) => Promise<Value>,
): Promise<Value> {
	return await database.begin('isolation level repeatable read read only', async (tx) => {
		await tx`set local statement_timeout='5s'`;
		const rows = await tx`select transaction_timestamp() as observed_at`;
		return await read(tx, timestamp(date(rows[0]!.observed_at)));
	}) as Value;
}

/**
 * Create an inspector without opening connections, migrating, or taking ownership of the pool.
 * Authorize run references and queue scopes in the application. Each call has a five-second statement
 * timeout and at most 100 returned rows. Aggregate counts may still scan the selected run or scope.
 *
 * @example
 * ```ts
 * const operations = postgres.inspector({ database, namespace: 'imports' });
 * const current = await operations.inspect(ref);
 * const changes = await operations.history(ref, { limit: 50 });
 * // Consume pages while changes.hasMore. Persist changes.next to catch later commits after restart.
 * ```
 */
export function inspector(options: { readonly database: Sql; readonly namespace: string }): Inspector {
	const namespace = text(options.namespace, 128);
	const database = options.database;
	return {
		/**
		 * Read the run and one bounded page of its jobs from one database snapshot. Omit business payloads;
		 * this read grants no execution authority.
		 */
		async inspect(input, options = {}) {
			const { ref, binding } = reference(namespace, input), page = InspectionOptionsSchema.parse(options);
			const position = cursor('inspect', binding, page.after, 1);
			const after = position === undefined ? null : uuid(position[0]);
			return await snapshot(database, async (tx, observedAt) => {
				const current = await owner(tx, ref);
				const rows =
					await tx`select id,path,definition,state,finalizer,generation,sequence,budget,available,deadline,expires,host,host_generation,outcome->>'type' as outcome_type
 from utils_workflow.jobs where namespace=${namespace} and run=${ref.id} and (${after}::uuid is null or id>${after}::uuid) order by id limit ${
						page.limit + 1
					}`;
				const totals = (await tx`select
 (select count(*) from utils_workflow.jobs where namespace=${namespace} and run=${ref.id}) as jobs,
 (select count(*) from utils_workflow.jobs where namespace=${namespace} and run=${ref.id} and state='ready') as ready,
 (select count(*) from utils_workflow.jobs where namespace=${namespace} and run=${ref.id} and state='claimed') as claimed,
 (select count(*) from utils_workflow.instructions where namespace=${namespace} and run=${ref.id} and type in ('sleep','sleep-until','wait-event','child-workflow') and outcome is null) as waiting,
 (select count(*) from utils_workflow.attempts a join utils_workflow.jobs j on j.namespace=a.namespace and j.id=a.job where j.namespace=${namespace} and j.run=${ref.id}) as attempts,
 (select count(*) from utils_workflow.progress where namespace=${namespace} and run=${ref.id}) as progress,
 (select count(*) from utils_workflow.run_events where namespace=${namespace} and run=${ref.id}) as history_events,
 (select coalesce(sum(pg_column_size(e)),0) from utils_workflow.run_events e where namespace=${namespace} and run=${ref.id}) as history_bytes`)[
					0
				]!;
				return InspectionSchema.parse({
					observedAt,
					run: current,
					totals: {
						jobs: count(totals.jobs),
						readyJobs: count(totals.ready),
						claimedJobs: count(totals.claimed),
						waitingInstructions: count(totals.waiting),
						attempts: count(totals.attempts),
						progress: count(totals.progress),
						historyEvents: count(totals.history_events),
						historyBytes: count(totals.history_bytes),
					},
					jobs: rows.slice(0, page.limit).map((row) => ({
						id: row.id,
						operation: row.path,
						definition: row.definition,
						state: row.state,
						finalizer: row.finalizer,
						generation: row.generation,
						attempt: row.sequence,
						attemptBudget: row.budget,
						availableAt: date(row.available),
						deadlineAt: date(row.deadline),
						leaseUntil: date(row.expires),
						host: row.host,
						hostGeneration: row.host_generation,
						outcomeType: row.outcome_type,
					})),
					next: rows.length > page.limit ? next('inspect', binding, [rows[page.limit - 1]!.id]) : null,
				});
			});
		},
		/**
		 * List recorded tries in job/generation order. Each cursor stays bound to this run and optional job
		 * filter.
		 */
		async attempts(input, options = {}) {
			const checked = object(options, ['limit', 'after', 'job']);
			const page = InspectionOptionsSchema.parse({
				...(checked.limit === undefined ? {} : { limit: checked.limit }),
				...(checked.after === undefined ? {} : { after: checked.after }),
			});
			const { ref, binding: identity } = reference(namespace, input);
			const job = checked.job === undefined ? null : uuid(checked.job), binding = JSON.stringify([identity, job]);
			const position = cursor('attempts', binding, page.after, 2);
			const afterJob = position === undefined ? null : uuid(position[0]),
				afterGeneration = position === undefined ? 0 : integer(Number(position[1]));
			return await snapshot(database, async (tx, observedAt) => {
				await owner(tx, ref);
				if (
					job !== null &&
					(await tx`select id from utils_workflow.jobs where namespace=${namespace} and run=${ref.id} and id=${job}`)
							.length !== 1
				) throw new ExecutionError('inspection_reference');
				const rows =
					await tx`select a.job,j.path,a.generation,a.sequence,a.state,a.started,a.ended,a.outcome->>'type' as outcome_type,
 greatest(0,floor(extract(epoch from (coalesce(a.ended,transaction_timestamp())-a.started))*1000))::bigint as elapsed
 from utils_workflow.attempts a join utils_workflow.jobs j on j.namespace=a.namespace and j.id=a.job
 where j.namespace=${namespace} and j.run=${ref.id} and (${job}::uuid is null or a.job=${job}::uuid)
 and (${afterJob}::uuid is null or (a.job,a.generation)>(${afterJob}::uuid,${afterGeneration})) order by a.job,a.generation limit ${
						page.limit + 1
					}`;
				return AttemptsSchema.parse({
					observedAt,
					items: rows.slice(0, page.limit).map((row) => ({
						job: row.job,
						operation: row.path,
						generation: row.generation,
						attempt: row.sequence,
						state: row.state,
						startedAt: date(row.started),
						endedAt: date(row.ended),
						elapsedMs: count(row.elapsed),
						outcomeType: row.outcome_type,
					})),
					next: rows.length > page.limit
						? next('attempts', binding, [rows[page.limit - 1]!.job, String(rows[page.limit - 1]!.generation)])
						: null,
				});
			});
		},
		/**
		 * List saved timer, event and child waits for this run. Reading them neither wakes the workflow nor
		 * renews its permission.
		 */
		async waits(input, options = {}) {
			const { ref, binding } = reference(namespace, input), page = InspectionOptionsSchema.parse(options);
			const position = cursor('waits', binding, page.after, 1), after = position?.[0] ?? null;
			return await snapshot(database, async (tx, observedAt) => {
				await owner(tx, ref);
				const rows =
					await tx`select path,type,due,child,event,outcome is not null as resolved,outcome->>'type' as outcome_type
 from utils_workflow.instructions where namespace=${namespace} and run=${ref.id} and type in ('sleep','sleep-until','wait-event','child-workflow')
 and (${after}::text is null or path>${after}) order by path limit ${page.limit + 1}`;
				return WaitsSchema.parse({
					observedAt,
					items: rows.slice(0, page.limit).map((row) => ({
						operation: row.path,
						type: row.type,
						dueAt: date(row.due),
						child: row.child,
						event: row.event,
						resolved: row.resolved,
						outcomeType: row.outcome_type,
					})),
					next: rows.length > page.limit ? next('waits', binding, [rows[page.limit - 1]!.path]) : null,
				});
			});
		},
		/**
		 * Read progress metadata rather than payload values. A latest report does not establish that the
		 * whole run completed.
		 */
		async progress(input, options = {}) {
			const { ref, binding } = reference(namespace, input), page = InspectionOptionsSchema.parse(options);
			const position = cursor('progress', binding, page.after, 2),
				afterJob = position === undefined ? null : uuid(position[0]),
				afterEffect = position?.[1] ?? '';
			return await snapshot(database, async (tx, observedAt) => {
				await owner(tx, ref);
				const rows =
					await tx`select p.job,j.path,p.effect,p.generation,p.attempt,p.sequence,p.revision,p.reported_at,p.bytes
 from utils_workflow.progress p join utils_workflow.jobs j on j.namespace=p.namespace and j.id=p.job
 where p.namespace=${namespace} and p.run=${ref.id} and (${afterJob}::uuid is null or (p.job,p.effect)>(${afterJob}::uuid,${afterEffect})) order by p.job,p.effect limit ${
						page.limit + 1
					}`;
				return ProgressSchema.parse({
					observedAt,
					items: rows.slice(0, page.limit).map((row) => ({
						job: row.job,
						operation: row.path,
						effect: row.effect,
						generation: row.generation,
						attempt: row.attempt,
						sequence: row.sequence,
						revision: row.revision,
						reportedAt: date(row.reported_at),
						bytes: row.bytes,
					})),
					next: rows.length > page.limit
						? next('progress', binding, [rows[page.limit - 1]!.job, rows[page.limit - 1]!.effect])
						: null,
				});
			});
		},
		/**
		 * Read committed lifecycle changes after the supplied cursor. The saved sequence allows a caller to
		 * resume the timeline across polls.
		 */
		async history(input, options = {}) {
			const { ref, binding } = reference(namespace, input), page = InspectionOptionsSchema.parse(options);
			const position = cursor('history', binding, page.after, 1),
				after = position === undefined ? null : sequence(position[0]);
			return await snapshot(database, async (tx, observedAt) => {
				await owner(tx, ref);
				const totals =
					(await tx`select min(sequence)::text as first,max(sequence)::text as last,count(*) as count,coalesce(sum(pg_column_size(e)),0) as bytes
 from utils_workflow.run_events e where namespace=${namespace} and run=${ref.id}`)[0]!;
				if (after !== null && (totals.first === null || BigInt(after) < BigInt(totals.first) - 1n)) {
					throw new ExecutionError('inspection_history_gap');
				}
				if (after !== null && BigInt(after) > BigInt(totals.last)) throw new ExecutionError('inspection_cursor');
				const first =
					(await tx`select kind from utils_workflow.run_events where namespace=${namespace} and run=${ref.id} order by sequence limit 1`)[
						0
					];
				const rows =
					await tx`select sequence::text,recorded_at,kind,job_id,prior_state,state,paused,control_revision,epoch,action,actor,reason is not null as has_reason
 from utils_workflow.run_events where namespace=${namespace} and run=${ref.id} and (${after}::bigint is null or sequence>${after}::bigint) order by sequence limit ${
						page.limit + 1
					}`;
				// A cursor must not silently skip deleted lifecycle evidence. Validate
				// the lookahead row too before advertising a resumable next page.
				let expected = after === null ? (totals.first === null ? 1n : BigInt(totals.first)) : BigInt(after) + 1n;
				for (const row of rows) {
					if (BigInt(row.sequence) !== expected) throw new ExecutionError('inspection_history_gap');
					expected++;
				}
				// Return a tail cursor even at the current end. It can catch subsequent commits after restart.
				const tail = rows[Math.min(rows.length, page.limit) - 1]?.sequence ?? after;
				return HistorySchema.parse({
					observedAt,
					coverage: totals.first === null
						? 'empty'
						: totals.first !== '1'
						? 'retained'
						: first?.kind === 'baseline'
						? 'migration'
						: 'created',
					availableFrom: totals.first,
					through: totals.last,
					events: count(totals.count),
					bytes: count(totals.bytes),
					hasGaps: totals.first === null
						? false
						: BigInt(totals.count) !== BigInt(totals.last) - BigInt(totals.first) + 1n,
					hasMore: rows.length > page.limit,
					items: rows.slice(0, page.limit).map((row) => ({
						sequence: row.sequence,
						recordedAt: date(row.recorded_at),
						kind: row.kind,
						job: row.job_id,
						priorState: row.prior_state,
						state: row.state,
						control: { paused: row.paused, revision: row.control_revision },
						epoch: row.epoch,
						action: row.action,
						actor: row.actor,
						hasReason: row.has_reason,
					})),
					next: tail === null || tail === undefined ? null : next('history', binding, [tail]),
				});
			});
		},
		/**
		 * Summarize saved queue states for one authorized scope. Database rows count obligations; they are
		 * not CPU utilization measurements.
		 */
		async queue(input) {
			const page = QueueOptionsSchema.parse(input), binding = JSON.stringify([namespace, page.scope, page.states]);
			const position = cursor('queue', binding, page.after, 2),
				afterTime = position === undefined ? null : timestamp(position[0]),
				afterId = position === undefined ? null : uuid(position[1]);
			return await snapshot(database, async (tx, observedAt) => {
				// Bind as text first: Postgres.js otherwise serializes inferred timestamptz parameters through Date and drops microseconds.
				const rows = await tx`select ${projection(tx)} from utils_workflow.runs
 where namespace=${namespace} and scope=${page.scope} and state=any(${page.states}::text[])
 and (${afterTime}::text::timestamptz is null or (created,id)>(${afterTime}::text::timestamptz,${afterId}::uuid)) order by created,id limit ${
					page.limit + 1
				}`;
				const totals = (await tx`select count(*) as runs,count(*) filter(where paused) as paused,min(created) as oldest
 from utils_workflow.runs where namespace=${namespace} and scope=${page.scope} and state=any(${page.states}::text[])`)[
					0
				]!;
				const due = (await tx`select count(*) as jobs,min(j.available) as oldest from utils_workflow.jobs j
 join utils_workflow.runs r on r.namespace=j.namespace and r.id=j.run
 where r.namespace=${namespace} and r.scope=${page.scope} and r.state=any(${page.states}::text[]) and j.state='ready' and j.available<=transaction_timestamp()`)[
					0
				]!;
				return QueueSchema.parse({
					observedAt,
					scope: page.scope,
					totals: {
						runs: count(totals.runs),
						paused: count(totals.paused),
						dueJobs: count(due.jobs),
						oldestRunAt: date(totals.oldest),
						oldestDueAt: date(due.oldest),
					},
					items: rows.slice(0, page.limit).map(run),
					next: rows.length > page.limit
						? next('queue', binding, [rows[page.limit - 1]!.created_cursor, rows[page.limit - 1]!.id])
						: null,
				});
			});
		},
		/**
		 * Read registered host capacity and claim counts at one snapshot. A live registration does not prove
		 * a particular resource is still usable.
		 */
		async hosts(options = {}) {
			const page = InspectionOptionsSchema.parse(options),
				position = cursor('hosts', namespace, page.after, 1),
				after = position?.[0] ?? null;
			return await snapshot(database, async (tx, observedAt) => {
				const rows =
					await tx`select h.id,h.generation,h.engine,jsonb_array_length(h.definitions) as definitions,h.draining,h.expires,h.expires>transaction_timestamp() as live,h.activations,h.activities,
 (select count(*) from utils_workflow.runs r where r.namespace=h.namespace and r.host=h.id and r.host_generation=h.generation and r.state='advancing' and r.expires>transaction_timestamp()) as active_runs,
 (select count(*) from utils_workflow.runs r where r.namespace=h.namespace and r.host=h.id and r.host_generation=h.generation and r.state='advancing' and r.expires<=transaction_timestamp()) as expired_runs,
 (select count(*) from utils_workflow.jobs j where j.namespace=h.namespace and j.host=h.id and j.host_generation=h.generation and j.state='claimed' and j.expires>transaction_timestamp()) as active_jobs,
 (select count(*) from utils_workflow.jobs j where j.namespace=h.namespace and j.host=h.id and j.host_generation=h.generation and j.state='claimed' and j.expires<=transaction_timestamp()) as expired_jobs
 from utils_workflow.hosts h where h.namespace=${namespace} and (${after}::text is null or h.id>${after}) order by h.id limit ${
						page.limit + 1
					}`;
				return HostsSchema.parse({
					observedAt,
					items: rows.slice(0, page.limit).map((row) => ({
						id: row.id,
						generation: row.generation,
						engine: row.engine,
						definitions: row.definitions,
						draining: row.draining,
						live: row.live,
						leaseUntil: date(row.expires),
						activations: {
							limit: row.activations,
							active: count(row.active_runs),
							free: row.live && !row.draining ? Math.max(0, row.activations - count(row.active_runs)) : 0,
							expired: count(row.expired_runs),
						},
						activities: {
							limit: row.activities,
							active: count(row.active_jobs),
							free: row.live && !row.draining ? Math.max(0, row.activities - count(row.active_jobs)) : 0,
							expired: count(row.expired_jobs),
						},
					})),
					next: rows.length > page.limit ? next('hosts', namespace, [rows[page.limit - 1]!.id]) : null,
				});
			});
		},
	};
}
