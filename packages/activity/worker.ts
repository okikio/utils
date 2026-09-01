/**
 * Activity engine providers backed by standard Web Workers.
 *
 * The parent provider owns a bounded pool of Worker handles. The Workflow
 * Scheduler still owns logical jobs, attempts, retries, registration identity,
 * queue claims, and terminal settlement. Worker messages carry only
 * serializable attempt data and reverse calls for authoritative host services.
 *
 * @module
 */
import * as contexts from '@okikio/context';
import type { Context, Owned } from '@okikio/context';
import type { EffectEmitter } from '@okikio/effect';
import * as faultCore from '@okikio/fault';
import type { PermissionChecker } from '@okikio/permission';
import * as pool from '@okikio/pool';
import type { Pool } from '@okikio/pool';
import type { RequirementRuntime } from '@okikio/requirement';
import type { ResourceCollection } from '@okikio/resource';
import * as workers from '@okikio/worker';
import type { RawWorkerScope, WorkerOpenOptions, WorkerServer } from '@okikio/worker/types';
import type {
	ActivityAttemptControl,
	ActivityAttemptResultType,
	ActivityAttemptType,
	EngineProvider,
} from '@okikio/workflow';
import * as activity from './mod.ts';
import * as transport from './transport.ts';
import type { ActivityDefinition, ActivityImplementation } from './types.ts';
import type { EngineDefinition } from './engine.ts';

/** Runtime values stored for one request while reverse calls remain valid. */
interface Active {
	/** Exact activity contract associated with this in-flight Worker request. */
	readonly activity: ActivityDefinition;
	/** Fenced Scheduler attempt whose reverse calls remain valid while this request is active. */
	readonly attempt: ActivityAttemptType;
	/** Scheduler-owned controls used for heartbeats while this Worker request is active. */
	readonly control: ActivityAttemptControl;
}

/** One reusable Worker plus the active attempt correlation it owns. */
interface Host {
	/** Stable lifetime for one pooled Worker host. It outlives individual acquisitions. */
	readonly ctx: Owned;
	/** Correlated Worker transport owned for the full reusable host lifetime. */
	readonly worker: workers.WorkerHandle<ActivityAttemptType, transport.WireResultType>;
	/** Active Worker request map keyed by queue claim ID for reverse-call correlation. */
	readonly active: Map<string, Active>;
}

/** Options for one bounded Worker engine provider. */
export interface WorkerProviderOptions {
	/** Parent context that owns the Worker pool and every Worker it creates. */
	readonly ctx: Context;
	/** Exact engine definition advertised when this provider is registered. */
	readonly engine: EngineDefinition;
	/** Exact activity definitions the remote Worker can run. */
	readonly activities: readonly ActivityDefinition[];
	/** Worker module that calls `workerProvider.serve()`. */
	readonly module: URL;
	/** Maximum reusable Worker count. */
	readonly maximum: number;
	/** Minimum retained or pre-created values requested for this worker provider. */
	readonly minimum?: number;
	/** Maximum idle Worker hosts retained for reuse. */
	readonly maximumIdle?: number;
	/** Maximum duration an idle Worker host may remain retained before recycling. */
	readonly maximumIdleAge?: Temporal.Duration | Temporal.DurationLike | string;
	/** Maximum wait for one reusable Worker host before acquisition fails. */
	readonly acquireTimeout?: Temporal.Duration | Temporal.DurationLike | string;
	/** Grace period for cooperative Worker shutdown before forced termination. */
	readonly shutdownMs?: number;
	/** Optional Worker name forwarded to the runtime for diagnostics. */
	readonly name?: string;
	/** Optional raw Worker factory used by tests or non-default Worker hosts. */
	readonly create?: WorkerOpenOptions<unknown, unknown>['create'];
	/** Authoritative permission evaluator used by remote reverse calls. */
	readonly permission?: PermissionChecker;
	/** Authoritative effect owner used by remote reverse calls. */
	readonly effect?: EffectEmitter;
	/** Optional non-authoritative activity observation sink. */
	readonly observe?: (value: unknown, attempt: ActivityAttemptType) => void | Promise<void>;
}

