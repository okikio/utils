/** Physical ownership, borrowing cleanup and lease renewal. Store records contain no live values. @module */
import { AsyncDisposableStack } from '@okikio/dispose';
import type { Context } from '@okikio/context';
import { OwnerSchema, PolicySchema, ReferenceSchema } from './schema.ts';
import type { ClaimType, OwnerType, PolicyInputType, PolicyType, ReferenceType } from './schema.ts';
import { Registry, same, SessionError } from './store.ts';

/** A factory explicitly transfers one value's cleanup authority to the session owner. */
export interface Resource<Value> extends AsyncDisposable {
	/** Borrowed by actions, never serialized or disposed by a remote caller. */
	readonly value: Value;
}
/** One active borrow. Register cleanup here so it finishes before the authoritative claim is released. */
export interface Borrow {
	/** Aborts on caller cancellation, owner closure or authority loss; cleanup must still join. */
	readonly signal: AbortSignal;
	/** Correlation receipt. External writes need an atomic authority check or a sink-specific fence; the token alone cannot stop stale effects. */
	readonly claim: ClaimType;
	/** Joined in reverse registration order before the next exclusive borrower can enter. */
	defer(close: () => void | PromiseLike<void>): void;
}
/** Explicit owner and acquisition policy. Imports and construction do not acquire a resource. */
export interface Options<Value> {
	/** Borrowed parent cancellation. Disposal still belongs to the creator of this owner. */
	readonly ctx: Context;
	/** Shared authority, backed by PostgreSQL when references must survive process loss. */
	readonly registry: Registry;
	/** Exact registered executor and generation used to reject references routed to the wrong owner. */
	readonly owner: OwnerType;
	/** Resource kind shared by this owner's values; checked before local admission. */
	readonly resource: string;
	/** Maximum opening, live and closing sessions together. Admission rejects instead of queuing. */
	readonly maximum: number;
	/** Explicit liveness and idle budgets; omitted maximumBorrows selects exclusive use. */
	readonly policy: PolicyInputType;
	/** Own partial-construction cleanup until this promise transfers a Resource to the owner. */
	readonly create: (reference: ReferenceType, signal: AbortSignal) => Promise<Resource<Value>>;
}
/** One local borrow retained through both callback and cleanup, including cancellation. @internal */
interface Active {
	/** Resolves only after callback cleanup and authoritative release, so close can join both. */
	readonly done: Promise<void>;
	/** Absent while authority admission is pending; the local slot is already occupied. */
	claim?: ClaimType;
}
/** Session state remains here until acquisition and every borrow have joined. @internal */
interface Entry<Value> {
	/** Detached identity returned to callers; a replacement never reuses it. */
	readonly reference: ReferenceType;
	/** Owner-wide cancellation for acquisition and every current borrow of this value. */
	readonly abort: AbortController;
	/** Includes pending authority admissions and borrowers still running cleanup. */
	readonly active: Set<Active>;
	/** True only after authority creation commits. Renewing an unpublished ID would mistake pending creation for owner loss. */
	published: boolean;
	/** Joins both authority publication and resource acquisition; shutdown must wait for both before revocation. */
	opening: Promise<void>;
	/** Present only after the factory has transferred disposal authority to this owner. */
	resource?: Resource<Value>;
	/** Published before abort observers run, making reentrant close join the same operation. */
	closing?: Promise<void>;
}
/**
 * One physical owner for one resource kind. References are portable; values are not.
 *
 * Leases renew automatically while this owner can contact authority. Idle renewal
 * does not extend idle expiry. Authority loss aborts borrowers, joins cleanup and
 * closes values. Noncooperative JavaScript cannot be forcibly joined here; use a
 * separately killable thread/process and external orphan recovery for that case.
 * Cancellation never makes a still-running resource available to another borrower.
 */
