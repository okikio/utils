import * as placement from './placement.ts';
import type { ComputeType, EngineAffinityType } from './types.ts';
/** Run saved jobs in this worker. PostgreSQL keeps progress when the worker stops. @module */

import * as codec from '@okikio/schema/codec';
import { bind } from './engines.ts';
import type { EngineBinding } from './engines.ts';
import { TriggerEffect, TriggerSchema } from './trigger.ts';
import { ProgressEffect } from '@okikio/task';
import * as effects from '@okikio/capability/effect';
import type { EffectDefinition, EffectEmitter } from '@okikio/capability/effect';
import * as telemetry from '@okikio/telemetry/instrument';
import * as context from '@okikio/context';
import * as failures from '@okikio/result/failure';
import { elapsed } from '@okikio/duration';
import { temporal } from '@okikio/duration/temporal';
import type { ResourceCollection } from '@okikio/capability/resource';
import { observe, pause } from './client.ts';
import { wake } from './wake.ts';
import { replay } from './replay.ts';
import { address, decode, encode, ExecutionError, fingerprint, identity, PolicySchema } from './execution.ts';
import type {
	ActivationType,
	ExecutionStore,
	IntentType,
	JobType,
	LocalActivity,
	OutcomeType,
	PolicyType,
} from './execution.ts';
import { CancelledError, FaultError } from './errors.ts';
import { context as workflowContext } from './context.ts';
import { identify } from './instructions.ts';
import type { WorkflowCompletionAny, WorkflowImplementation, WorkflowInstruction } from './types.ts';

/** Explicit local execution assembly. The store and resource collection remain application-owned. */
export interface ServeOptions {
	/** Trusted registered compute path. Register one executor per exact placement target. */
	readonly compute?: ComputeType;
	/** Scalar host facts required by authored activities. */
	readonly affinity?: EngineAffinityType;
	/** Borrowed diagnostic instrument propagated through every local execution context. */
	readonly instrument?: telemetry.Instrument;
	/** Exact effects saved as progress. Other effects need the supplied emitter. */
	readonly progress?: readonly EffectDefinition[];
	/** Borrowed owner for business effects. Progress never silently consumes them. */
	readonly effect?: EffectEmitter;
	/** Borrowed saved-work store. The application keeps it open until this worker closes. */
	readonly store: ExecutionStore;
	/** Workflow programs this worker can run. Other workers can supply their activities and child workflows. */
	readonly workflows: readonly WorkflowImplementation[];
	/** Activity implementations this worker can run. Each implementation must allow the selected engine. */
	readonly activities: readonly LocalActivity[];
	/** Explicit local engine; placement never infers a subprocess or remote transport. */
	readonly engine?: { readonly kind: 'activity-engine'; readonly id: string };
	/** Borrowed resource collection; the application joins the host before closing it. */
	readonly resources: ResourceCollection;
	/** Borrowed process, thread, or custom providers. Each binding has an independent dispatch budget. */
	readonly engines?: readonly EngineBinding[];
	/**
	 * Policies this worker accepts. Only locally supplied implementations need matching resources and
	 * capabilities.
	 */
	readonly policies: readonly PolicyType[];
	/**
	 * Bound ordinary work while reserving separate slots for workflow advances, recovery scans, and exit
	 * activities.
	 */
	readonly capacity: {
		/** Maximum workflow programs advancing at once. Waiting steps release this slot. */
		readonly activations: number;
		/** Maximum ordinary activity attempts, including their unfinished cleanup. */
		readonly activities: number;
		/** Recovery scan loops. This profile requires exactly one. */
		readonly control: number;
		/** Maximum exit-recording activities, separate from ordinary activity capacity. */
		readonly finalizers: number;
	};
	/** Application-supplied ID of this worker registration. Simultaneous workers need distinct IDs. */
	readonly hostId: string;
	/** Stop taking new jobs and wait for running code and cleanup. Saved business work remains accepted. */
	readonly shutdown: AbortSignal;
	/** Maximum wait for drain(), in milliseconds; expiry leaves closed pending until actual cleanup. */
	readonly drainTimeoutMs?: number;
	/**
	 * Maximum idle scan interval. Saved deadlines and notifications can wake the worker sooner. Default:
	 * 1000 ms.
	 */
	readonly pollIntervalMs?: number;
	/** Application assertions about concrete external bindings, such as recipient idempotency. */
	readonly capabilities?: readonly string[];
	/** Explicit driver/transport fault classification. Unclassified faults are permanent. */
	readonly classify?: (reason: unknown) => 'transient' | 'permanent' | 'unknown';
}
/** Observe and stop this worker. Closed means every running attempt and its cleanup has finished. */
export interface Serving extends AsyncDisposable {
	/**
	 * Local admission counts include preflight and unfinished cleanup. Durable waits occupy no activation
	 * slot.
	 */
	state(): {
		readonly phase: 'running' | 'draining' | 'closed';
		readonly active: number;
		/** Store acquisition whose result still needs local ownership; zero or one for this serialized host. */
		readonly pendingClaims: number;
		readonly slots: {
			readonly activations: { readonly active: number; readonly capacity: number };
			readonly activities: { readonly active: number; readonly capacity: number };
			readonly finalizers: { readonly active: number; readonly capacity: number };
		};
		readonly engines: readonly {
			readonly id: string;
			readonly active: number;
			readonly capacity: number;
			readonly reserved: number;
		}[];
		readonly fault?: unknown;
	};
	/**
	 * Check schema, database access, current worker registration, and recent scan health before reporting
	 * readiness.
	 */
	check(
		options: { readonly signal: AbortSignal },
	): Promise<
		{ readonly ready: boolean; readonly phase: string; readonly reasons: readonly string[]; readonly checkedAt: string }
	>;
	/** Stop claiming and join work; timeout rejects without reporting a clean close. */
	drain(): Promise<void>;
	/**
	 * Settles after pending claims, active work and all cleanup join; rejects on terminal scan or release
	 * failure.
	 */
	readonly closed: Promise<void>;
}

