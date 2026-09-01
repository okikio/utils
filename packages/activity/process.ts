/**
 * Activity engine providers backed by owned child processes.
 *
 * The provider composes `@okikio/process`, `@okikio/process/channel`, and
 * `@okikio/pool`. Those utilities keep ownership of process lifecycle, framed
 * correlation, and reusable host capacity. The Workflow Scheduler remains the
 * only owner of logical activity attempts and retries.
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
import * as processes from '@okikio/process';
import type { Adapter as ProcessAdapter, Process, StartOptionsType } from '@okikio/process';
import * as channel from '@okikio/process/channel';
import type { ProcessChannel } from '@okikio/process/channel/types';
import type { RequirementRuntime } from '@okikio/requirement';
import type { ResourceCollection } from '@okikio/resource';
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
	/** Stable lifetime for one pooled child-process host. */
	readonly ctx: Owned;
	/** Owned child process whose stdin/stdout carry the activity protocol. */
	readonly process: Process;
	/** Framed correlated request channel layered above the owned child process. */
	readonly channel: ProcessChannel<ActivityAttemptType, transport.WireResultType>;
	/** Active child request map keyed by queue claim ID for reverse-call correlation. */
	readonly active: Map<string, Active>;
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
	/** Return the current reusable process-host pool snapshot. */
	stats(): ReturnType<Pool<Host>['stats']>;
	/** Stop new process-host acquisition and wait for leased hosts to return. */
	drain(reason?: unknown): Promise<void>;
}

