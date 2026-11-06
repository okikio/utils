import * as codecs from '@okikio/schema/codec';
import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as context from '@okikio/context';
import * as effect from '@okikio/capability/effect';
import * as failures from '@okikio/result/failure';
import * as permissions from '@okikio/authz/permission';
import type { Adapter as ProcessAdapter, SignalType, Spawned, StatusType } from '@okikio/worker/process';
import * as resource from '@okikio/capability/resource';
import type { RawWorker, RawWorkerScope } from '@okikio/worker/thread';
import type { ActivityAttemptControl, ActivityAttemptType, EngineProvider } from '@okikio/workflow';
import * as engine from './engine.ts';
import * as local from './local.ts';
import * as activity from './mod.ts';
import * as processes from './process.ts';
import * as workers from './worker.ts';

/** Creates a minimal Standard Schema contract for transport conformance fixtures. */
function contract<Output>(validate: (value: unknown) => Output): StandardSchemaV1<unknown, Output> {
	return Object.freeze({
		'~standard': Object.freeze({
			version: 1,
			vendor: 'activity-provider-test',
			validate(value: unknown) {
				try {
					return { value: validate(value) };
				} catch (error) {
					return { issues: [{ message: error instanceof Error ? error.message : String(error) }] };
				}
			},
		}),
	});
}

const InputSchema = contract((value) => {
	if (typeof value !== 'object' || value === null || typeof (value as { value?: unknown }).value !== 'string') {
		throw new TypeError('Expected a value string.');
	}
	return Object.freeze({ value: (value as { value: string }).value });
});
const ResultSchema = contract((value) => {
	if (typeof value !== 'object' || value === null || typeof (value as { stored?: unknown }).stored !== 'string') {
		throw new TypeError('Expected a stored string.');
	}
	return Object.freeze({ stored: (value as { stored: string }).stored });
});

const Engine = engine.define({ id: 'provider-test', description: 'Runs transport-conformance activities.' });
const Store = resource.define<{ save(value: string): Promise<void> }>()({
	id: 'provider-test.store',
	description: 'Stores values observed by the transport conformance fixture.',
});
const Write = permissions.define({
	id: 'provider-test.write',
	description: 'Write one value through a transport-conformance activity.',
	target: InputSchema,
});
const Rejected = failures.define({
	id: 'provider-test.rejected',
	description: 'The transport-conformance fixture deliberately rejected one value.',
	data: codecs.identity(InputSchema),
});
const Stored = effect.define({
	id: 'provider-test.stored',
	description: 'Records that one transport-conformance value was committed.',
	value: codecs.identity(ResultSchema),
});
const Save = activity.define({
	id: 'provider-test.save',
	version: '1',
	description: 'Checks authority, saves one value, emits an effect, and reports liveness.',
	input: codecs.identity(InputSchema),
	result: codecs.identity(ResultSchema),
	placement: engine.require(Engine),
	resources: [Store],
	requirements: [permissions.require(Write)],
	failures: [Rejected],
	effects: [Stored],
});

const SaveLive = activity.implement(Save, {
	async run(ctx) {
		await permissions.assert(ctx, Write, ctx.input);
		if (ctx.input.value === 'fail') {
			throw await failures.create(Rejected, { data: ctx.input, message: 'rejected by conformance fixture' });
		}
		await ctx.checkpoint();
		const store = await ctx.get(Store);
		await store.save(ctx.input.value);
		await ctx.heartbeat({ phase: 'stored', value: ctx.input.value });
		const output = Object.freeze({ stored: ctx.input.value });
		await effect.emit(ctx, Stored, output, { key: `stored:${ctx.input.value}` });
		return output;
	},
});

/** Creates one resource collection and exposes the values committed by activity attempts. */
function resources(ctx: context.Owned): Readonly<{ collection: resource.ResourceCollection; values: string[] }> {
	const values: string[] = [];
	const StoreLive = resource.implement(Store, {
		create() {
			return Object.freeze({
				async save(value: string) {
					values.push(value);
				},
			});
		},
	});
	return Object.freeze({ collection: resource.create(resource.implementations(StoreLive), { ctx, host: {} }), values });
}

/** Creates one serializable fenced attempt independent from Scheduler placement tests. */
function attempt(ctx: context.Context, claimId: string, value = 'value'): ActivityAttemptType {
	return Object.freeze({
		jobId: `job:${claimId}`,
		attempt: 1,
		claimId,
		activityId: Save.id,
		activityVersion: Save.version,
		engineId: Engine.id,
		registrationId: 'registration:1',
		hostId: 'host:1',
		generation: 1,
		origin: Object.freeze({
			workflowId: 'provider-test.workflow',
			workflowVersion: '1',
			runId: 'run:1',
			instructionPath: 'provider-test.workflow@1/0',
			instructionFingerprint: 'provider-test-fingerprint',
		}),
		context: context.snapshot(ctx),
		input: Object.freeze({ value }),
		admitted: true,
	});
}