/**
 * Start the worker that claims accepted jobs and runs explicitly registered code.
 *
 * Registration supplies implementations and the resources they may borrow; it does
 * not let the worker invent a missing definition version. The store grants temporary
 * claims before execution. Renewal keeps those claims live, and shutdown stops new
 * admission before waiting for active code and cleanup.
 *
 * The application owns process signals, logging configuration, the supplied store
 * and its database pool. This operation does not install or close those owners.
 */
export async function serve(input: ServeOptions): Promise<Serving> {
	const engines = (input.engines ?? []).map(bind);
	const remote = new Map(
		engines.flatMap((entry) => entry.activities.map((implementation) => [implementation.definition, entry] as const)),
	);
	const options = {
		...input,
		engine: input.engine ?? { kind: 'activity-engine' as const, id: 'workflow.coordinator' },
		activities: [...input.activities, ...engines.flatMap((entry) => entry.activities)],
		progress: [...new Set([ProgressEffect, ...(input.progress ?? [])])],
		workflows: [...input.workflows],
		policies: input.policies.map((entry) => PolicySchema.parse(entry)),
		capacity: { ...input.capacity },
		capabilities: [...(input.capabilities ?? [])],
	};
	const policies = new Set(await Promise.all(options.policies.map((entry) => fingerprint(entry))));
	for (const amount of Object.values(options.capacity)) {
		if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1024) {
			throw new RangeError('Host capacity must be 1..1024.');
		}
	}
	if (options.capacity.control !== 1) throw new RangeError('This local host uses exactly one control scan loop.');
	if (!options.hostId.trim()) throw new TypeError('hostId is required.');
	const drainTimeout = options.drainTimeoutMs ?? 30_000;
	if (!Number.isSafeInteger(drainTimeout) || drainTimeout < 1 || drainTimeout > 600_000) {
		throw new RangeError('Drain timeout must be 1..600000 ms.');
	}
	const pollInterval = options.pollIntervalMs ?? 1000;
	if (!Number.isSafeInteger(pollInterval) || pollInterval < 1 || pollInterval > 60_000) {
		throw new RangeError('Poll interval must be 1..60000 ms.');
	}
	options.shutdown.throwIfAborted();
	const activities = new Map(options.activities.map((entry) => [address(identity(entry.definition)), entry]));
	const workflows = new Map(options.workflows.map((entry) => [address(identity(entry.definition)), entry]));
	if (activities.size !== options.activities.length || workflows.size !== options.workflows.length) {
		throw new ExecutionError('duplicate_binding');
	}
	for (const entry of options.activities) {
		if (typeof entry.invoke !== 'function') throw new ExecutionError('activity_binding');
		if (
			!remote.has(entry.definition) &&
			!entry.definition.placement.choices.some((choice) => choice.engine.id === options.engine.id)
		) {
			throw new ExecutionError('engine_binding');
		}
		for (const definition of entry.definition.effects) {
			if (!options.progress?.includes(definition) && options.effect === undefined) {
				throw new ExecutionError('effect_binding', `Missing recipient for effect ${definition.id}.`);
			}
		}
		for (const resource of entry.definition.resources) {
			if (!remote.has(entry.definition) && !options.resources.has(resource)) {
				throw new ExecutionError('resource_binding', `Missing resource ${resource.id}.`);
			}
		}
	}
	for (const entry of options.workflows) {
		if (entry.definition.requirements.length > 0 || entry.definition.effects.length > 0) {
			throw new ExecutionError('unsupported_workflow_requirements');
		}
		// Remote code may be absent here. When it is supplied here, keep exact definition binding checks.
		for (const definition of entry.definition.activities) {
			const local = activities.get(address(identity(definition)));
			if (local !== undefined && local.definition !== definition) throw new ExecutionError('activity_binding');
		}
		for (const definition of entry.definition.workflows) {
			const local = workflows.get(address(identity(definition)));
			if (local !== undefined && local.definition !== definition) throw new ExecutionError('workflow_binding');
		}
	}
	const store = options.store;
	if (
		options.activities.some((entry) =>
			entry.definition.effects.some((definition) => options.progress.includes(definition))
		) &&
		(store.report === undefined || !store.capabilities.includes('effects.progress'))
	) {
		throw new ExecutionError('progress_binding', 'This store cannot save progress effects.');
	}
	const capabilities = new Set([...store.capabilities, ...(options.capabilities ?? [])]);
	for (const policy of options.policies) {
		for (const entry of [...policy.activities, ...policy.workflows]) {
			// A policy describes the complete run. This worker may supply only one part of that run.
			if (!(entry.definition.kind === 'activity' ? activities : workflows).has(address(entry.definition))) continue;
			if (
				entry.definition.kind === 'activity' &&
				remote.has(activities.get(address(entry.definition))?.definition as LocalActivity['definition']) &&
				entry.requires.some((name) => name === 'postgres.transactions' || name === 'postgres.receipts')
			) {
				throw new ExecutionError(
					'remote_transaction_binding',
					'Store write permission cannot cross a process or thread boundary. Bind a domain write service instead.',
				);
			}
			if (entry.requires.some((capability) => !capabilities.has(capability))) {
				throw new ExecutionError('capability_binding');
			}
		}
		for (const entry of policy.activities) {
			const local = activities.get(address(entry.definition));
			if (local !== undefined) compatible(local, entry, policy);
		}
		for (const entry of policy.finalizers) {
			const local = activities.get(address(entry.activity));
			if (local !== undefined) compatible(local, entry, policy);
		}
	}
	if (options.workflows.length && (!store.park || !store.verify)) {
		throw new ExecutionError(
			'capability_binding',
			'Saved workflow execution requires atomic parking and branch verification.',
		);
	}
	if (
		options.policies.some((policy) => policy.workflows.some((entry) => entry.requires.includes('workflow.cleanup'))) &&
		!store.cleanupScope
	) {
		throw new ExecutionError('capability_binding', 'Durable cleanup requires saved cleanup scopes.');
	}
	await store.check();
	const definitions = [...options.activities, ...options.workflows].map((entry) => identity(entry.definition));
	// Reserve at dispatch, before policy hashing or any other asynchronous preflight.
	// Provider invocation counters start too late to protect this admission decision.
	const admitted = new Map(engines.map((entry) => [entry, 0]));
	const eligible = (cleanup: boolean) =>
		options.activities
			.filter((entry) => {
				const provider = remote.get(entry.definition);
				return provider === undefined || admitted.get(provider)! <
						provider.binding.capacity - (cleanup ? 0 : provider.binding.reserved ?? 0);
			})
			.map((entry) => identity(entry.definition));
	const hostLease = 15_000;
	const host = await store.register(
		options.hostId,
		definitions,
		options.engine.id,
		{
			activations: options.capacity.activations,
			activities: options.capacity.activities + options.capacity.finalizers,
		},
		hostLease,
		{ compute: options.compute, affinity: options.affinity },
	);
	const control = new AbortController();
	const active = new Set<Promise<void>>();
	const joined = Promise.withResolvers<void>();
	void joined.promise.catch(() => {});
	let phase: 'running' | 'draining' | 'closed' = 'running';
	let fault: unknown;
	let loopFault: unknown;
	// Admission health and polling intervals use elapsed host time. Durable
	// claim expiry remains the store's job, independent of wall-clock adjustments.
	let checked = performance.now();
	const changes = wake();
	// Listen before the first scan. A reconnect also requests a fresh scan.
	let unsubscribe: (() => Promise<void>) | undefined;
	try {
		unsubscribe = await store.subscribe?.(changes.notify);
	} catch (error) {
		changes.close();
		try {
			await store.leave(host);
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Worker subscription and registration cleanup failed.');
		}
		throw error;
	}
	let renewing = performance.now();
	let scanAt = 0;
	// The first scan always recovers expired claims, even just after host startup.
	let recovered = Number.NEGATIVE_INFINITY;
	const recoverEvery = Math.min(...options.policies.map((entry) => entry.claims.recoverEveryMs), 60_000);
	let activationCount = 0;
	let activityCount = 0;
	let finalizerCount = 0;
	// A claim can commit while shutdown waits for its reply. Count the acquisition
	// through local launch so close cannot miss work between those two owners.
	let claiming = 0;
	const terminalErrors: unknown[] = [];
	// Own the entire attempt, including asynchronous preflight and cleanup. A
	// resolved business result alone must not release this admission slot.
	const launch = (work: Promise<void>, kind: 'activity' | 'activation' | 'finalizer') => {
		if (kind === 'activity') activityCount++;
		else if (kind === 'finalizer') finalizerCount++;
		else activationCount++;
		const owned = work.catch((error: unknown) => {
			fault = error;
		}).finally(() => {
			active.delete(owned);
			changes.notify();
			if (kind === 'activity') activityCount--;
			else if (kind === 'finalizer') finalizerCount--;
			else activationCount--;
		});
		active.add(owned);
	};
	/** One coordinator owns admission and releases the provider slot only after the whole attempt settles. */
	const launchJob = (job: JobType, kind: 'activity' | 'finalizer') => {
		const implementation = activities.get(address(job.definition));
		const provider = implementation === undefined ? undefined : remote.get(implementation.definition);
		if (provider !== undefined) admitted.set(provider, admitted.get(provider)! + 1);
		launch(
			attempt(job, options, capabilities, policies).finally(() => {
				if (provider !== undefined) admitted.set(provider, admitted.get(provider)! - 1);
			}),
			kind,
		);
	};
	/**
	 * One awaited scan loop prevents overlapping recovery scans and retains local capacity through actual
	 * settlement.
	 */
	const loop = (async () => {
		let errors = 0;
		try {
			while (!control.signal.aborted) {
				const version = changes.version;
				let delay = 0;
				try {
					if (performance.now() - renewing >= 1000) {
						await store.renewHost(host, hostLease);
						renewing = performance.now();
					}
					if (performance.now() < scanAt) {
						await changes.wait(version, Math.min(scanAt - performance.now(), 1000), control.signal);
						if (changes.version !== version) scanAt = 0;
						continue;
					}
					if (performance.now() - recovered >= recoverEvery) {
						await store.recover(64);
						recovered = performance.now();
					}
					let started = false;
					if (phase === 'running') {
						claiming++;
						try {
							if (activationCount < options.capacity.activations) {
								const activation = await store.activate(
									host,
									options.workflows.map((entry) => identity(entry.definition)),
								);
								if (activation !== undefined) {
									launch(
										advance(activation, workflows, capabilities, policies, store, telemetry.get(options)),
										'activation',
									);
									started = true;
								}
							}
							if (phase === 'running' && activityCount < options.capacity.activities) {
								const job = await store.take(host, eligible(false), false);
								if (job !== undefined) {
									launchJob(job, 'activity');
									started = true;
								}
							}
							if (phase === 'running' && finalizerCount < options.capacity.finalizers) {
								const job = await store.take(host, eligible(true), true);
								if (job !== undefined) {
									launchJob(job, 'finalizer');
									started = true;
								}
							}
						} finally {
							claiming--;
							if (phase !== 'running') changes.notify();
						}
					}
					const due = await store.next?.({
						workflows: phase === 'running' && activationCount < options.capacity.activations
							? options.workflows.map((entry) => identity(entry.definition))
							: [],
						activities: phase === 'running' && activityCount < options.capacity.activities ? eligible(false) : [],
						finalizers: phase === 'running' && finalizerCount < options.capacity.finalizers ? eligible(true) : [],
					});
					// A full recovery batch can leave more expired rows. Honor the accepted scan
					// spacing instead of spinning on that overdue deadline while still dispatching ready jobs.
					const recoveryDelay = Math.max(0, recovered + recoverEvery - performance.now());
					delay = started ? 0 : Math.min(pollInterval, due === 0 ? recoveryDelay : due ?? pollInterval);
					scanAt = performance.now() + delay;
					checked = performance.now();
					if (fault === loopFault) fault = undefined;
					loopFault = undefined;
					errors = 0;
				} catch (error) {
					fault = error;
					loopFault = error;
					if (++errors >= 12) throw error;
				}
				if (errors) await pause(Math.min(1000, 20 * 2 ** errors), control.signal);
				else {
					await changes.wait(version, Math.min(delay, 1000), control.signal);
					if (changes.version !== version) scanAt = 0;
				}
			}
		} catch (error) {
			if (!control.signal.aborted) {
				fault = error;
				terminalErrors.push(error);
				phase = 'draining';
			}
		}
	})();
	let closing: Promise<void> | undefined;
	/** Continue registration renewal while draining; borrowed resources cannot be closed before this join. */
	const close = (): Promise<void> => {
		if (closing !== undefined) return closing;
		phase = 'draining';
		changes.notify();
		closing = (async () => {
			while (claiming > 0 || active.size > 0) await changes.wait(changes.version, 1000, control.signal);
			control.abort();
			await loop;
			try {
				await unsubscribe?.();
			} catch (error) {
				terminalErrors.push(error);
			}
			changes.close();
			try {
				await store.leave(host);
			} catch (error) {
				terminalErrors.push(error);
			}
			phase = 'closed';
			options.shutdown.removeEventListener('abort', stop);
			if (terminalErrors.length === 1) throw terminalErrors[0];
			if (terminalErrors.length > 1) throw new AggregateError(terminalErrors, 'Worker shutdown failed.');
		})();
		// Every entry point shares the same result, including direct drain/disposal
		// and automatic closure after the scan loop exhausts its retry budget.
		void closing.then(joined.resolve, (error: unknown) => {
			fault = error;
			joined.reject(error);
		});
		return closing;
	};
	const stop = () => {
		void close();
	};
	void loop.then(() => {
		if (!control.signal.aborted) stop();
	});
	options.shutdown.addEventListener('abort', stop, { once: true });
	if (options.shutdown.aborted) stop();
	return Object.freeze({
		state: () =>
			Object.freeze({
				phase,
				active: active.size,
				pendingClaims: claiming,
				slots: Object.freeze({
					activations: Object.freeze({ active: activationCount, capacity: options.capacity.activations }),
					activities: Object.freeze({ active: activityCount, capacity: options.capacity.activities }),
					finalizers: Object.freeze({ active: finalizerCount, capacity: options.capacity.finalizers }),
				}),
				engines: Object.freeze(engines.map((entry) =>
					Object.freeze({
						id: entry.binding.engine.id,
						active: admitted.get(entry)!,
						capacity: entry.binding.capacity,
						reserved: entry.binding.reserved ?? 0,
					})
				)),
				...(fault === undefined ? {} : { fault }),
			}),
		closed: joined.promise,
		/**
		 * Check that the claim loop is progressing and storage can renew this host. Readiness reports
		 * admission capability, not completion of queued work.
		 */
		async check({ signal }: { readonly signal: AbortSignal }) {
			const reasons: string[] = [];
			if (phase !== 'running') reasons.push(phase);
			if (performance.now() - checked > Math.max(hostLease / 2, pollInterval * 2)) reasons.push('scan_stalled');
			if (fault !== undefined) reasons.push('loop_fault');
			try {
				signal.throwIfAborted();
				await observe(
					(async () => {
						await store.check(signal);
						signal.throwIfAborted();
						await store.renewHost(host, hostLease);
					})(),
					signal,
				);
				signal.throwIfAborted();
			} catch {
				reasons.push('authority_unavailable');
			}
			return Object.freeze({
				ready: reasons.length === 0,
				phase,
				reasons,
				checkedAt: temporal.Now.instant().toString({ smallestUnit: 'millisecond' }),
			});
		},
		async drain() {
			const timer = new AbortController();
			try {
				await Promise.race([
					close(),
					pause(drainTimeout, timer.signal).then(() => {
						throw new ExecutionError('drain_timeout');
					}),
				]);
			} finally {
				timer.abort();
			}
		},
		async [Symbol.asyncDispose]() {
			await close();
		},
	});
}

