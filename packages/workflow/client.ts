import * as placement from './placement.ts';
/** Accept and inspect saved work. Creating a client borrows its store and starts no worker. @module */

import * as codec from '@okikio/schema/codec';
import * as effects from '@okikio/capability/effect';
import { TriggerEffect, TriggerSchema } from './trigger.ts';
import { Observable } from '@okikio/observables/observable';
import type { WorkflowSignal } from './types.ts';
import type { ProgressType } from './execution.ts';
import * as telemetry from '@okikio/telemetry/instrument';
import {
	address,
	ControlOptionsSchema,
	ControlSchema,
	decode,
	encode,
	ExecutionError,
	fingerprint,
	identity,
	policy as snapshotPolicy,
	ReferenceSchema,
} from './execution.ts';
import type {
	Claim,
	ControlOptions,
	ControlType,
	DefinitionType,
	ExecutionStore,
	InputType,
	PolicyType,
	ReferenceType,
	SnapshotType,
	ValueType,
} from './execution.ts';

/** Scoped dedupe identity. Reusing the key with changed input, version, or policy is a conflict. */
export interface SubmitType {
	/** Required compute scope for all nested activity work; saved with admission identity. */
	readonly location?: placement.SelectionType;
	/** Application-authorized tenant or domain scope, included in dedupe and lookups. */
	readonly scope: string;
	/** Stable scoped command or write key; changed content under the key conflicts. */
	readonly key: string;
}
/** Storage operations needed to accept and inspect work. No worker operations are required. */
export interface ClientStore
	extends Pick<ExecutionStore, 'namespace' | 'accept' | 'get' | 'cancel' | 'repair' | 'send' | 'pause' | 'resume'> {}

