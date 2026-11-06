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
import type { EffectEmitter } from '@okikio/capability/effect';
import type { PermissionChecker } from '@okikio/authz/permission';
import * as hostsPool from './hosts.ts';
import { HostSelectionError } from './selection.ts';
import type { HostReferenceType } from './selection.ts';
import type { Lease, Pool } from '@okikio/pool';
import type { RequirementRuntime } from '@okikio/capability/requirement';
import type { ResourceCollection } from '@okikio/capability/resource';
import * as workers from '@okikio/worker/thread';
import type { RawWorkerScope, WorkerOpenOptions, WorkerServer } from '@okikio/worker/thread/types';
import type {
	ActivityAttemptControl,
	ActivityAttemptResultType,
	ActivityAttemptType,
	EngineProvider,
} from '@okikio/workflow';
import * as activity from './mod.ts';
import * as remote from './remote.ts';
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
	/** Assigned once; PID, thread ID and pool position are not stable replacement fences. */
	readonly reference: HostReferenceType;
	/** Stable lifetime for one pooled Worker host. It outlives individual acquisitions. */
	readonly ctx: Owned;
	/** Correlated Worker transport owned for the full reusable host lifetime. */
	readonly worker: workers.WorkerHandle<ActivityAttemptType, transport.WireResultType>;
	/** Active Worker request map keyed by queue claim ID for reverse-call correlation. */
	readonly active: Map<string, Active>;
	/** Idempotent authoritative teardown used for both leased and idle hosts. */
	close(reason?: unknown): Promise<void>;
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
	/** Maximum simultaneous attempts per physical host. Defaults to 1 (exclusive).
	 * Higher values share the event loop and resources; terminating the host loses every active attempt. */
	readonly concurrency?: number;
	/** Bounded pending acquisitions. Defaults to maximum × concurrency. */
	readonly maximumWaiting?: number;
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
	/** Snapshot of live host references. Discovery does not reserve capacity or prevent retirement. */
	hosts(): readonly HostReferenceType[];
	/**
	 * Stop new admission immediately, join active attempts and native close. Never await inside work on
	 * this host.
	 */
	retire(reference: HostReferenceType, reason?: unknown): Promise<void>;
	/** Current process-local Worker pool counters. */
	stats(): ReturnType<Pool<Host>['stats']>;
	/** Stop new acquisition, wait for active leases, and close retained Workers. */
	drain(reason?: unknown): Promise<void>;
}