/**

 * Static activity resilience must describe the same persisted attempt policy; unsupported owners

 * cannot be ignored.

 */
function compatible(
	implementation: LocalActivity,
	rules: Pick<JobType['attempt'], 'maxAttempts' | 'deadlineMs' | 'retry' | 'delay'>,
	policy: PolicyType,
): void {
	for (const declaration of implementation.definition.resilience) {
		let matches = false;
		if (declaration.type === 'timeout') matches = elapsed(declaration.duration) === rules.deadlineMs;
		if (declaration.type === 'retry') {
			const transient = policy.failures.filter((entry) => entry.disposition === 'transient').map((entry) =>
				entry.definition
			).toSorted();
			matches = rules.retry === 'transient' && declaration.maximumAttempts === rules.maxAttempts &&
				elapsed(declaration.initialDelay) === rules.delay.initialMs &&
				elapsed(declaration.maximumDelay) === rules.delay.maximumMs && declaration.multiplier === 2 &&
				!declaration.jitter && (declaration.retryOn === undefined ||
					JSON.stringify([...declaration.retryOn].toSorted()) === JSON.stringify(transient));
		}
		if (!matches) {
			throw new ExecutionError(
				'resilience_binding',
				`Incompatible ${declaration.type} declaration on ${implementation.definition.id}.`,
			);
		}
	}
}