/** Options used by one child executable while serving activity attempts. */
export interface ProcessServeOptions {
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
	assertEngine(options.engine);
	const activities = indexDefinitions(options.activities);
	if (!Number.isSafeInteger(options.maximum) || options.maximum < 1) {
		throw new TypeError('Process provider maximum must be a positive safe integer.');
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
			try {
				await host.channel.close(reason);
			} finally {
				try { await host.process.stop(reason); } finally { await host.ctx[Symbol.asyncDispose](); }
			}
		},
	});

	return Object.freeze({
		activities: Object.freeze([...activities.values()]),
		async run(ctx: Context, attempt: ActivityAttemptType, control: ActivityAttemptControl): Promise<ActivityAttemptResultType> {
			const definition = getActivity(activities, options.engine, attempt);
			await using lease = await hosts.acquire(ctx);
			const host = lease.value;
			host.active.set(attempt.claimId, { activity: definition, attempt, control });
			try {
				const value = await host.channel.request(ctx, attempt, { id: attempt.claimId });
				return await transport.result(definition, value);
			} catch (error) {
				if (channelFault(error)) lease.invalidate(error);
				if (ctx.signal.aborted) return Object.freeze({ type: 'cancelled', reason: ctx.signal.reason }) as ActivityAttemptResultType;
				return Object.freeze({ type: 'lost', reason: error }) as ActivityAttemptResultType;
			} finally {
				host.active.delete(attempt.claimId);
			}
		},
		async cancel() {
			// The request Context is the cancellation authority. The channel emits
			// the exact cancel frame when that Context aborts.
		},
		stats() { return hosts.stats(); },
		drain(reason?: unknown) { return hosts.drain(reason); },
		async [Symbol.asyncDispose]() { await hosts[Symbol.asyncDispose](); },
	}) satisfies ProcessProvider;

	/** Start one child with protocol-only stdin/stdout, then open its framed channel. */
	async function openHost(acquireCtx: Context): Promise<Host> {
		contexts.check(acquireCtx);
		const hostCtx = contexts.child(options.ctx, { id: `${options.ctx.id}:activity-process:${crypto.randomUUID()}` });
		try {
			const child = hostCtx.use(await processes.start(hostCtx, options.adapter, {
				...options.start,
				stdin: 'piped',
				stdout: { type: 'stream' },
			}));
			contexts.check(acquireCtx);
			if (child.stdin === undefined || child.stdout === undefined) {
				throw new TypeError('Process provider child did not expose piped stdin/stdout.');
			}
			const active = new Map<string, Active>();
			const connection = hostCtx.use(channel.open(hostCtx, child as Process & Required<Pick<Process, 'stdin' | 'stdout'>>, {
				protocol: protocol(),
				...(options.maximumFrameBytes === undefined ? {} : { maximumFrameBytes: options.maximumFrameBytes }),
				async notice(notice, _requestCtx, requestId) {
					const current = active.get(requestId);
					if (current !== undefined) await options.observe?.(notice.value, current.attempt);
				},
				async call(call, requestCtx, requestId) {
					const current = active.get(requestId);
					if (current === undefined) throw new TypeError(`Process reverse call used inactive request ${JSON.stringify(requestId)}.`);
					return await transport.answer(requestCtx, current.activity, current.control, options, call);
				},
			}));
			contexts.check(acquireCtx);
			return Object.freeze({ ctx: hostCtx, process: child, channel: connection, active });
		} catch (error) {
			try { await hostCtx[Symbol.asyncDispose](); } catch { /* Preserve the creation failure. */ }
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
	assertEngine(options.engine);
	const implementations = indexImplementations(options.implementations);
	const maximumChecks = checkLimit(options.maximumChecks);
	return channel.serve({
		protocol: protocol(),
		input: options.input,
		output: options.output,
		...(options.maximumFrameBytes === undefined ? {} : { maximumFrameBytes: options.maximumFrameBytes }),
		async run(attempt, ctx, control) {
			const implementation = implementations.get(identity(attempt.activityId, attempt.activityVersion));
			if (implementation === undefined) {
				return Object.freeze({ type: 'fault', fault: fault(new MissingProcessActivityError(attempt.activityId, attempt.activityVersion)) });
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

/** Expected configuration error when the child lacks one registered activity implementation. */
export class MissingProcessActivityError extends Error {
	/** Stable activity ID requested from this child process. */
	readonly activityId: string;
	/** Activity contract version requested from this child process. */
	readonly version: string;

	/** Create one configuration error when the child process lacks the requested activity implementation. */
	constructor(activityId: string, version: string) {
		super(`Process activity provider has no implementation for ${JSON.stringify(identity(activityId, version))}.`);
		this.name = 'MissingProcessActivityError';
		this.activityId = activityId;
		this.version = version;
	}
}

/** Create the protocol shared by the parent process provider and child executable. */
function protocol() {
	return channel.protocol({
		request: transport.AttemptSchema,
		response: transport.ResultSchema,
		notice: transport.NoticeSchema,
		call: { request: transport.CallSchema, response: transport.ReplySchema },
	});
}

/** Index parent-side activity contracts while preserving exact identity. */
function indexDefinitions(input: readonly ActivityDefinition[]): Map<string, ActivityDefinition> {
	if (input.length === 0) throw new TypeError('Process provider requires at least one activity definition.');
	const output = new Map<string, ActivityDefinition>();
	for (const definition of input) {
		const key = identity(definition.id, definition.version);
		const previous = output.get(key);
		if (previous !== undefined && previous !== definition) throw new TypeError(`Activity identity ${JSON.stringify(key)} belongs to different definitions.`);
		output.set(key, definition);
	}
	return output;
}

/** Index child-side behavior and reject duplicate activity/version ownership. */
function indexImplementations(input: readonly ActivityImplementation[]): Map<string, ActivityImplementation> {
	if (input.length === 0) throw new TypeError('Process server requires at least one activity implementation.');
	const output = new Map<string, ActivityImplementation>();
	for (const implementation of input) {
		const key = identity(implementation.definition.id, implementation.definition.version);
		if (output.has(key)) throw new TypeError(`Process server has more than one implementation for ${JSON.stringify(key)}.`);
		output.set(key, implementation);
	}
	return output;
}

/** Resolve the Scheduler attempt to the exact activity definition exposed by this process provider. */
function getActivity(
	activities: Map<string, ActivityDefinition>,
	engine: EngineDefinition,
	attempt: ActivityAttemptType,
): ActivityDefinition {
	if (attempt.engineId !== engine.id) throw new activity.InvalidEngineError(attempt.activityId, attempt.engineId);
	const definition = activities.get(identity(attempt.activityId, attempt.activityVersion));
	if (definition === undefined) throw new MissingProcessActivityError(attempt.activityId, attempt.activityVersion);
	return definition;
}

/** Stable activity/version identity used on both sides of the process protocol. */
function identity(id: string, version: string): string {
	return `${id}@${version}`;
}

/** Validate the activity-engine definition before any process is spawned. */
function assertEngine(value: EngineDefinition): void {
	if (typeof value !== 'object' || value === null || value.kind !== 'activity-engine' || typeof value.id !== 'string') {
		throw new TypeError('Process provider requires an activity-engine definition.');
	}
}

/** Bound one logical remote permission request before exposing it to activity code. */
function checkLimit(value: number | undefined): number {
	const limit = value ?? 1_000;
	if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('Process permission maximumChecks must be a positive safe integer.');
	return limit;
}

/** Decide whether a channel failure invalidates the reusable process host. */
function channelFault(value: unknown): boolean {
	return value instanceof channel.ChannelFaultError ||
		value instanceof channel.ChannelProtocolError ||
		value instanceof channel.ChannelClosedError;
}

/** Convert unexpected runtime values to bounded serializable diagnostics. */
function fault(value: unknown): faultCore.FaultValue {
	return faultCore.encode(value);
}