/** Options used by one Worker module while serving activity attempts. */
export interface WorkerServeOptions {
	/**
	 * Join host-owned cleanup after requests settle and before shutdown acknowledgement. Borrowed
	 * resources remain caller-owned. Failure rejects closed and withholds acknowledgement.
	 */
	readonly finalize?: () => void | Promise<void>;
	/** Concurrent protocol request limit. Defaults to 1000; keep at least the parent provider concurrency. */
	readonly maximumRequests?: number;
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
 * protocol fault invalidates the physical host and can fail its concurrent attempts; the Scheduler
 * decides whether the logical activity job receives another attempt.
 */
export async function create(options: WorkerProviderOptions): Promise<WorkerProvider> {
	remote.engine(options.engine, 'Worker provider');
	const activities = remote.definitions(options.activities, 'Worker provider');
	if (!Number.isSafeInteger(options.maximum) || options.maximum < 1) {
		throw new TypeError('Worker provider maximum must be a positive safe integer.');
	}

	const concurrency = hostsPool.concurrency(options.concurrency);
	const live = new Set<Host>();
	const incarnation = crypto.randomUUID();
	/** Only live retirement receipts are retained; removed host IDs remain lost without tombstones. */
	const retiring = new Map<Host, Promise<void>>();
	const hosts = await hostsPool.create<Host>({
		ctx: options.ctx,
		maximum: options.maximum,
		maximumWaiting: options.maximumWaiting ?? options.maximum * concurrency,
		...(options.minimum === undefined ? {} : { minimum: options.minimum }),
		...(options.maximumIdle === undefined ? {} : { maximumIdle: options.maximumIdle }),
		...(options.maximumIdleAge === undefined ? {} : { maximumIdleAge: options.maximumIdleAge }),
		...(options.acquireTimeout === undefined ? {} : { acquireTimeout: options.acquireTimeout }),
		create: (hostCtx) => openHost(hostCtx),
		close: (host, reason) => host.close(reason),
	}, concurrency);

	const provider = Object.freeze(
		{
			activities: Object.freeze([...activities.values()]),
			/**
			 * Admit the attempt onto its exact requested thread or an eligible free thread. Hold that
			 * reservation through cleanup.
			 */
			async run(
				ctx: Context,
				attempt: ActivityAttemptType,
				control: ActivityAttemptControl,
			): Promise<ActivityAttemptResultType> {
				const definition = remote.definition(
					activities,
					options.engine,
					attempt,
					(id, version) => new MissingWorkerActivityError(id, version),
				);
				const selected = attempt.location?.host;
				let lease: Lease<Host>;
				try {
					lease = await hosts.acquire(
						ctx,
						selected ? { value: hostsPool.resolve(selected, incarnation, live, retiring) } : undefined,
					);
				} catch (error) {
					if (error instanceof HostSelectionError || error instanceof hostsPool.SelectionError) {
						return Object.freeze({
							type: 'lost',
							code: error.code === 'busy' ? 'busy' : 'lost',
							reason: error instanceof HostSelectionError
								? error
								: new HostSelectionError(error.code === 'busy' ? 'busy' : 'lost'),
						});
					}
					throw error;
				}
				await using _reservation = lease;
				const host = lease.value;
				if (host.active.has(attempt.claimId)) {
					lease.invalidate(new TypeError(`Worker request ${JSON.stringify(attempt.claimId)} is already active.`));
					return Object.freeze({
						type: 'fault',
						fault: new TypeError('Duplicate Worker activity claim.'),
					}) as ActivityAttemptResultType;
				}
				host.active.set(attempt.claimId, { activity: definition, attempt, control });
				try {
					const value = await host.worker.request(ctx, { ...attempt, physicalHost: host.reference }, {
						id: attempt.claimId,
					});
					return await transport.result(definition, value);
				} catch (error) {
					if (workerFault(error)) lease.invalidate(error);
					if (contexts.cancelled(error) || (ctx.signal.aborted && error === ctx.signal.reason)) {
						return Object.freeze({
							type: 'cancelled',
							reason: ctx.signal.reason,
						}) as ActivityAttemptResultType;
					}
					return Object.freeze({ type: 'lost', reason: error }) as ActivityAttemptResultType;
				} finally {
					host.active.delete(attempt.claimId);
				}
			},
			async cancel() {
				// Request cancellation is driven by the attempt Context passed to `run()`.
				// The Worker utility sends the matching cancel frame when that Context aborts.
			},
			hosts() {
				return Object.freeze(
					hosts.values().filter((host) => live.has(host) && !retiring.has(host)).map((host) => host.reference),
				);
			},
			retire(reference: HostReferenceType, reason?: unknown) {
				const host = hostsPool.resolve(reference, incarnation, live);
				const previous = retiring.get(host);
				if (previous) return previous;
				const done = Promise.withResolvers<void>();
				retiring.set(host, done.promise);
				void hosts.retire(host, reason).then(done.resolve, done.reject);
				return done.promise;
			},
			stats() {
				return hosts.stats();
			},
			drain(reason?: unknown) {
				return hosts.drain(reason);
			},
			/**
			 * Stop every live thread and still join pool disposal when any individual close fails. Retain all
			 * shutdown failures.
			 */
			async [Symbol.asyncDispose]() {
				const reason = new workers.WorkerStoppedError('Activity Worker provider was disposed.');
				const stopped = await Promise.allSettled([...live].map((host) => host.close(reason)));
				// Presence is separate from the reason: rejecting with undefined still fails shutdown.
				let disposal: { readonly error: unknown } | undefined;
				try {
					await hosts[Symbol.asyncDispose]();
				} catch (error) {
					disposal = { error };
				}
				const failures = stopped
					.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
					.map((result) => result.reason);
				if (disposal !== undefined) failures.push(disposal.error);
				if (failures.length > 0) throw new AggregateError(failures, 'Activity Worker provider disposal failed.');
			},
		} satisfies WorkerProvider,
	);
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
				protocol: workers.protocol(remote.protocol()),
				maximumRequests: concurrency,
				...(options.name === undefined ? {} : { name: options.name }),
				...(options.shutdownMs === undefined ? {} : { shutdownMs: options.shutdownMs }),
				...(options.create === undefined ? {} : { create: options.create }),
				async notice(notice, _requestCtx, requestId) {
					// Resolve against the currently leased attempt, never a previous request
					// that happened to use this reusable host.
					const current = active.get(requestId);
					if (current !== undefined) await options.observe?.(notice.value, current.attempt);
				},
				async call(call, requestCtx, requestId) {
					const current = active.get(requestId);
					if (current === undefined) {
						throw new TypeError(`Worker reverse call used inactive request ${JSON.stringify(requestId)}.`);
					}
					return await transport.answer(requestCtx, current.activity, current.control, options, call);
				},
			}));
			contexts.check(acquireCtx);
			let closing: Promise<void> | undefined;
			const close = (reason?: unknown): Promise<void> => {
				closing ??= (async () => {
					try {
						await worker.stop(reason);
					} finally {
						try {
							await hostCtx[Symbol.asyncDispose]();
						} finally {
							live.delete(host);
							retiring.delete(host);
						}
					}
				})();
				return closing;
			};
			const host: Host = Object.freeze({
				reference: Object.freeze({ pool: incarnation, id: crypto.randomUUID() }),
				ctx: hostCtx,
				worker,
				active,
				close,
			});
			live.add(host);
			return host;
		} catch (error) {
			try {
				await hostCtx[Symbol.asyncDispose]();
			} catch { /* Preserve the creation failure. */ }
			throw error;
		}
	}
}