/**
 * Rebuild one workflow from saved step results, then stop at its first unfinished step.
 * Only activities perform external work. The generator must request the same steps during replay.
 * A saved wait releases this local advance without calling generator return/catch/finally.
 */
async function advanceWork(
	activation: ActivationType,
	workflows: ReadonlyMap<string, WorkflowImplementation>,
	capabilities: ReadonlySet<string>,
	policies: ReadonlySet<string>,
	store: ExecutionStore,
	instrument: telemetry.Instrument,
	observation: telemetry.Observation,
): Promise<void> {
	if (!policies.has(await fingerprint(activation.policy))) {
		await store.block(activation, 'policy_binding');
		return;
	}
	const implementation = workflows.get(address(activation.ref.definition));
	if (implementation === undefined) {
		await store.block(activation, 'missing_version');
		return;
	}
	const rules = activation.policy.workflows.find((entry) =>
		address(entry.definition) === address(activation.ref.definition)
	);
	if (rules === undefined || rules.requires.some((entry) => !capabilities.has(entry))) {
		await store.block(activation, 'capability_binding');
		return;
	}
	await using parent = context.create({ id: activation.ref.id, instrument });
	await using ctx = await workflowContext({
		definition: implementation.definition,
		input: decode(activation.input),
		runId: activation.ref.id,
		ctx: parent,
	});
	const program = implementation.program(ctx);
	const iterator = (activation.location === undefined ? program : placement.scope(activation.location, program))
		[Symbol.iterator]();
	// Only this activation can produce this sentinel, after its continuation has durably committed.
	const continued = new Error('The root workflow segment continued.');
	let count = 0;
	let renewal: Promise<void> | undefined;
	let lost: unknown;
	// Keep permission while rebuilding this turn, including slow storage calls.
	// Coalesce renewals so a delayed database cannot create overlapping renew requests.
	const timer = setInterval(() => {
		if (renewal !== undefined) return;
		renewal = store.renew(activation.claim).catch((error: unknown) => {
			lost = error;
		}).finally(() => {
			renewal = undefined;
		});
	}, activation.policy.claims.renewEveryMs);
	try {
		const result = await replay(iterator, {
			/**
			 * Save or reuse this instruction under the current activation claim. A missing completion leaves a
			 * saved wait for a later worker turn.
			 */
			async step(command, path, parent) {
				if (lost !== undefined) throw lost;
				if (parent === undefined && ++count > rules.maxInstructions) throw new ExecutionError('instruction_limit');
				if (command.type === 'continue') {
					if (parent !== undefined) {
						throw new ExecutionError(
							'continuation_scope',
							'Continue only from the root sequence after joining branches.',
						);
					}
					if (store.continue === undefined) throw new ExecutionError('continuation_binding');
					await store.continue(activation, {
						path,
						fingerprint: (await identify(command, path)).fingerprint,
						input: encode(
							await codec.write(
								implementation.definition.input,
								await codec.read(implementation.definition.input, command.input),
							),
							activation.policy.limits.inputBytes,
						),
					}, count);
					throw continued;
				}
				const intent = {
					...await plan(command, path, activation, implementation),
					...(parent === undefined ? {} : { parent }),
				};
				const outcome = await store.instruction(activation, intent, { park: false });
				return outcome === undefined ? undefined : await completion(command, outcome);
			},
			async close(parent) {
				return store.cleanupScope === undefined || await store.cleanupScope(activation, parent);
			},
			async verify(parent, instructions) {
				await store.verify!(activation, parent, instructions);
			},
			async choose(path, key) {
				if (!store.choose) throw new ExecutionError('unsupported_instruction');
				return await store.choose(activation, path, key);
			},
		});
		if (!result.done) {
			if (!store.park) throw new ExecutionError('unsupported_instruction');
			await store.park(activation, result.pending);
			return;
		}
		const value = await codec.write(implementation.definition.result, result.value);
		await store.finish(
			activation,
			{ type: 'success', value: encode(value, activation.policy.limits.resultBytes) },
			count,
		);
	} catch (error) {
		if (error === continued) return;
		observation.fail(error);
		if (error instanceof ExecutionError && error.code === 'stale_claim') return;
		if (error instanceof ExecutionError) {
			await store.block(activation, error.code);
			return;
		}
		await store.finish(activation, await failure(error), count);
	} finally {
		clearInterval(timer);
		await renewal;
	}
}

