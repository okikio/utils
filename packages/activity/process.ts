/**
 * Activity engine providers backed by owned child processes.
 *
 * The provider composes `@okikio/worker/process`, `@okikio/worker/process/channel`, and
 * `@okikio/pool`. Those utilities keep ownership of process lifecycle, framed
 * correlation, and reusable host capacity. The Workflow Scheduler remains the
 * only owner of logical activity attempts and retries.
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
import * as processes from '@okikio/worker/process';
import type { Adapter as ProcessAdapter, Process, StartOptionsType } from '@okikio/worker/process';
import * as channel from '@okikio/worker/process/channel';
import type { ProcessChannel } from '@okikio/worker/process/channel/types';
import type { RequirementRuntime } from '@okikio/capability/requirement';
import type { ResourceCollection } from '@okikio/capability/resource';
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

/** Active attempt state required to answer child-to-parent reverse calls. */
interface Active {
	/** Exact activity contract associated with this in-flight process request. */
	readonly activity: ActivityDefinition;
	/** Fenced Scheduler attempt whose reverse calls remain valid while this request is active. */
	readonly attempt: ActivityAttemptType;
	/** Scheduler-owned controls used for heartbeats while this process request is active. */
	readonly control: ActivityAttemptControl;
}

/** One reusable child process and its framed request endpoint. */
interface Host {
	/** Assigned once; PID, thread ID and pool position are not stable replacement fences. */
	readonly reference: HostReferenceType;
	/** Stable lifetime for one pooled child-process host. */
	readonly ctx: Owned;
	/** Owned child process whose stdin/stdout carry the activity protocol. */
	readonly process: Process;
	/** Framed correlated request channel layered above the owned child process. */
	readonly channel: ProcessChannel<ActivityAttemptType, transport.WireResultType>;
	/** Active child request map keyed by queue claim ID for reverse-call correlation. */
	readonly active: Map<string, Active>;
	/** Idempotent authoritative teardown used for both leased and idle hosts. */
	close(reason?: unknown): Promise<void>;
}

/** Child-process launch input controlled by the provider. */
export type ProcessStartOptions = Omit<StartOptionsType, 'stdin' | 'stdout'>;

/** Options for one bounded child-process activity provider. */
export interface ProcessProviderOptions {
	/** Borrowed parent execution context for this process provider. */
	readonly ctx: Context;
	/** Engine identity associated with this process provider. */
	readonly engine: EngineDefinition;
	/** Exact activity definitions this process provider exposes to Scheduler placement. */
	readonly activities: readonly ActivityDefinition[];
	/** Operating-system process adapter used to spawn each owned child host. */
	readonly adapter: ProcessAdapter;
	/** Child-process start options applied to every reusable process host. */
	readonly start: ProcessStartOptions;
	/** Maximum simultaneous or retained values permitted by this process provider. */
	readonly maximum: number;
	/** Maximum simultaneous attempts per physical host. Defaults to 1 (exclusive).
	 * Higher values share the event loop and resources; terminating the host loses every active attempt. */
	readonly concurrency?: number;
	/** Bounded pending acquisitions. Defaults to maximum × concurrency. */
	readonly maximumWaiting?: number;
	/** Minimum retained or pre-created values requested for this process provider. */
	readonly minimum?: number;
	/** Maximum idle process hosts retained for reuse. */
	readonly maximumIdle?: number;
	/** Maximum duration an idle process host may remain retained before recycling. */
	readonly maximumIdleAge?: Temporal.Duration | Temporal.DurationLike | string;
	/** Maximum wait for one reusable process host before acquisition fails. */
	readonly acquireTimeout?: Temporal.Duration | Temporal.DurationLike | string;
	/** Maximum UTF-8 bytes accepted in one framed protocol message. */
	readonly maximumFrameBytes?: number;
	/** Optional local policy checker that answers reverse permission calls from child activities. */
	readonly permission?: PermissionChecker;
	/** Optional local effect owner that answers reverse effect calls from child activities. */
	readonly effect?: EffectEmitter;
	/** Optional observer for non-authoritative notices emitted by child activities. */
	readonly observe?: (value: unknown, attempt: ActivityAttemptType) => void | Promise<void>;
}