/** Owned bounded Worker engine provider. */
export interface WorkerProvider extends EngineProvider, AsyncDisposable {
	/** Current process-local Worker pool counters. */
	stats(): ReturnType<Pool<Host>['stats']>;
	/** Stop new acquisition, wait for active leases, and close retained Workers. */
	drain(reason?: unknown): Promise<void>;
}

/** Options used by one Worker module while serving activity attempts. */
export interface WorkerServeOptions {
	/** Engine identity associated with this worker serve. */
	readonly engine: EngineDefinition;
	/** Exact activity implementations this Worker can execute. */
	readonly implementations: readonly ActivityImplementation[];
	/** Resource definitions or collection available to this worker serve. */
	readonly resources: ResourceCollection;
	/** Requirements owned directly by this worker serve; reachable dependency requirements remain separate. */
	readonly requirements?: RequirementRuntime;
	/** Maximum permission leaves permitted in one logical reverse call. */
	readonly maximumChecks?: number;
	/** Optional Worker global scope override used by tests or specialized hosts. */
	readonly scope?: RawWorkerScope;
}

/**
 * Create one owned Worker-backed activity provider.
 *
 * The provider creates Workers lazily through `@okikio/pool`. Disposing the
 * provider drains the pool and stops every Worker it owns. A Worker fault or
 * protocol fault invalidates only the lease that observed it; the Scheduler
 * decides whether the logical activity job receives another attempt.
 */
export async function create(options: WorkerProviderOptions): Promise<WorkerProvider> {
	assertEngine(options.engine);
	const activities = indexDefinitions(options.activities);
	if (!Number.isSafeInteger(options.maximum) || options.maximum < 1) {
		throw new TypeError('Worker provider maximum must be a positive safe integer.');
	}

	const hosts = await pool.create<Host>({
		ctx: options.ctx,
		maximum: options.maximum,
		...(options.minimum === undefined ? {} : { minimum: options.minimum }),
		...(options.maximumIdle === undefined ? {} : { maximumIdle: options.maximumIdle }),
		...(options.maximumIdleAge === undefined ? {} : { maximumIdleAge: options.maximumIdleAge }),
		...(options.acquireTimeout === undefined ? {} : { acquireTimeout: options.acquireTimeout }),
		create: (hostCtx) => openHost(hostCtx),
		async close(host, reason) {
			try { await host.worker.stop(reason); } finally { await host.ctx[Symbol.asyncDispose](); }
		},
	});

	const provider: WorkerProvider = Object.freeze({
		activities: Object.freeze([...activities.values()]),
		async run(ctx: Context, attempt: ActivityAttemptType, control: ActivityAttemptControl): Promise<ActivityAttemptResultType> {
			const definition = getActivity(activities, options.engine, attempt);
			await using lease = await hosts.acquire(ctx);
			const host = lease.value;
			if (host.active.has(attempt.claimId)) {
				lease.invalidate(new TypeError(`Worker request ${JSON.stringify(attempt.claimId)} is already active.`));
				return Object.freeze({ type: 'fault', fault: new TypeError('Duplicate Worker activity claim.') }) as ActivityAttemptResultType;
			}
			host.active.set(attempt.claimId, { activity: definition, attempt, control });
			try {
				const value = await host.worker.request(ctx, attempt, { id: attempt.claimId });
				return await transport.result(definition, value);
			} catch (error) {
				if (workerFault(error)) lease.invalidate(error);
				if (ctx.signal.aborted) return Object.freeze({ type: 'cancelled', reason: ctx.signal.reason }) as ActivityAttemptResultType;
				return Object.freeze({ type: 'lost', reason: error }) as ActivityAttemptResultType;
			} finally {
				host.active.delete(attempt.claimId);
			}
		},
		async cancel() {
			// Request cancellation is driven by the attempt Context passed to `run()`.
			// The Worker utility sends the matching cancel frame when that Context aborts.
		},
		stats() { return hosts.stats(); },
		drain(reason?: unknown) { return hosts.drain(reason); },
		async [Symbol.asyncDispose]() { await hosts[Symbol.asyncDispose](); },
	});
	return provider;

	/** Open one Worker under a stable pool-owned lifetime rather than the short acquisition context. */
	async function openHost(acquireCtx: Context): Promise<Host> {
		contexts.check(acquireCtx);
		const hostCtx = contexts.child(options.ctx, { id: `${options.ctx.id}:activity-worker:${crypto.randomUUID()}` });
		const active = new Map<string, Active>();
		try {
			const worker = hostCtx.use(workers.open<
			ActivityAttemptType,
			transport.WireResultType,
			transport.NoticeType,
			transport.HostCallType,
			transport.HostReplyType
			>(hostCtx, {
				module: options.module,
			protocol: protocol(),
			...(options.name === undefined ? {} : { name: options.name }),
			...(options.shutdownMs === undefined ? {} : { shutdownMs: options.shutdownMs }),
			...(options.create === undefined ? {} : { create: options.create }),
			async notice(notice, _requestCtx, requestId) {
				const current = active.get(requestId);
				if (current !== undefined) await options.observe?.(notice.value, current.attempt);
			},
			async call(call, requestCtx, requestId) {
				const current = active.get(requestId);
				if (current === undefined) throw new TypeError(`Worker reverse call used inactive request ${JSON.stringify(requestId)}.`);
				return await transport.answer(requestCtx, current.activity, current.control, options, call);
			},
			}));
			contexts.check(acquireCtx);
			return Object.freeze({ ctx: hostCtx, worker, active });
		} catch (error) {
			try { await hostCtx[Symbol.asyncDispose](); } catch { /* Preserve the creation failure. */ }
			throw error;
		}
	}
}

