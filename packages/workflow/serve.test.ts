/** Coordinator admission is separate from provider invocation and includes asynchronous preflight. @module */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as schema from '@okikio/schema';
import * as workflow from '@okikio/workflow';
import { encode, identity } from './execution.ts';
import type { ExecutionStore, JobType } from './execution.ts';

const Engine = engine.define({ id: 'coordinator.capacity' });
const TextSchema = schema.string();
const Work = activity.define({
	id: 'coordinator.work',
	version: '1',
	input: TextSchema,
	result: TextSchema,
	placement: engine.require(Engine),
});
const Policy = workflow.PolicySchema.parse({
	id: 'coordinator',
	version: '1',
	limits: {
		inputBytes: 1024,
		resultBytes: 1024,
		historyBytes: 4096,
		pendingRoots: 4,
		reservedSuccessors: 0,
		pendingChildren: 0,
		pendingFinalizers: 0,
	},
	claims: { leaseMs: 1000, renewEveryMs: 100, recoverEveryMs: 25 },
	activities: [{
		definition: Work,
		maxAttempts: 1,
		deadlineMs: 5000,
		recovery: 'retry',
		retry: 'never',
		delay: { initialMs: 1, maximumMs: 1 },
		requires: [],
	}],
	workflows: [],
	successors: [],
	finalizers: [],
	retention: { dedupeMs: 1000, resultsMs: 1000, auditMs: 1000 },
});

/** The fake queue isolates local admission timing; PostgreSQL recovery is covered by the integration suites. */
function queue(jobs: JobType[], completed: string[]): ExecutionStore {
	const unused = async (): Promise<never> => {
		throw new Error('Unexpected workflow operation.');
	};
	return {
		namespace: 'capacity',
		capabilities: ['effects.progress'],
		accept: unused,
		get: unused,
		cancel: unused,
		repair: unused,
		instruction: unused,
		finish: unused,
		block: unused,
		async check() {},
		async register() {
			return { id: 'host', generation: 1 };
		},
		async renewHost() {},
		async leave() {},
		async activate() {
			return undefined;
		},
		async take(_host, definitions, finalizer) {
			return finalizer || definitions.length === 0 ? undefined : jobs.shift();
		},
		async renew() {},
		async recover() {},
		async report() {},
		async complete(job) {
			completed.push(job.claim.jobId);
		},
		async [Symbol.asyncDispose]() {},
	};
}