/** Creates parent-side services shared by all provider shapes. */
function services() {
	const permissions: permissions.PermissionRequest[][] = [];
	const effects: effect.EffectOccurrence[] = [];
	const heartbeats: unknown[] = [];
	const checker: permissions.PermissionChecker = {
		maximumChecks: 16,
		async check(_ctx, requests) {
			permissions.push([...requests]);
			return requests.map(() => Object.freeze({ allowed: true as const }));
		},
	};
	const emitter: effect.EffectEmitter = {
		async emit(_ctx, occurrence) {
			effects.push(occurrence);
		},
	};
	const control: ActivityAttemptControl = {
		async heartbeat(value) {
			heartbeats.push(value);
		},
	};
	return { checker, emitter, control, permissions, effects, heartbeats };
}

/** Verifies the semantics that every engine-provider transport must preserve. */
async function verify(
	provider: EngineProvider,
	ctx: context.Context,
	_services: ReturnType<typeof services>,
): Promise<void> {
	const result = await provider.run(ctx, attempt(ctx, `claim:${crypto.randomUUID()}`), _services.control);
	expect(result).toEqual({ type: 'success', value: { stored: 'value' } });
	expect(_services.permissions).toHaveLength(1);
	expect(_services.permissions[0]?.[0]).toMatchObject({ definition: Write, target: { value: 'value' } });
	expect(_services.effects).toHaveLength(1);
	expect(_services.effects[0]).toMatchObject({ definition: Stored, key: 'stored:value', value: { stored: 'value' } });
	expect(_services.heartbeats).toEqual([{ phase: 'stored', value: 'value' }]);
}

/** Verifies declared failures keep exact definition identity across every provider transport. */
async function verifyFailure(
	provider: EngineProvider,
	ctx: context.Context,
	_services: ReturnType<typeof services>,
): Promise<void> {
	const result = await provider.run(ctx, attempt(ctx, `claim:${crypto.randomUUID()}`, 'fail'), _services.control);
	expect(result.type).toBe('failure');
	if (result.type !== 'failure') throw new TypeError('Expected one declared activity failure.');
	expect(failures.is(result.failure, Rejected)).toBe(true);
	if (!failures.is(result.failure, Rejected)) throw new TypeError('Expected the exact declared failure definition.');
	expect(result.failure.message).toBe('rejected by conformance fixture');
	expect(result.failure.data).toEqual({ value: 'fail' });
}

/** Parent-side raw Worker connected directly to one validation Worker scope. */
class PairedWorker implements RawWorker {
	readonly listeners = {
		message: new Set<(event: MessageEvent<unknown>) => void>(),
		error: new Set<(event: ErrorEvent) => void>(),
		messageerror: new Set<(event: MessageEvent<unknown>) => void>(),
	};
	readonly scope: PairedScope;
	terminated = false;

	constructor() {
		this.scope = new PairedScope(this);
	}
	postMessage(message: unknown): void {
		queueMicrotask(() => this.scope.receive(message));
	}
	terminate(): void {
		this.terminated = true;
	}
	addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
	addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
	addEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void;
	addEventListener(
		type: keyof PairedWorker['listeners'],
		listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void),
	): void {
		(this.listeners[type] as Set<typeof listener>).add(listener);
	}
	removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
	removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
	removeEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void;
	removeEventListener(
		type: keyof PairedWorker['listeners'],
		listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void),
	): void {
		(this.listeners[type] as Set<typeof listener>).delete(listener);
	}
	/** Delivers one Worker-side frame back to the parent request owner. */
	receive(message: unknown): void {
		for (const listener of this.listeners.message) listener(new MessageEvent('message', { data: message }));
	}
}

/** Worker-global side of one in-memory parent/Worker transport pair. */
class PairedScope implements RawWorkerScope {
	readonly listeners = {
		message: new Set<(event: MessageEvent<unknown>) => void>(),
		messageerror: new Set<(event: MessageEvent<unknown>) => void>(),
	};
	readonly parent: PairedWorker;
	constructor(parent: PairedWorker) {
		this.parent = parent;
	}
	postMessage(message: unknown): void {
		queueMicrotask(() => this.parent.receive(message));
	}
	addEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent<unknown>) => void): void {
		this.listeners[type].add(listener);
	}
	removeEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent<unknown>) => void): void {
		this.listeners[type].delete(listener);
	}
	/** Delivers one parent-side frame to every Worker server listener. */
	receive(message: unknown): void {
		for (const listener of this.listeners.message) listener(new MessageEvent('message', { data: message }));
	}
}