export class Owner<Value> implements AsyncDisposable {
	/** Validated policy and borrowed dependencies; disposing the owner never disposes its registry. */
	readonly #options: Omit<Options<Value>, 'policy'> & { readonly policy: PolicyType };
	/** Capacity stays reserved until acquisition, borrowers and physical cleanup have joined. */
	readonly #entries = new Map<string, Entry<Value>>();
	/** Distinguishes this owner lifetime even when deployment reuses its executor name. */
	readonly #incarnation = crypto.randomUUID();
	/** One renewal timer per owner, stopped before shutdown starts joining local work. */
	readonly #timer: ReturnType<typeof setInterval>;
	/** Retained callback identity allows removal from the borrowed parent signal on disposal. */
	readonly #abort: () => void;
	/** Revokes local admission synchronously before cancellation can call back into the owner. */
	#stopped = false;
	/** Coalesces explicit and timer-triggered renewal into one in-flight pass. */
	#sweeping: Promise<void> | undefined;
	/** Shared shutdown receipt, including cleanup failure, for repeated or reentrant disposal. */
	#disposal: Promise<void> | undefined;
	/** Keep bounded cleanup evidence, including failures first discovered by the renewal loop. */
	readonly #failures: unknown[] = [];
	/** Preserve the count after the retained error budget is full, without retaining more errors. */
	#omittedFailures = 0;