/** Observe an actual asynchronous transition without choosing a fixed scheduler delay. */
async function until(read: () => boolean): Promise<void> {
	const deadline = Date.now() + 2000;
	while (!read()) {
		if (Date.now() >= deadline) throw new Error('Expected coordinator state did not appear.');
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
}

/** A single already-claimed attempt lets barriers exercise shutdown independently of database timing. */
function claimed(): JobType {
	const run = crypto.randomUUID(), job = crypto.randomUUID();
	return {
		ref: { id: run, namespace: 'capacity', scope: 'test', definition: identity(Work) },
		claim: { runId: run, jobId: job, generation: 1, epoch: 1, sequence: 1, hostId: 'host', hostGeneration: 1 },
		input: encode('held', 1024),
		policy: Policy,
		definition: identity(Work),
		attempt: Policy.activities[0]!,
		path: 'root',
		fingerprint: 'saved',
	};
}

describe('durable worker capacity', () => {
	it('uses elapsed host time for scan health while keeping a wall-time observation timestamp', async () => {
		await using ctx = context.create({ id: 'coordinator-monotonic' });
		await using resources = resource.create(resource.implementations(), { ctx, host: {} });
		const store = queue([], []);
		const scanned = Promise.withResolvers<void>();
		let recoveries = 0;
		store.recover = async () => {
			recoveries++;
		};
		store.next = async () => {
			scanned.resolve();
			return undefined;
		};
		const originalPerformance = Object.getOwnPropertyDescriptor(performance, 'now');
		const now = Date.now;
		const wall = now();
		let elapsed = 0;
		Object.defineProperty(performance, 'now', { configurable: true, value: () => elapsed });
		let worker: Awaited<ReturnType<typeof workflow.serve>> | undefined;
		try {
			worker = await workflow.serve({
				store,
				workflows: [],
				activities: [],
				engine: Engine,
				resources,
				policies: [Policy],
				hostId: 'host',
				shutdown: new AbortController().signal,
				pollIntervalMs: 1000,
				capacity: { activations: 1, activities: 1, control: 1, finalizers: 1 },
			});
			await scanned.promise;
			expect(recoveries).toBe(1);
			Date.now = () => wall + 86_400_000;
			const fresh = await worker.check({ signal: new AbortController().signal });
			expect(fresh.ready).toBe(true);
			expect(fresh.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
			Date.now = () => wall - 86_400_000;
			elapsed = 8000;
			const stalled = await worker.check({ signal: new AbortController().signal });
			expect(stalled.reasons).toContain('scan_stalled');
		} finally {
			Date.now = now;
			if (originalPerformance === undefined) Reflect.deleteProperty(performance, 'now');
			else Object.defineProperty(performance, 'now', originalPerformance);
			await worker?.drain();
		}
	});
	it('reserves provider capacity before asynchronous policy validation and retains it through settlement', async () => {
		await using ctx = context.create({ id: 'capacity' });
		await using resources = resource.create(resource.implementations(), { ctx, host: {} });
		const pending = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
		const queued: JobType[] = [0, 1].map((index) => {
			const run = crypto.randomUUID(), job = crypto.randomUUID();
			return {
				ref: { id: run, namespace: 'capacity', scope: 'test', definition: identity(Work) },
				claim: { runId: run, jobId: job, generation: 1, epoch: 1, sequence: 1, hostId: 'host', hostGeneration: 1 },
				input: encode(String(index), 1024),
				policy: Policy,
				definition: identity(Work),
				attempt: Policy.activities[0]!,
				path: 'root',
				fingerprint: 'saved',
			};
		});
		const completed: string[] = [], started: string[] = [];
		const shutdown = new AbortController();
		const worker = await workflow.serve({
			store: queue(queued, completed),
			workflows: [],
			activities: [],
			resources,
			policies: [Policy],
			hostId: 'host',
			shutdown: shutdown.signal,
			pollIntervalMs: 5,
			capacity: { activations: 1, activities: 4, control: 1, finalizers: 1 },
			engines: [{
				engine: Engine,
				capacity: 1,
				provider: {
					activities: [Work],
					async run(_ctx, attempt) {
						const index = Number(attempt.input);
						started.push(String(index));
						await pending[index]!.promise;
						return { type: 'success', value: String(index) };
					},
				},
			}],
		});
		try {
			await until(() => started.length > 0);
			// The first provider remains live across several complete coordinator scans.
			await new Promise((resolve) => setTimeout(resolve, 30));
			expect(started).toEqual(['0']);
			expect(queued).toHaveLength(1);
			expect(worker.state().slots.activities).toEqual({ active: 1, capacity: 4 });
			expect(worker.state().engines).toEqual([{ id: Engine.id, active: 1, capacity: 1, reserved: 0 }]);
			pending[0]!.resolve();
			await until(() => started.length === 2);
			expect(completed).toHaveLength(1);
			pending[1]!.resolve();
			await until(() => completed.length === 2);
		} finally {
			for (const gate of pending) gate.resolve();
			shutdown.abort();
			await worker.closed;
		}
	});
});

describe('durable worker shutdown', () => {
	it('joins a claim already in flight before leaving registration or reporting closed', async () => {
		await using ctx = context.create({ id: 'claim-shutdown' });
		await using resources = resource.create(resource.implementations(), { ctx, host: {} });
		const taking = Promise.withResolvers<void>();
		const releaseClaim = Promise.withResolvers<void>();
		const started = Promise.withResolvers<void>();
		const releaseWork = Promise.withResolvers<void>();
		const completed = Promise.withResolvers<void>();
		const order: string[] = [];
		const takes: boolean[] = [];
		const store = queue([], []);
		let taken = false;
		store.take = async (_host, _definitions, finalizer) => {
			takes.push(finalizer ?? false);
			if (taken || finalizer) return undefined;
			taken = true;
			taking.resolve();
			await releaseClaim.promise;
			return claimed();
		};
		store.complete = async () => {
			order.push('complete');
			completed.resolve();
		};
		store.leave = async () => {
			order.push('leave');
		};
		const worker = await workflow.serve({
			store,
			workflows: [],
			activities: [{
				definition: Work,
				async invoke() {
					order.push('start');
					started.resolve();
					await releaseWork.promise;
					return 'held';
				},
			}],
			engine: Engine,
			resources,
			policies: [Policy],
			hostId: 'host',
			shutdown: new AbortController().signal,
			capacity: { activations: 1, activities: 1, control: 1, finalizers: 1 },
		});
		try {
			await taking.promise;
			const draining = worker.drain();
			expect(worker.state()).toMatchObject({ phase: 'draining', active: 0, pendingClaims: 1 });
			releaseClaim.resolve();
			await started.promise;
			// Let the shutdown continuation run while the attempt remains deliberately held.
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(worker.state()).toMatchObject({ phase: 'draining', active: 1, pendingClaims: 0 });
			expect(order).toEqual(['start']);
			expect(takes).toEqual([false]);
			releaseWork.resolve();
			await draining;
			await worker.closed;
			expect(order).toEqual(['start', 'complete', 'leave']);
		} finally {
			releaseClaim.resolve();
			releaseWork.resolve();
			await completed.promise;
			await worker.drain();
		}
	});

	it('does not acquire activities after a pending empty activation returns during drain', async () => {
		await using ctx = context.create({ id: 'activation-shutdown' });
		await using resources = resource.create(resource.implementations(), { ctx, host: {} });
		const activating = Promise.withResolvers<void>();
		const releaseActivation = Promise.withResolvers<void>();
		const store = queue([], []);
		let takes = 0;
		store.activate = async () => {
			activating.resolve();
			await releaseActivation.promise;
			return undefined;
		};
		store.take = async () => {
			takes++;
			return undefined;
		};
		const worker = await workflow.serve({
			store,
			workflows: [],
			activities: [],
			resources,
			policies: [],
			hostId: 'host',
			shutdown: new AbortController().signal,
			capacity: { activations: 1, activities: 1, control: 1, finalizers: 1 },
		});
		await activating.promise;
		const draining = worker.drain();
		releaseActivation.resolve();
		await draining;
		expect(takes).toBe(0);
	});

	for (const action of ['drain', 'dispose'] as const) {
		it(`${action} attempts every release and rejects closed with the same retained cleanup failures`, async () => {
			await using ctx = context.create({ id: `cleanup-${action}` });
			await using resources = resource.create(resource.implementations(), { ctx, host: {} });
			const notificationFailure = new Error('Notification release failed.');
			const registrationFailure = new Error('Registration release failed.');
			const released: string[] = [];
			const store = queue([], []);
			store.subscribe = async () => async () => {
				released.push('notification');
				throw notificationFailure;
			};
			store.leave = async () => {
				released.push('registration');
				throw registrationFailure;
			};
			const shutdown = new AbortController();
			const worker = await workflow.serve({
				store,
				workflows: [],
				activities: [],
				resources,
				policies: [],
				hostId: 'host',
				shutdown: shutdown.signal,
				capacity: { activations: 1, activities: 1, control: 1, finalizers: 1 },
			});
			try {
				const closing = action === 'drain' ? worker.drain() : worker[Symbol.asyncDispose]();
				const error = await closing.then(() => undefined, (reason: unknown) => reason);
				expect(error).toBeInstanceOf(AggregateError);
				expect((error as AggregateError).errors).toEqual([notificationFailure, registrationFailure]);
				expect(released).toEqual(['notification', 'registration']);
				await expect(worker.closed).rejects.toBe(error);
				await expect(worker.drain()).rejects.toBe(error);
				expect(worker.state()).toMatchObject({ phase: 'closed', active: 0, fault: error });
				expect(released).toHaveLength(2);
			} finally {
				shutdown.abort();
				await worker.closed.catch(() => {});
			}
		});
	}

	it('retains setup and registration-release errors when notification subscription fails', async () => {
		await using ctx = context.create({ id: 'setup-failure' });
		await using resources = resource.create(resource.implementations(), { ctx, host: {} });
		const setupFailure = new Error('Subscription failed.');
		const releaseFailure = new Error('Registration release failed.');
		const store = queue([], []);
		store.subscribe = async () => {
			throw setupFailure;
		};
		store.leave = async () => {
			throw releaseFailure;
		};
		const error = await workflow.serve({
			store,
			workflows: [],
			activities: [],
			resources,
			policies: [],
			hostId: 'host',
			shutdown: new AbortController().signal,
			capacity: { activations: 1, activities: 1, control: 1, finalizers: 1 },
		}).then(() => undefined, (reason: unknown) => reason);
		expect(error).toBeInstanceOf(AggregateError);
		expect((error as AggregateError).errors).toEqual([setupFailure, releaseFailure]);
	});

	it('closes itself after the scan retry budget is exhausted and exposes the terminal fault', async () => {
		await using ctx = context.create({ id: 'scan-failure' });
		await using resources = resource.create(resource.implementations(), { ctx, host: {} });
		const failure = new Error('Storage remains unavailable.');
		const store = queue([], []);
		const shutdown = new AbortController();
		let scans = 0, leaves = 0;
		store.recover = async () => {
			scans++;
			throw failure;
		};
		store.leave = async () => {
			leaves++;
		};
		const worker = await workflow.serve({
			store,
			workflows: [],
			activities: [],
			resources,
			policies: [],
			hostId: 'host',
			shutdown: shutdown.signal,
			capacity: { activations: 1, activities: 1, control: 1, finalizers: 1 },
		});
		const timeout = setTimeout(() => shutdown.abort(new Error('Test timeout.')), 12_000);
		try {
			await expect(worker.closed).rejects.toBe(failure);
			expect(scans).toBe(12);
			expect(leaves).toBe(1);
			expect(worker.state()).toMatchObject({ phase: 'closed', active: 0, fault: failure });
			expect(shutdown.signal.aborted).toBe(false);
		} finally {
			clearTimeout(timeout);
			shutdown.abort();
			await worker.closed.catch(() => {});
		}
	});
});