/** In-memory process adapter whose pipes connect the provider to a child-side activity server. */
class PairedProcessAdapter implements ProcessAdapter {
	readonly trees = Object.freeze(['direct-child'] as const);
	readonly signal = 'SIGTERM';
	readonly forceSignal = 'SIGKILL';
	readonly servers: import('@okikio/worker/process/channel').ProcessServer[] = [];
	#pid = 40_000;

	readonly owner: context.Owned;
	readonly remote: resource.ResourceCollection;
	constructor(owner: context.Owned, remote: resource.ResourceCollection) {
		this.owner = owner;
		this.remote = remote;
	}

	async spawn(): Promise<Spawned> {
		const input = new TransformStream<Uint8Array, Uint8Array>();
		const output = new TransformStream<Uint8Array, Uint8Array>();
		const server = processes.serve({
			engine: Engine,
			implementations: [SaveLive],
			resources: this.remote,
			input: input.readable,
			output: output.writable,
		});
		this.servers.push(server);

		let settle!: (status: StatusType) => void;
		const status = new Promise<StatusType>((resolve) => {
			settle = resolve;
		});
		let stopped = false;
		const pid = ++this.#pid;
		return Object.freeze({
			pid,
			stdin: input.writable,
			stdout: output.readable,
			status,
			kill(signal: SignalType) {
				if (stopped) return;
				stopped = true;
				settle(
					Object.freeze({
						code: signal === 'SIGKILL' ? 137 : 0,
						success: signal !== 'SIGKILL',
						signal: String(signal),
					}),
				);
			},
			isGone() {
				return stopped;
			},
		});
	}

	/** Closes any validation child server that remains after provider disposal. */
	async close(): Promise<void> {
		await Promise.allSettled(this.servers.map((server) => server[Symbol.asyncDispose]()));
	}
}