	/** Validate bounds and start renewal; resource acquisition remains explicit through create(). */
	constructor(options: Options<Value>) {
		options.ctx.signal.throwIfAborted();
		if (!Number.isSafeInteger(options.maximum) || options.maximum < 1) {
			throw new RangeError('Session maximum must be positive.');
		}
		this.#options = { ...options, owner: OwnerSchema.parse(options.owner), policy: PolicySchema.parse(options.policy) };
		ReferenceSchema.parse({
			id: 'validation',
			resource: options.resource,
			owner: options.owner,
			incarnation: this.#incarnation,
		});
		const policy = this.#options.policy;
		this.#timer = setInterval(() => {
			void this.sweep().catch((error: unknown) => this.#remember(error));
		}, Math.max(10, Math.floor(Math.min(policy.leaseMs, policy.borrowMs, policy.idleMs) / 3)));
		this.#abort = () => {
			void this[Symbol.asyncDispose]().catch(() => {});
		};
		options.ctx.signal.addEventListener('abort', this.#abort, { once: true });
	}
	/** Acquire a fresh session. Failed construction revokes its record and closes any transferred resource. */
	async create(options: { readonly signal?: AbortSignal } = {}): Promise<ReferenceType> {
		if (this.#stopped) throw new SessionError('closed');
		options.signal?.throwIfAborted();
		if (this.#entries.size >= this.#options.maximum) throw new SessionError('limit');
		const reference = ReferenceSchema.parse({
			id: crypto.randomUUID(),
			resource: this.#options.resource,
			owner: this.#options.owner,
			incarnation: this.#incarnation,
		});
		const entry: Entry<Value> = {
			reference,
			abort: new AbortController(),
			active: new Set(),
			published: false,
			opening: Promise.resolve(),
		};
		this.#entries.set(reference.id, entry);
		// Reserve local capacity before the first await. Another create() must see
		// this opening session even while its authority write is still pending.
		const abort = () => entry.abort.abort(options.signal?.reason);
		options.signal?.addEventListener('abort', abort, { once: true });
		entry.opening = (async () => {
			await this.#options.registry.create(reference, this.#options.policy);
			// Renew during a slow resource factory, but never race the initial authority write.
			entry.published = true;
			entry.abort.signal.throwIfAborted();
			entry.resource = await this.#options.create(ReferenceSchema.parse(reference), entry.abort.signal);
			entry.abort.signal.throwIfAborted();
		})();
		try {
			await entry.opening;
			return ReferenceSchema.parse(reference);
		} catch (error) {
			try {
				await this.#close(entry, 'lost');
			} catch (cleanup) {
				throw new AggregateError([error, cleanup], 'Session acquisition and cleanup failed.');
			}
			throw error;
		} finally {
			options.signal?.removeEventListener('abort', abort);
		}
	}
	/**
	 * Borrow on the physical owner. A remote activity passes only the reference,
	 * routes to reference.owner, then invokes this method inside that host.
	 * Result publication waits for callback cleanup and authoritative release.
	 */
	async use<Result>(
		reference: ReferenceType,
		action: (value: Value, borrow: Borrow) => Result | Promise<Result>,
		options: { readonly signal?: AbortSignal } = {},
	): Promise<Result> {
		const entry = this.#entry(reference);
		const signal = options.signal ? AbortSignal.any([entry.abort.signal, options.signal]) : entry.abort.signal;
		signal.throwIfAborted();
		// Pending authority admission also owns capacity; do not queue unbounded SQL calls before the claim exists.
		if (entry.active.size >= this.#options.policy.maximumBorrows) throw new SessionError('busy');
		const done = Promise.withResolvers<void>();
		const active: Active = { done: done.promise };
		entry.active.add(active);
		let result: Result | undefined;
		let failure: unknown;
		// JavaScript can throw undefined, so the captured value cannot indicate success.
		let failed = false;
		try {
			active.claim = await this.#options.registry.borrow(reference);
			await entry.opening;
			signal.throwIfAborted();
			try {
				// This scope must end before authority release below. A cancelled
				// callback does not make its resource safe for the next borrower yet.
				await using cleanup = new AsyncDisposableStack();
				result = await action(entry.resource!.value, {
					signal,
					claim: structuredClone(active.claim),
					defer: (close) => cleanup.defer(close),
				});
			} catch (error) {
				failed = true;
				failure = error;
			}
			try {
				signal.throwIfAborted();
			} catch (error) {
				if (!failed) {
					failed = true;
					failure = error;
				}
			}
		} catch (error) {
			failed = true;
			failure = error;
		} finally {
			if (active.claim) {
				try {
					await this.#options.registry.release(active.claim);
				} catch (error) {
					// Revocation remains a stable recovery outcome, with callback/cleanup evidence retained as its cause.
					const combined = failed ? new AggregateError([failure, error], 'Session borrow and release failed.') : error;
					failure = error instanceof SessionError && (error.code === 'lost' || error.code === 'closed')
						? new SessionError(error.code, { cause: combined })
						: combined;
					failed = true;
				}
			}
			entry.active.delete(active);
			done.resolve();
		}
		if (failed) throw failure;
		return result as Result;
	}
	/** Revoke admission, abort and join borrowers, then close the owned value exactly once. Repeated close joins or accepts terminal state. Never await close from inside its own borrow action or cleanup. */
	async close(reference: ReferenceType): Promise<void> {
		const ref = this.#reference(reference);
		const entry = this.#entries.get(ref.id);
		if (entry) {
			await this.#close(entry, 'closed');
			return;
		}
		const row = await this.#options.registry.inspect(ref.id);
		if (row && same(row.reference, ref) && row.state !== 'open') return;
		throw new SessionError('lost');
	}
	/** Renew once, or join the current renewal. Useful for explicit host health and recovery checks. */
	sweep(): Promise<void> {
		if (this.#stopped) return Promise.resolve();
		return this.#sweeping ??= this.#sweep().finally(() => {
			this.#sweeping = undefined;
		});
	}
	/** Counts describe this physical owner only; authoritative inspection is Registry.inspect(). */
	stats(): Readonly<{ sessions: number; borrows: number }> {
		return {
			sessions: this.#entries.size,
			borrows: [...this.#entries.values()].reduce((sum, entry) => sum + entry.active.size, 0),
		};
	}
	/** Stop renewal/admission and join every acquisition, borrow and owned resource close. Store lifetime remains borrowed. */
	[Symbol.asyncDispose](): Promise<void> {
		if (this.#disposal) return this.#disposal;
		const completion = Promise.withResolvers<void>();
		// Abort observers can synchronously request disposal again. Publish the
		// receipt first so they join this shutdown instead of starting another.
		this.#disposal = completion.promise;
		void (async () => {
			this.#stopped = true;
			clearInterval(this.#timer);
			this.#options.ctx.signal.removeEventListener('abort', this.#abort);
			await Promise.allSettled([...this.#entries.values()].map((entry) => this.#close(entry, 'closed')));
			await Promise.allSettled([this.#sweeping]);
			if (this.#omittedFailures) {
				this.#failures.push(new Error(`${this.#omittedFailures} additional session cleanup failures omitted.`));
			}
			if (this.#failures.length) throw new AggregateError(this.#failures, 'Session owner cleanup failed.');
		})().then(completion.resolve, completion.reject);
		return completion.promise;
	}
	/** Resolve exact local ownership before touching a value. An old owner incarnation is lost, never reconstructed. */
	#entry(reference: ReferenceType): Entry<Value> {
		const ref = this.#reference(reference);
		const entry = this.#entries.get(ref.id);
		if (!entry || !same(entry.reference, ref)) throw new SessionError('lost');
		if (entry.closing || this.#stopped) throw new SessionError('closed');
		return entry;
	}
	/** Route errors identify wrong deployment/resource; a prior incarnation is terminal loss. */
	#reference(reference: ReferenceType): ReferenceType {
		const ref = ReferenceSchema.parse(reference);
		if (
			ref.owner.id !== this.#options.owner.id || ref.owner.generation !== this.#options.owner.generation ||
			ref.resource !== this.#options.resource
		) throw new SessionError('owner');
		if (ref.incarnation !== this.#incarnation) throw new SessionError('lost');
		return ref;
	}

	/** Renew committed records, including resources still opening. Local capacity alone is not evidence of a published lease. */
	async #sweep(): Promise<void> {
		// These renewals wait on independent registry calls. Starting them together
		// avoids making one slow session delay every other session's heartbeat.
		// Each entry still closes on its own failed renewal before it can be reused.
		await Promise.all([...this.#entries.values()].map(async (entry) => {
			if (!entry.published || entry.closing) return;
			try {
				await this.#options.registry.renew(
					entry.reference,
					[...entry.active].flatMap((active) => active.claim ? [active.claim.id] : []),
				);
			} catch (error) {
				if (!(error instanceof SessionError)) this.#remember(error);
				await this.#close(entry, 'lost');
			}
		}));
	}
	/** Stop local admission immediately; join acquisition before record revocation so delayed publication cannot escape closure. A failed authority call still closes the local value. */
	#close(entry: Entry<Value>, state: 'closed' | 'lost'): Promise<void> {
		if (entry.closing) return entry.closing;
		const completion = Promise.withResolvers<void>();
		entry.closing = completion.promise;
		void (async () => {
			entry.abort.abort(new SessionError(state));
			const failures: unknown[] = [];
			await Promise.allSettled([entry.opening]);
			try {
				await this.#options.registry.close(entry.reference, state);
			} catch (error) {
				failures.push(error);
			}
			// A revoked database record stops new claims, but existing callbacks can
			// still touch the value. Join their cleanup before physical disposal.
			await Promise.all([...entry.active].map((active) => active.done));
			try {
				await entry.resource?.[Symbol.asyncDispose]();
			} catch (error) {
				failures.push(error);
			}
			this.#entries.delete(entry.reference.id);
			if (failures.length) throw new AggregateError(failures, 'Session revocation or resource close failed.');
		})().then(completion.resolve, (error: unknown) => {
			this.#remember(error);
			completion.reject(error);
		});
		return completion.promise;
	}
	/** Retain distinct cleanup evidence up to the session budget, including throw undefined. */
	#remember(error: unknown): void {
		if (this.#failures.includes(error)) return;
		if (this.#failures.length < this.#options.maximum) this.#failures.push(error);
		else this.#omittedFailures++;
	}
}
/** Construct a physical owner with an explicit lease policy; importing starts no timer or resource. */
export function owner<Value>(options: Options<Value>): Owner<Value> {
	return new Owner(options);
}