/**

 * Restore checked values and declared failures through the same public operation protocol as local

 * execution.

 */
async function completion(command: WorkflowInstruction, outcome: OutcomeType): Promise<WorkflowCompletionAny> {
	if (outcome.type === 'fault') return { type: 'fault', fault: outcome };
	if (outcome.type === 'cancelled') return { type: 'cancelled', reason: outcome.reason };
	if (outcome.type === 'failure') {
		const definitions = command.type === 'activity'
			? command.activity.failures
			: command.type === 'child-workflow'
			? command.workflow.failures
			: [];
		const definition = definitions.find((entry) => entry.id === outcome.id);
		if (!definition) throw new ExecutionError('failure_binding');
		return {
			type: 'failure',
			failure: await failures.create(definition, { data: outcome.data, message: outcome.message }),
		};
	}
	let value = decode(outcome.value);
	if (command.type === 'activity') value = await codec.read(command.activity.result, value);
	if (command.type === 'child-workflow' && command.options.result !== 'discard') {
		value = await codec.read(command.workflow.result, value);
	}
	if (command.type === 'sleep') value = temporal.Instant.from(value as string);
	if (command.type === 'wait-event') {
		const event = value as { type: 'received'; value: unknown } | { type: 'timeout' };
		if (event.type === 'received') {
			value = { type: 'received', value: await codec.read(command.event.value, event.value) };
		}
	}
	return { type: 'success', value };
}