/** Owned bounded process engine provider. */
export interface ProcessProvider extends EngineProvider, AsyncDisposable {
	/** Snapshot of live host references. Discovery does not reserve capacity or prevent retirement. */
	hosts(): readonly HostReferenceType[];
	/**
	 * Stop new admission immediately, join active attempts and native close. Never await inside work on
	 * this host.
	 */
	retire(reference: HostReferenceType, reason?: unknown): Promise<void>;
	/** Return the current reusable process-host pool snapshot. */
	stats(): ReturnType<Pool<Host>['stats']>;
	/** Stop new process-host acquisition and wait for leased hosts to return. */
	drain(reason?: unknown): Promise<void>;
}

/** Options used by one child executable while serving activity attempts. */
export interface ProcessServeOptions {
	/**
	 * Join host-owned cleanup after requests settle and before shutdown acknowledgement. Borrowed
	 * resources remain caller-owned. Failure rejects closed and withholds acknowledgement.
	 */
	readonly finalize?: () => void | Promise<void>;
	/** Concurrent protocol request limit. Defaults to 1000; keep at least the parent provider concurrency. */
	readonly maximumRequests?: number;
	/** Engine identity associated with this process serve. */
	readonly engine: EngineDefinition;
	/** Exact activity implementations this child process can execute. */
	readonly implementations: readonly ActivityImplementation[];
	/** Resource definitions or collection available to this process serve. */
	readonly resources: ResourceCollection;
	/** Protocol input byte stream, normally the child process stdin. */
	readonly input: ReadableStream<Uint8Array>;
	/** Protocol-only byte stream used for framed responses; diagnostics belong on stderr. */
	readonly output: WritableStream<Uint8Array>;
	/** Requirements owned directly by this process serve; reachable dependency requirements remain separate. */
	readonly requirements?: RequirementRuntime;
	/** Maximum logical permission checks accepted by one remote activity evaluation. */
	readonly maximumChecks?: number;
	/** Maximum UTF-8 bytes accepted in one framed protocol message. */
	readonly maximumFrameBytes?: number;
}

/**
 * Create one process-backed activity provider.
 *
 * `stdin` and `stdout` are reserved for the typed protocol. The caller may
 * configure `stderr` for bounded diagnostics. A failed channel invalidates the
 * corresponding pool value; process replacement remains pool-owned and logical
 * retry remains Scheduler-owned.
 */