/**
 * Serve activity attempts inside a Worker module.
 *
 * The server borrows the supplied resource collection. Every attempt restores
 * a fresh local context from the parent snapshot, then `activity.run()` owns
 * the attempt-local child scope. Permission checks, required effects, and
 * heartbeats use reverse request/result calls to the Scheduler-owning host.
 */
export function serve(options: WorkerServeOptions): WorkerServer {
	assertEngine(options.engine);
	const implementations = indexImplementations(options.implementations);
	const maximumChecks = checkLimit(options.maximumChecks);
	return workers.serve({
		protocol: protocol(),
		...(options.scope === undefined ? {} : { scope: options.scope }),
		async run(attempt, ctx, control) {
			const implementation = implementations.get(identity(attempt.activityId, attempt.activityVersion));
			if (implementation === undefined) {
				return Object.freeze({ type: 'fault', fault: fault(new MissingWorkerActivityError(attempt.activityId, attempt.activityVersion)) });
			}
			if (attempt.engineId !== options.engine.id) {
				return Object.freeze({ type: 'fault', fault: fault(new activity.InvalidEngineError(attempt.activityId, attempt.engineId)) });
			}
			const call = (request: transport.HostCallType) => control.call(request);
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
					permission: transport.checker(call, maximumChecks),
					effect: transport.emitter(call),
					...(options.requirements === undefined ? {} : { requirements: options.requirements }),
					checkpoint: () => control.checkpoint(),
					heartbeat: (value) => transport.heartbeat(call, value),
				});
				return Object.freeze({ type: 'success', value });
			} catch (error) {
				if (activity.isFailure(implementation.definition, error)) {
					return await transport.wire(implementation.definition, Object.freeze({ type: 'failure', failure: error }));
				}
				if (ctx.signal.aborted) return Object.freeze({ type: 'cancelled', reason: fault(ctx.signal.reason) });
				return Object.freeze({ type: 'fault', fault: fault(error) });
			}
		},
	});
}