/** Check that the program declared this step. Its implementation can live in another worker. */
async function plan(
	command: WorkflowInstruction,
	path: string,
	run: ActivationType,
	owner: WorkflowImplementation,
): Promise<IntentType> {
	const base = { path, fingerprint: (await identify(command, path)).fingerprint };
	if (command.category === 'control') {
		return {
			...base,
			type: 'control',
			...(command.type === 'race' ? { branches: Object.keys(command.operations) } : {}),
		};
	}
	if (command.type === 'defer') {
		if (
			!run.policy.workflows.find((entry) => address(entry.definition) === address(run.ref.definition))?.requires
				.includes('workflow.cleanup')
		) {
			throw new ExecutionError('cleanup_policy', 'Declare workflow.cleanup to reserve durable cleanup capacity.');
		}
		return { ...base, type: 'defer', cleanup: await plan(command.cleanup, `${path}/cleanup`, run, owner) };
	}
	if (command.type === 'activity') {
		if (!owner.definition.activities.includes(command.activity)) throw new ExecutionError('activity_binding');
		return {
			...base,
			type: 'activity',
			...(command.options.location === undefined ? {} : { location: command.options.location }),
			...(command.options.affinity === undefined ? {} : { affinity: command.options.affinity }),
			definition: identity(command.activity),
			input: encode(
				await codec.write(command.activity.input, await codec.read(command.activity.input, command.input)),
				run.policy.limits.inputBytes,
			),
		};
	}
	if (command.type === 'child-workflow') {
		if (!owner.definition.workflows.includes(command.workflow)) throw new ExecutionError('workflow_binding');
		return {
			...base,
			type: 'child-workflow',
			...(command.options.location === undefined ? {} : { location: command.options.location }),
			definition: identity(command.workflow),
			input: encode(
				await codec.write(command.workflow.input, await codec.read(command.workflow.input, command.input)),
				run.policy.limits.inputBytes,
			),
			discard: command.options.result === 'discard',
			cancellation: command.options.cancellation ?? 'follow-parent',
		};
	}
	if (command.type === 'effect' && command.effect === TriggerEffect) {
		const request = TriggerSchema.parse(command.value);
		const declarations = request.definition.kind === 'activity'
			? owner.definition.activities
			: owner.definition.workflows;
		const definition = declarations.find((entry) => address(identity(entry)) === address(request.definition));
		if (!definition) throw new ExecutionError('trigger_binding');
		return {
			...base,
			type: 'child-workflow',
			definition: request.definition,
			input: encode(
				await codec.write(definition.input, await codec.read(definition.input, request.input)),
				run.policy.limits.inputBytes,
			),
			discard: true,
			cancellation: 'independent',
		};
	}
	if (command.type === 'wait-event') {
		return {
			...base,
			type: 'wait-event',
			event: command.event.id,
			eventKey: command.eventKey,
			...(command.until === undefined ? {} : { due: command.until }),
		};
	}
	if (command.type === 'sleep') {
		const delay = elapsed(command.duration);
		if (!Number.isFinite(delay) || delay < 0) throw new ExecutionError('timer_duration');
		return { ...base, type: 'sleep', delay };
	}
	if (command.type === 'sleep-until') return { ...base, type: 'sleep-until', due: command.until };
	throw new ExecutionError('unsupported_instruction', `Durable PostgreSQL execution does not support ${command.type}.`);
}