/**
 * Serve activity attempts inside a Worker module.
 *
 * The server borrows the supplied resource collection. Every attempt restores
 * a fresh local context from the parent snapshot, then `activity.run()` owns
 * the attempt-local child scope. Permission checks, declared effects, and
 * heartbeats use reverse request/result calls to the Scheduler-owning host.
 */
export function serve(options: WorkerServeOptions): WorkerServer {
	remote.engine(options.engine, 'Worker server');
	const implementations = remote.implementations(options.implementations, 'Worker server');
	const maximumChecks = remote.maximumChecks(options.maximumChecks, 'Worker');
	return workers.serve({
		...(options.finalize === undefined ? {} : { finalize: options.finalize }),
		...(options.maximumRequests === undefined ? {} : { maximumRequests: options.maximumRequests }),
		protocol: workers.protocol(remote.protocol()),
		...(options.scope === undefined ? {} : { scope: options.scope }),
		/**
		 * On the thread side, reject missing revisions and incorrect engines before application code can
		 * borrow resources.
		 */
		async run(attempt, ctx, control) {
			const implementation = implementations.get(remote.identity(attempt.activityId, attempt.activityVersion));
			if (implementation === undefined) {
				return Object.freeze({
					type: 'fault',
					fault: remote.fault(new MissingWorkerActivityError(attempt.activityId, attempt.activityVersion)),
				});
			}
			if (attempt.engineId !== options.engine.id) {
				return Object.freeze({
					type: 'fault',
					fault: remote.fault(new activity.InvalidEngineError(attempt.activityId, attempt.engineId)),
				});
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
					physicalHost: attempt.physicalHost,
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
				if (contexts.cancelled(error) || (ctx.signal.aborted && error === ctx.signal.reason)) {
					return Object.freeze({ type: 'cancelled', reason: remote.fault(ctx.signal.reason) });
				}
				// The enclosing transport checks cancellation after a returned value. Raise genuine
				// stop or disposal faults so it cannot replace them with a clean cancellation receipt.
				if (ctx.signal.aborted) throw error;
				return Object.freeze({ type: 'fault', fault: remote.fault(error) });
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
		super(
			`Worker activity provider has no implementation for ${JSON.stringify(remote.identity(activityId, version))}.`,
		);
		this.name = 'MissingWorkerActivityError';
		this.activityId = activityId;
		this.version = version;
	}
}

/** Return whether a failed request means the reusable Worker can no longer be trusted. */
function workerFault(value: unknown): boolean {
	return value instanceof workers.WorkerFaultError ||
		value instanceof workers.WorkerProtocolError ||
		value instanceof workers.WorkerStoppedError;
}