/** Error returned when the Worker does not own the requested implementation. */
export class MissingWorkerActivityError extends Error {
	/** Stable activity ID requested from this Worker. */
	readonly activityId: string;
	/** Contract version used to distinguish incompatible missing worker activity error shapes. */
	readonly version: string;

	/** Create one configuration error when the Worker lacks the requested activity implementation. */
	constructor(activityId: string, version: string) {
		super(`Worker activity provider has no implementation for ${JSON.stringify(identity(activityId, version))}.`);
		this.name = 'MissingWorkerActivityError';
		this.activityId = activityId;
		this.version = version;
	}
}

/** Create the common activity attempt protocol used by every Worker host. */
function protocol() {
	return workers.protocol({
		request: transport.AttemptSchema,
		response: transport.ResultSchema,
		notice: transport.NoticeSchema,
		call: { request: transport.CallSchema, response: transport.ReplySchema },
	});
}

/** Index exact activity definitions while rejecting identity collisions. */
function indexDefinitions(input: readonly ActivityDefinition[]): Map<string, ActivityDefinition> {
	if (input.length === 0) throw new TypeError('Worker provider requires at least one activity definition.');
	const output = new Map<string, ActivityDefinition>();
	for (const definition of input) {
		const key = identity(definition.id, definition.version);
		const existing = output.get(key);
		if (existing !== undefined && existing !== definition) throw new TypeError(`Activity identity ${JSON.stringify(key)} belongs to different definitions.`);
		output.set(key, definition);
	}
	return output;
}

/** Index child-side implementations by stable activity/version identity. */
function indexImplementations(input: readonly ActivityImplementation[]): Map<string, ActivityImplementation> {
	if (input.length === 0) throw new TypeError('Worker server requires at least one activity implementation.');
	const output = new Map<string, ActivityImplementation>();
	for (const implementation of input) {
		const key = identity(implementation.definition.id, implementation.definition.version);
		if (output.has(key)) throw new TypeError(`Worker server has more than one implementation for ${JSON.stringify(key)}.`);
		output.set(key, implementation);
	}
	return output;
}

/** Resolve one Scheduler attempt to the exact activity contract advertised by the provider. */
function getActivity(
	activities: Map<string, ActivityDefinition>,
	engine: EngineDefinition,
	attempt: ActivityAttemptType,
): ActivityDefinition {
	if (attempt.engineId !== engine.id) throw new activity.InvalidEngineError(attempt.activityId, attempt.engineId);
	const definition = activities.get(identity(attempt.activityId, attempt.activityVersion));
	if (definition === undefined) throw new MissingWorkerActivityError(attempt.activityId, attempt.activityVersion);
	return definition;
}

/** Return the stable key shared by parent definitions and child implementations. */
function identity(id: string, version: string): string {
	return `${id}@${version}`;
}

/** Validate the activity-engine definition before any Worker is created. */
function assertEngine(value: EngineDefinition): void {
	if (typeof value !== 'object' || value === null || value.kind !== 'activity-engine' || typeof value.id !== 'string') {
		throw new TypeError('Worker provider requires an activity-engine definition.');
	}
}

/** Bound one remote logical permission batch before exposing the checker to activity code. */
function checkLimit(value: number | undefined): number {
	const limit = value ?? 1_000;
	if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('Worker permission maximumChecks must be a positive safe integer.');
	return limit;
}

/** Return whether a failed request means the reusable Worker can no longer be trusted. */
function workerFault(value: unknown): boolean {
	return value instanceof workers.WorkerFaultError ||
		value instanceof workers.WorkerProtocolError ||
		value instanceof workers.WorkerStoppedError;
}

/** Convert unexpected runtime values to bounded serializable diagnostics. */
function fault(value: unknown): faultCore.FaultValue {
	return faultCore.encode(value);
}