describe('activity engine provider conformance', () => {
	it('keeps the only Worker pool lease until cancelled activity cleanup has joined', async () => {
		await using owner = context.create({ id: 'provider-cleanup-owner' });
		await using first = context.child(owner, { id: 'provider-cleanup-first' });
		await using second = context.child(owner, { id: 'provider-cleanup-second' });
		await using remote = resource.create(resource.implementations(), { ctx: owner, host: {} });
		const started = Promise.withResolvers<void>();
		const disposing = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let executions = 0;
		let unfinished = 0;
		let maximum = 0;
		const implementation = activity.implement(Save, {
			async run(ctx) {
				executions++;
				unfinished++;
				maximum = Math.max(maximum, unfinished);
				ctx.defer(async () => {
					if (ctx.input.value === 'first') {
						disposing.resolve();
						await release.promise;
					}
					unfinished--;
				});
				if (ctx.input.value === 'first') {
					started.resolve();
					await context.observe(ctx.signal, new Promise<void>(() => {}));
				}
				return { stored: ctx.input.value };
			},
		});
		const servers: import('@okikio/worker/thread').WorkerServer[] = [];
		await using provider = await workers.create({
			ctx: owner,
			engine: Engine,
			activities: [Save],
			maximum: 1,
			module: new URL('file:///cleanup.ts'),
			shutdownMs: 10_000,
			create() {
				const pair = new PairedWorker();
				servers.push(
					workers.serve({ engine: Engine, implementations: [implementation], resources: remote, scope: pair.scope }),
				);
				return pair;
			},
		});
		const control: ActivityAttemptControl = { async heartbeat() {} };
		try {
			let settled = false;
			const pending = provider.run(first, attempt(first, 'first', 'first'), control).finally(() => {
				settled = true;
			});
			await started.promise;
			context.cancel(first, 'cancel first');
			await disposing.promise;
			const next = provider.run(second, attempt(second, 'second', 'second'), control);
			await new Promise<void>((resolve) => setTimeout(resolve, 0));
			expect(settled).toBe(false);
			expect(provider.stats()).toMatchObject({ leased: 1, idle: 0, waiting: 1 });
			expect(executions).toBe(1);
			release.resolve();
			expect((await pending).type).toBe('cancelled');
			expect(await next).toEqual({ type: 'success', value: { stored: 'second' } });
			expect(maximum).toBe(1);
		} finally {
			release.resolve();
			await provider[Symbol.asyncDispose]();
			await Promise.all(servers.map((server) => server[Symbol.asyncDispose]()));
		}
	});

	it('preserves permissions, effects, resources, and heartbeats through a local provider', async () => {
		await using ctx = context.create({ id: 'provider-local', clock: new context.TestClock() });
		const remote = resources(ctx);
		await using _collection = remote.collection;
		const host = services();
		const provider = local.create({
			engine: Engine,
			implementations: [SaveLive],
			resources: remote.collection,
			permission: host.checker,
			effect: host.emitter,
		});
		await verify(provider, ctx, host);
		await verifyFailure(provider, ctx, host);
		expect(remote.values).toEqual(['value']);
	});

	it('preserves the same semantics through a Worker provider and reverse calls', async () => {
		await using parent = context.create({ id: 'provider-worker-parent', clock: new context.TestClock() });
		await using remoteOwner = context.create({ id: 'provider-worker-remote', clock: new context.TestClock() });
		const remote = resources(remoteOwner);
		await using _collection = remote.collection;
		const host = services();
		const servers: import('@okikio/worker/thread').WorkerServer[] = [];
		const provider = await workers.create({
			ctx: parent,
			engine: Engine,
			activities: [Save],
			module: new URL('file:///activity-provider-test-worker.ts'),
			maximum: 1,
			permission: host.checker,
			effect: host.emitter,
			create() {
				const pair = new PairedWorker();
				servers.push(workers.serve({
					engine: Engine,
					implementations: [SaveLive],
					resources: remote.collection,
					scope: pair.scope,
				}));
				return pair;
			},
		});
		try {
			await verify(provider, parent, host);
			await verifyFailure(provider, parent, host);
			expect(remote.values).toEqual(['value']);
		} finally {
			await provider[Symbol.asyncDispose]();
			await Promise.allSettled(servers.map((server) => server[Symbol.asyncDispose]()));
		}
	});

	it('preserves the same semantics through a framed child-process provider', async () => {
		await using parent = context.create({ id: 'provider-process-parent', clock: new context.TestClock() });
		await using remoteOwner = context.create({ id: 'provider-process-remote', clock: new context.TestClock() });
		const remote = resources(remoteOwner);
		await using _collection = remote.collection;
		const adapter = new PairedProcessAdapter(remoteOwner, remote.collection);
		const host = services();
		const provider = await processes.create({
			ctx: parent,
			engine: Engine,
			activities: [Save],
			adapter,
			start: { command: 'activity-provider-test' },
			maximum: 1,
			permission: host.checker,
			effect: host.emitter,
		});
		try {
			await verify(provider, parent, host);
			await verifyFailure(provider, parent, host);
			expect(remote.values).toEqual(['value']);
		} finally {
			await provider[Symbol.asyncDispose]();
			await adapter.close();
		}
	});
});

it("retains thrown undefined from both providers' pool-lifetime disposal", async () => {
	await using owner = context.create({ id: 'provider-undefined-disposal' });
	let failUnlink = false;
	// No host is opened: fail only the borrowed signal's unlink during pool cleanup.
	const signal = new Proxy(owner.signal, {
		get(target, key) {
			if (key === 'removeEventListener') {
				return (...args: Parameters<AbortSignal['removeEventListener']>) => {
					target.removeEventListener(...args);
					if (failUnlink) throw undefined;
				};
			}
			const value: unknown = Reflect.get(target, key, target);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
	const ctx: context.Context = { ...owner, signal };
	await using remote = resource.create(resource.implementations(), { ctx: owner, host: {} });
	const adapter = new PairedProcessAdapter(owner, remote);
	const workerProvider = await workers.create({
		ctx,
		engine: Engine,
		activities: [Save],
		module: new URL('file:///unused-worker.ts'),
		maximum: 1,
	});
	const processProvider = await processes.create({
		ctx,
		engine: Engine,
		activities: [Save],
		adapter,
		start: { command: 'unused-process' },
		maximum: 1,
	});
	failUnlink = true;
	const outcomes = await Promise.all(
		[workerProvider, processProvider].map((provider) =>
			provider[Symbol.asyncDispose]().then(
				() => ({ rejected: false as const }),
				(error: unknown) => ({ rejected: true as const, error }),
			)
		),
	);
	for (const outcome of outcomes) {
		expect(outcome.rejected).toBe(true);
		if (!outcome.rejected) throw new Error('Expected pool disposal rejection.');
		expect(outcome.error).toBeInstanceOf(AggregateError);
		if (!(outcome.error instanceof AggregateError)) throw new Error('Expected provider cleanup aggregate.');
		expect(outcome.error.errors).toEqual([undefined]);
	}
});