/**
 * Run one activity and renew its temporary permission until completion, replacement, or deadline.
 * The activity owns validation and cleanup. Keep this worker slot until that cleanup actually finishes.
 * PostgreSQL accepts the result only if this attempt still has permission.
 */
async function attemptWork(
	job: JobType,
	options: ServeOptions,
	capabilities: ReadonlySet<string>,
	policies: ReadonlySet<string>,
	observation: telemetry.Observation,
): Promise<void> {
	if (!policies.has(await fingerprint(job.policy))) {
		await options.store.complete(job, {
			type: 'fault',
			code: 'policy_binding',
			message: 'Accepted policy is not registered in this host.',
		}, 'unknown');
		return;
	}
	const implementation = options.activities.find((entry) =>
		address(identity(entry.definition)) === address(job.definition)
	);
	if (implementation === undefined || job.attempt.requires.some((entry) => !capabilities.has(entry))) {
		await options.store.complete(job, {
			type: 'fault',
			code: 'capability_binding',
			message: 'Required execution binding is unavailable.',
		}, 'unknown');
		return;
	}
	const cancellation = new AbortController();
	await using ctx = context.create({
		id: job.claim.jobId,
		signal: cancellation.signal,
		instrument: telemetry.get(options),
	});
	const deadline = setTimeout(() => cancellation.abort(new ExecutionError('attempt_deadline')), job.attempt.deadlineMs);
	let renewal: Promise<void> | undefined;
	const timer = setInterval(() => {
		if (renewal !== undefined || cancellation.signal.aborted) return;
		renewal = options.store.renew(job.claim).catch((error: unknown) => cancellation.abort(error)).finally(() => {
			renewal = undefined;
		});
	}, job.policy.claims.renewEveryMs);
	try {
		let sequence = 0;
		const emitter: EffectEmitter = {
			async emit(ctx, occurrence) {
				if (options.progress?.includes(occurrence.definition)) {
					if (options.store.report === undefined) throw new ExecutionError('progress_binding');
					await options.store.report(job.claim, await effects.encode(occurrence), ++sequence);
				} else {
					if (options.effect === undefined) throw new effects.MissingEffectEmitterError();
					await options.effect.emit(ctx, occurrence);
				}
			},
		};
		const value = await implementation.invoke({
			effect: emitter,
			ctx,
			engine: options.engine ?? { kind: 'activity-engine', id: 'workflow.coordinator' },
			resources: options.resources,
			input: decode(job.input),
			jobId: job.claim.jobId,
			location: job.location,
			attempt: job.claim.sequence,
			claim: job.claim,
			origin: job.path === undefined || job.fingerprint === undefined ? undefined : {
				workflowId: job.ref.definition.id,
				workflowVersion: job.ref.definition.version,
				runId: job.ref.id,
				instructionPath: job.path,
				instructionFingerprint: job.fingerprint,
			},
			heartbeat: async () => {
				cancellation.signal.throwIfAborted();
				await options.store.renew(job.claim);
			},
		});
		cancellation.signal.throwIfAborted();
		await options.store.complete(
			job,
			{
				type: 'success',
				value: encode(await codec.write(implementation.definition.result, value), job.policy.limits.resultBytes),
			},
			'permanent',
		);
	} catch (error) {
		observation.fail(error);
		const outcome = await failure(error);
		const known = outcome.type === 'failure'
			? job.policy.failures.find((entry) => entry.definition === outcome.id)?.disposition
			: undefined;
		try {
			await options.store.complete(
				job,
				outcome,
				known ??
					(error instanceof ExecutionError && error.code === 'engine_lost'
						? (job.attempt.recovery === 'retry' ? 'transient' : 'unknown')
						: options.classify?.(error) ?? 'permanent'),
			);
		} catch (rejected) {
			if (!(rejected instanceof ExecutionError && rejected.code === 'stale_claim')) throw rejected;
		}
	} finally {
		clearTimeout(deadline);
		clearInterval(timer);
		await renewal;
	}
}