/** Supply a borrowed store and a saved policy. Creating the client needs no running worker. */
export interface ClientOptions {
	/** Borrowed diagnostic instrument. Omit to keep execution observationally silent. */
	readonly instrument?: telemetry.Instrument;
	/** Borrowed saved-work store. Creating the client does not start a worker. */
	readonly store: ClientStore;
	/** Copy of the accepted rules. A later deployment cannot silently change this run's retry limits. */
	readonly policy: PolicyType;
}
/** Accept work, optionally inside a native transaction registered by the adapter. */
export interface Admission {
	/** Validate and save work. Returns after durable acceptance, without starting a worker. */
	trigger<D extends DefinitionType>(definition: D, input: InputType<D>, options: SubmitType): Promise<ReferenceType>;
	/** Validate and save an activity or workflow request. Return its reference after acceptance commits. */
	submit<D extends DefinitionType>(definition: D, input: InputType<D>, options: SubmitType): Promise<ReferenceType>;
}
/** Client for accepting and inspecting work without starting a worker or acquiring its resources. */
export interface ClientType extends Admission {
	/** Route background trigger effects into this durable client. Scope is application-authorized. */
	effects(options: { readonly scope: string }): effects.EffectEmitter;
	/**
	 * Validate and save an event for one run and logical wait key. Same value is idempotent; changed
	 * value conflicts.
	 */
	send<Value>(
		ref: ReferenceType,
		event: WorkflowSignal<Value>,
		value: Value,
		options?: { readonly key: string },
	): Promise<void>;
	/** Poll saved progress snapshots. Unsubscribe or abort to stop observing, never to cancel work. */
	watch(
		ref: ReferenceType,
		options?: { readonly signal?: AbortSignal; readonly intervalMs?: number; readonly children?: boolean },
	): Observable<ProgressType>;
	/** Use the registered outer transaction. This client view does not open or commit it. */
	in(tx: unknown, options?: { readonly claim: Claim | undefined }): Admission;
	/** Read one physical segment, or follow a bounded continuation chain when follow is true. */
	get<D extends DefinitionType>(
		definition: D,
		ref: ReferenceType,
		options?: { readonly children?: boolean; readonly follow?: boolean },
	): Promise<SnapshotType & { readonly value?: ValueType<D> }>;
	/**
	 * Follow bounded continuation links to a result or failed, cancelled, or blocked state. Aborting
	 * stops only this observer.
	 */
	wait<D extends DefinitionType>(
		definition: D,
		ref: ReferenceType,
		options: { readonly signal: AbortSignal; readonly intervalMs?: number },
	): Promise<ValueType<D>>;
	/** Request cancellation of unfinished work. Return too_late if the run already has an intended exit. */
	cancel(ref: ReferenceType, reason: string): Promise<'requested' | 'too_late'>;
	/**
	 * Persist a run-local admission pause with operator attribution. Active attempts keep their current
	 * permission.
	 */
	pause(ref: ReferenceType, options: ControlOptions): Promise<ControlType>;
	/** Resume admission at the inspected control revision. Blocked work still requires repair. */
	resume(ref: ReferenceType, options: ControlOptions): Promise<ControlType>;
	/**
	 * Record the operator and reason, invalidate prior attempt permission, and grant a bounded number of
	 * extra tries.
	 */
	repair(
		ref: ReferenceType,
		options: { readonly actor: string; readonly reason: string; readonly epoch: number; readonly attempts: number },
	): Promise<void>;
}
/** Terminal or blocked state retained with the error for callers and operators. */
export class ExitError extends ExecutionError {
	/** Authoritative snapshot at the failed observation. */
	readonly snapshot: SnapshotType;
	/** Retain the structured outcome instead of relying on an error message. */
	constructor(snapshot: SnapshotType) {
		super(snapshot.state, `Execution is ${snapshot.state}.`);
		this.name = 'ExitError';
		this.snapshot = snapshot;
	}
}
/** Create a client without starting work. Copy its policy now and save that copy with accepted commands. */
export function client(options: ClientOptions): ClientType {
	const policy = snapshotPolicy(options.policy);
	const instrument = telemetry.get(options);
	const store = options.store;
	const admission = (tx?: unknown, claim?: Claim): Admission => {
		const result = {
			/**
			 * Validate one accepted command and save its exact definition, policy and duplicate key together. A
			 * returned reference identifies saved work, not a finished result.
			 */
			async trigger<D extends DefinitionType>(
				definition: D,
				input: InputType<D>,
				key: SubmitType,
			): Promise<ReferenceType> {
				return await instrument.span('workflow.submit', { definition: definition.id }, async () => {
					if (
						!key.scope.trim() || key.scope.length > 256 || !key.key.trim() || key.key.length > 512
					) throw new ExecutionError('admission_key');
					const parsed = await codec.read(definition.input, input);
					return await store.accept({
						definition: identity(definition),
						input: encode(await codec.write(definition.input, parsed), policy.limits.inputBytes),
						policy,
						trace: instrument.capture(),
						...(key.location === undefined ? {} : { location: placement.SelectionSchema.parse(key.location) }),
						scope: key.scope,
						key: key.key,
						...(claim === undefined ? {} : { claim }),
					}, tx);
				});
			},
		};
		return Object.freeze({ ...result, submit: result.trigger });
	};
	const get = async <D extends DefinitionType>(
		definition: D,
		input: ReferenceType,
		options?: { readonly children?: boolean; readonly follow?: boolean },
	): Promise<SnapshotType & { readonly value?: ValueType<D> }> => {
		let ref = ReferenceSchema.parse(input);
		if (ref.namespace !== store.namespace || address(ref.definition) !== address(identity(definition))) {
			throw new ExecutionError('reference_conflict');
		}
		const visited = new Set<string>([ref.id]);
		for (;;) {
			const state = await store.get(ref, { children: options?.children });
			if (options?.follow && state.state === 'continued') {
				ref = successor(ref, state, visited);
				continue;
			}
			if (state.exit?.type !== 'success') {
				const { value: _stored, ...snapshot } = state;
				return snapshot;
			}
			const value = await codec.read(definition.result, decode(state.exit.value)) as ValueType<D>;
			return Object.freeze({ ...state, value });
		}
	};
	return Object.freeze({
		...admission(),
		/**
		 * Accept declared trigger effects in this fixed scope. Derive a stable command key so repeated
		 * delivery can reuse acceptance.
		 */
		effects({ scope }: { readonly scope: string }): effects.EffectEmitter {
			return Object.freeze({
				async emit(ctx: import('@okikio/context').Context, occurrence: effects.EffectOccurrence) {
					if (!effects.is(occurrence, TriggerEffect)) {
						throw new effects.UnknownEffectDefinitionError(occurrence.definition.id);
					}
					ctx.signal.throwIfAborted();
					const request = TriggerSchema.parse(occurrence.value);
					await store.accept({
						definition: request.definition,
						input: encode(request.input, policy.limits.inputBytes),
						policy,
						scope,
						key: `effect-v1:${await fingerprint([ctx.id, occurrence.key])}`,
						trace: instrument.capture(),
					});
				},
			});
		},
		in: (tx: unknown, binding?: { readonly claim: Claim | undefined }) => {
			if (binding !== undefined && binding.claim === undefined) throw new ExecutionError('claim_binding');
			return admission(tx, binding?.claim);
		},
		get,
		/**
		 * Save one checked event for this run and correlation key. Event acceptance does not itself complete
		 * the waiting workflow.
		 */
		async send<Value>(
			input: ReferenceType,
			event: WorkflowSignal<Value>,
			value: Value,
			options: { readonly key: string } = { key: 'default' },
		) {
			const ref = ReferenceSchema.parse(input);
			if (ref.namespace !== store.namespace) throw new ExecutionError('reference_conflict');
			if (store.send === undefined) throw new ExecutionError('events_binding');
			await store.send(
				ref,
				event.id,
				options.key,
				encode(await codec.write(event.value, value), policy.limits.inputBytes),
			);
		},
		/**
		 * Poll saved progress revisions for this subscription. Unsubscribing stops observation without
		 * cancelling accepted work.
		 */
		watch(
			input: ReferenceType,
			options: { readonly signal?: AbortSignal; readonly intervalMs?: number; readonly children?: boolean } = {},
		) {
			const ref = ReferenceSchema.parse(input);
			if (ref.namespace !== store.namespace) throw new ExecutionError('reference_conflict');
			const interval = options.intervalMs ?? 100;
			if (!Number.isSafeInteger(interval) || interval < 1 || interval > 60_000) {
				throw new RangeError('Observation interval must be 1..60000 ms.');
			}
			return new Observable<ProgressType>((subscriber) => {
				const stop = new AbortController();
				const signal = options.signal === undefined ? stop.signal : AbortSignal.any([stop.signal, options.signal]);
				void (async () => {
					// Deduplicate revisions per observed effect, not per poll. A slow observer
					// sees current saved snapshots; this is not a replay of every progress event.
					const seen = new Map<string, string>();
					try {
						for (;;) {
							signal.throwIfAborted();
							const snapshot = await observe(store.get(ref, { children: options.children }), signal);
							if (snapshot.progressTruncated) {
								throw new ExecutionError('progress_limit', 'Observe a smaller child subtree.');
							}
							signal.throwIfAborted();
							for (const report of snapshot.progress ?? []) {
								const key = JSON.stringify([report.job, report.effect.id]);
								if (seen.get(key) === report.revision) continue;
								seen.set(key, report.revision);
								subscriber.next(report);
							}
							if (['completed', 'failed', 'cancelled', 'blocked', 'continued'].includes(snapshot.state)) break;
							await pause(interval, signal);
						}
						subscriber.complete();
					} catch (error) {
						if (signal.aborted) subscriber.complete();
						else subscriber.error(error);
					}
				})();
				return () => stop.abort();
			});
		},
		/**
		 * Follow saved state, including continuation successors, until the accepted work finishes.
		 * Aborting this wait stops the caller's observation; it does not revoke the worker's job.
		 */
		async wait<D extends DefinitionType>(
			definition: D,
			ref: ReferenceType,
			wait: { readonly signal: AbortSignal; readonly intervalMs?: number },
		): Promise<ValueType<D>> {
			const interval = wait.intervalMs ?? 100;
			if (!Number.isSafeInteger(interval) || interval < 1 || interval > 60_000) {
				throw new RangeError('Observation interval must be 1..60000 ms.');
			}
			let current = ReferenceSchema.parse(ref);
			const visited = new Set<string>([current.id]);
			for (;;) {
				wait.signal.throwIfAborted();
				const state = await observe(get(definition, current), wait.signal);
				wait.signal.throwIfAborted();
				if (state.state === 'continued') {
					current = successor(current, state, visited);
					continue;
				}
				if (state.state === 'completed') return state.value as ValueType<D>;
				if (['failed', 'cancelled', 'blocked'].includes(state.state)) throw new ExitError(state);
				await pause(interval, wait.signal);
			}
		},
		cancel: store.cancel.bind(store),
		async pause(input: ReferenceType, options: ControlOptions): Promise<ControlType> {
			const ref = ReferenceSchema.parse(input);
			if (ref.namespace !== store.namespace) throw new ExecutionError('reference_conflict');
			if (store.pause === undefined) throw new ExecutionError('control_binding');
			return ControlSchema.parse(await store.pause(ref, ControlOptionsSchema.parse(options)));
		},
		async resume(input: ReferenceType, options: ControlOptions): Promise<ControlType> {
			const ref = ReferenceSchema.parse(input);
			if (ref.namespace !== store.namespace) throw new ExecutionError('reference_conflict');
			if (store.resume === undefined) throw new ExecutionError('control_binding');
			return ControlSchema.parse(await store.resume(ref, ControlOptionsSchema.parse(options)));
		},
		repair: store.repair.bind(store),
	});
}