export async function create(options: ProcessProviderOptions): Promise<ProcessProvider> {
	remote.engine(options.engine, 'Process provider');
	const activities = remote.definitions(options.activities, 'Process provider');
	if (!Number.isSafeInteger(options.maximum) || options.maximum < 1) {
		throw new TypeError('Process provider maximum must be a positive safe integer.');
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

	return Object.freeze({
		activities: Object.freeze([...activities.values()]),
		/**
		 * Acquire the requested process or an eligible free process before sending this attempt.
		 * Keep its sublease until the reply and attempt cleanup settle; an I/O wait does not free the process slot.
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
				(id, version) => new MissingProcessActivityError(id, version),
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
			host.active.set(attempt.claimId, { activity: definition, attempt, control });
			try {
				const value = await host.channel.request(ctx, { ...attempt, physicalHost: host.reference }, {
					id: attempt.claimId,
				});
				return await transport.result(definition, value);
			} catch (error) {
				if (channelFault(error)) lease.invalidate(error);
				if (contexts.cancelled(error) || (ctx.signal.aborted && error === ctx.signal.reason)) {
					return Object.freeze({ type: 'cancelled', reason: ctx.signal.reason }) as ActivityAttemptResultType;
				}
				return Object.freeze({ type: 'lost', reason: error }) as ActivityAttemptResultType;
			} finally {
				host.active.delete(attempt.claimId);
			}
		},
		async cancel() {
			// The request Context is the cancellation authority. The channel emits
			// the exact cancel frame when that Context aborts.
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
		 * Ask every live process to stop, then join pool disposal even if a process close failed.
		 * Collect all shutdown failures so one rejection cannot skip another owner's cleanup.
		 */
		async [Symbol.asyncDispose]() {
			const reason = new Error('Activity process provider was disposed.');
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
			if (failures.length > 0) throw new AggregateError(failures, 'Activity process provider disposal failed.');
		},
	}) satisfies ProcessProvider;

	/** Start one child with protocol-only stdin/stdout, then open its framed channel. */
	async function openHost(acquireCtx: Context): Promise<Host> {
		contexts.check(acquireCtx);
		const hostCtx = contexts.child(options.ctx, { id: `${options.ctx.id}:activity-process:${crypto.randomUUID()}` });
		try {
			const child = hostCtx.use(
				await processes.start(hostCtx, options.adapter, {
					...options.start,
					stdin: 'piped',
					stdout: { type: 'stream' },
				}),
			);
			contexts.check(acquireCtx);
			if (child.stdin === undefined || child.stdout === undefined) {
				throw new TypeError('Process provider child did not expose piped stdin/stdout.');
			}
			const active = new Map<string, Active>();
			const connection = hostCtx.use(
				channel.open(hostCtx, child as Process & Required<Pick<Process, 'stdin' | 'stdout'>>, {
					protocol: channel.protocol(remote.protocol()),
					maximumRequests: concurrency,
					...(options.maximumFrameBytes === undefined ? {} : { maximumFrameBytes: options.maximumFrameBytes }),
					async notice(notice, _requestCtx, requestId) {
						// Resolve against the currently leased attempt, never a previous request
						// that happened to use this reusable host.
						const current = active.get(requestId);
						if (current !== undefined) await options.observe?.(notice.value, current.attempt);
					},
					async call(call, requestCtx, requestId) {
						const current = active.get(requestId);
						if (current === undefined) {
							throw new TypeError(`Process reverse call used inactive request ${JSON.stringify(requestId)}.`);
						}
						return await transport.answer(requestCtx, current.activity, current.control, options, call);
					},
				}),
			);
			contexts.check(acquireCtx);
			let closing: Promise<void> | undefined;
			const close = (reason?: unknown): Promise<void> => {
				closing ??= (async () => {
					try {
						await connection.close(reason);
					} finally {
						try {
							await child.stop(reason);
						} finally {
							try {
								await hostCtx[Symbol.asyncDispose]();
							} finally {
								live.delete(host);
								retiring.delete(host);
							}
						}
					}
				})();
				return closing;
			};
			const host: Host = Object.freeze({
				reference: Object.freeze({ pool: incarnation, id: crypto.randomUUID() }),
				ctx: hostCtx,
				process: child,
				channel: connection,
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
 * Serve activity attempts over one child process's protocol streams.
 *
 * The returned channel server does not own the operating-system process. The
 * executable chooses its own exit policy after `server.closed` resolves.
 */
export function serve(options: ProcessServeOptions): channel.ProcessServer {
	remote.engine(options.engine, 'Process server');
	const implementations = remote.implementations(options.implementations, 'Process server');
	const maximumChecks = remote.maximumChecks(options.maximumChecks, 'Process');
	return channel.serve({
		...(options.finalize === undefined ? {} : { finalize: options.finalize }),
		...(options.maximumRequests === undefined ? {} : { maximumRequests: options.maximumRequests }),
		protocol: channel.protocol(remote.protocol()),
		input: options.input,
		output: options.output,
		...(options.maximumFrameBytes === undefined ? {} : { maximumFrameBytes: options.maximumFrameBytes }),
		/**
		 * On the child side, resolve the exact activity revision and engine before decoding input or running
		 * application code.
		 */
		async run(attempt, ctx, control) {
			const implementation = implementations.get(remote.identity(attempt.activityId, attempt.activityVersion));
			if (implementation === undefined) {
				return Object.freeze({
					type: 'fault',
					fault: remote.fault(new MissingProcessActivityError(attempt.activityId, attempt.activityVersion)),
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

/** Expected configuration error when the child lacks one registered activity implementation. */
export class MissingProcessActivityError extends Error {
	/** Stable activity ID requested from this child process. */
	readonly activityId: string;
	/** Activity contract version requested from this child process. */
	readonly version: string;

	/** Create one configuration error when the child process lacks the requested activity implementation. */
	constructor(activityId: string, version: string) {
		super(
			`Process activity provider has no implementation for ${JSON.stringify(remote.identity(activityId, version))}.`,
		);
		this.name = 'MissingProcessActivityError';
		this.activityId = activityId;
		this.version = version;
	}
}

/** Decide whether a channel failure invalidates the reusable process host. */
function channelFault(value: unknown): boolean {
	return value instanceof channel.ChannelFaultError ||
		value instanceof channel.ChannelProtocolError ||
		value instanceof channel.ChannelClosedError;
}