/** Persist declared failure data and a bounded safe message; diagnostic causes remain local. */
async function failure(reason: unknown): Promise<OutcomeType> {
	if (reason instanceof CancelledError) return { type: 'cancelled', reason: reason.message };
	if (reason instanceof FaultError) {
		const fault = reason.fault;
		if (fault !== null && typeof fault === 'object' && 'type' in fault && fault.type === 'fault') {
			return fault as Extract<OutcomeType, { type: 'fault' }>;
		}
		reason = fault;
	}
	if (failures.isOccurrence(reason)) {
		const encoded = await failures.encode(reason);
		const data = encode(encoded.data, 65_536);
		return {
			type: 'failure',
			id: encoded.id,
			data: data.kind === 'value' ? data.value : null,
			message: encoded.message.slice(0, 2048),
		};
	}
	return {
		type: 'fault',
		code: reason instanceof ExecutionError ? reason.code : 'activity_fault',
		message: reason instanceof Error ? reason.message.slice(0, 2048) : 'Activity failed.',
	};
}

/** Correlate one short replay advance. Dormant waits end this span and release worker capacity. */
async function advance(
	activation: ActivationType,
	workflows: ReadonlyMap<string, WorkflowImplementation>,
	capabilities: ReadonlySet<string>,
	policies: ReadonlySet<string>,
	store: ExecutionStore,
	instrument: telemetry.Instrument,
): Promise<void> {
	await instrument.span(
		'workflow.advance',
		{ run_id: activation.ref.id, definition: activation.ref.definition.id },
		(observation) => advanceWork(activation, workflows, capabilities, policies, store, instrument, observation),
		activation.trace,
	);
}

/** A replacement has a distinct span and attempt identity while retaining the original trace and job. */
async function attempt(
	job: JobType,
	options: ServeOptions,
	capabilities: ReadonlySet<string>,
	policies: ReadonlySet<string>,
): Promise<void> {
	const instrument = telemetry.get(options);
	await instrument.span('workflow.attempt', {
		run_id: job.ref.id,
		job_id: job.claim.jobId,
		attempt: job.claim.sequence,
		definition: job.definition.id,
	}, async (observation) => {
		if (job.claim.sequence > 1) {
			instrument.notice('workflow.attempt.retried', {
				run_id: job.ref.id,
				job_id: job.claim.jobId,
				attempt: job.claim.sequence,
			});
		}
		await attemptWork(job, options, capabilities, policies, observation);
	}, job.trace);
}