/**

 * Chain links remain within one scope and definition. Corrupt or cyclic links must fail instead of

 * polling forever.

 */
function successor(ref: ReferenceType, state: SnapshotType, visited: Set<string>): ReferenceType {
	if (state.continuedTo === undefined || state.exit !== undefined) throw new ExecutionError('continuation_link');
	const next = ReferenceSchema.parse(state.continuedTo);
	if (
		next.namespace !== ref.namespace || next.scope !== ref.scope || address(next.definition) !== address(ref.definition)
	) {
		throw new ExecutionError('reference_conflict');
	}
	if (visited.has(next.id) || visited.size > 1000) throw new ExecutionError('continuation_limit');
	visited.add(next.id);
	return next;
}

/**

 * End an observer promptly during a slow read. The store still owns the query; retained handlers

 * consume its eventual result or rejection.

 */
export function observe<Value>(pending: Promise<Value>, signal: AbortSignal): Promise<Value> {
	return new Promise((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener('abort', abort);
			reject(signal.reason);
		};
		pending.then((value) => {
			signal.removeEventListener('abort', abort);
			resolve(value);
		}, (error: unknown) => {
			signal.removeEventListener('abort', abort);
			reject(error);
		});
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
	});
}

/** Cancellation removes the local observer's timer and listener; it never changes durable work. */
export function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const finish = () => {
			clearTimeout(timer);
			signal.removeEventListener('abort', abort);
			resolve();
		};
		const abort = () => {
			clearTimeout(timer);
			signal.removeEventListener('abort', abort);
			reject(signal.reason);
		};
		const timer = setTimeout(finish, milliseconds);
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
	});
}
