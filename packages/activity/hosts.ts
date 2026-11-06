/**
 * Admit several activity calls onto each physical thread or process, within a fixed limit.
 *
 * The physical pool owns host creation and shutdown. This layer counts whole calls,
 * including time spent awaiting I/O and closing their temporary resources. A free CPU
 * does not mean the call's browser, connection or memory has become free.
 * @internal @module
 */
import { temporal } from '@okikio/duration/temporal';
import { HostReferenceSchema, HostSelectionError } from './selection.ts';
import type { HostReferenceType } from './selection.ts';
import * as context from '@okikio/context';
import type { Context } from '@okikio/context';
import * as pool from '@okikio/pool';
export { PoolSelectionError as SelectionError } from '@okikio/pool';
import type { CreateOptions, Lease, Pool, Stats } from '@okikio/pool';

/** One physical lease remains owned until every correlated attempt has joined cleanup. */
interface Group<Value> {
	readonly lease: Lease<Value>;
	/** Reserved before exposing a sublease, including callers not yet resumed. */
	active: number;
}

/** A queued acquisition owns its cancellation link until grant or rejection. */
interface Waiter<Value> {
	readonly ctx: Context;
	readonly resolve: (lease: Lease<Value>) => void;
	readonly reject: (reason: unknown) => void;
	readonly unlink: () => void;
}

/** Provider-facing subset; physical occupancy and queued activity pressure are separate. */
export interface Hosts<Value> extends AsyncDisposable {
	acquire(ctx: Context, selection?: { readonly value: Value }): Promise<Lease<Value>>;
	/** Stop admission to one value and join its physical close after all borrowers return. */
	retire(value: Value, reason?: unknown): Promise<void>;
	stats(): Stats;
	/** Only values whose physical slot ownership is already recorded may be discovered. */
	values(): readonly Value[];
	drain(reason?: unknown): Promise<void>;
}

/** Validate before creating a host or attaching lifetime listeners. */
export function concurrency(value: number | undefined): number {
	const count = value ?? 1;
	if (!Number.isSafeInteger(count) || count < 1) {
		throw new TypeError('Activity provider concurrency must be a positive safe integer.');
	}
	return count;
}

/**
 * Share a physical lease with at most `concurrent` attempts. The single-owner
 * pool still controls creation, idle expiry and close. A failed host becomes
 * unavailable immediately and returns only after all borrowers settle.
 */
export async function create<Value>(options: CreateOptions<Value>, concurrent: number): Promise<Hosts<Value>> {
	const physical = await pool.create(options);
	return new Shared(physical, options, concurrent);
}

/** FIFO admission serializes host creation without serializing remote execution. */
class Shared<Value> implements Hosts<Value> {
	/** Owns physical creation, idle retention and joined teardown. */
	readonly #physical: Pool<Value>;
	/** Validated queue and lifetime settings borrowed from the provider assembly. */
	readonly #options: CreateOptions<Value>;
	/** Whole attempts permitted on each physical host, including I/O waits. */
	readonly #concurrent: number;
	/** Physical leases currently shared by one or more reserved attempts. */
	readonly #groups = new Set<Group<Value>>();
	/** FIFO acquisition queue; canceled entries are removed before admission. */
	readonly #waiting: Waiter<Value>[] = [];
	/** Only one pump may create or select hosts; reservations themselves are synchronous. */
	#pumping = false;
	/** Once set, no queued or new borrower may receive a host. */
	#draining = false;
	/** Original owner reason included in unavailable acquisition errors. */
	#reason: unknown;
	readonly #abort = () => {
		void this.drain(this.#options.ctx.signal.reason).catch(() => {});
	};

	constructor(physical: Pool<Value>, options: CreateOptions<Value>, concurrent: number) {
		this.#physical = physical;
		this.#options = options;
		this.#concurrent = concurrent;
		options.ctx.signal.addEventListener('abort', this.#abort, { once: true });
		if (options.ctx.signal.aborted) this.#abort();
	}

	/** Acquisition timeouts cover the shared queue as well as physical host creation. */
	async acquire(ctx: Context, selection?: { readonly value: Value }): Promise<Lease<Value>> {
		if (selection) {
			context.check(ctx);
			if (this.#draining) throw new pool.PoolUnavailableError('draining', this.#reason);
			const shared = [...this.#groups].find((group) => Object.is(group.lease.value, selection.value));
			if (shared) {
				if (shared.lease.invalid) throw new pool.PoolSelectionError('missing');
				if (shared.active >= this.#concurrent) throw new pool.PoolSelectionError('busy');
				shared.active++;
				return this.#lease(shared);
			}
			const lease = await this.#physical.select(ctx, selection.value);
			const group = { lease, active: 1 };
			this.#groups.add(group);
			return this.#lease(group);
		}
		let granted: Lease<Value> | undefined;
		try {
			await using scope = context.child(ctx);
			await using timed = this.#options.acquireTimeout === undefined ? undefined : context.deadline(
				scope,
				scope.clock.now().add(this.#options.acquireTimeout),
			);
			const selected = timed ?? scope;
			context.check(selected);
			if (this.#draining) throw new pool.PoolUnavailableError('draining', this.#reason);
			const immediate = !this.#pumping && this.#waiting.length === 0 &&
				([...this.#groups].some((group) => !group.lease.invalid && group.active < this.#concurrent) ||
					this.#groups.size < this.#options.maximum);
			if (!immediate && this.#waiting.length >= this.#options.maximumWaiting) {
				throw new pool.PoolWaitLimitError(this.#options.maximumWaiting);
			}
			try {
				return granted = await new Promise<Lease<Value>>((resolve, reject) => {
					const abort = () => {
						const index = this.#waiting.indexOf(waiter);
						if (index < 0) return;
						this.#waiting.splice(index, 1);
						waiter.unlink();
						reject(selected.signal.reason);
					};
					const waiter: Waiter<Value> = {
						ctx: selected,
						resolve,
						reject,
						unlink: () => selected.signal.removeEventListener('abort', abort),
					};
					selected.signal.addEventListener('abort', abort, { once: true });
					this.#waiting.push(waiter);
					void this.#pump();
				});
			} catch (error) {
				if (timed !== undefined && error instanceof context.ContextDeadlineExceededError) {
					throw new pool.PoolAcquireTimeoutError(temporal.Duration.from(this.#options.acquireTimeout!));
				}
				throw error;
			}
		} catch (error) {
			// A context cleanup failure can hide a granted sublease from its caller.
			// Return that reservation so drain cannot wait forever on unreachable work.
			await using _release = granted;
			throw error;
		}
	}

	/** The pool's invalidation is immediately visible to every sublease; only the last return closes the host. */
	retire(value: Value, reason?: unknown): Promise<void> {
		return this.#physical.retire(value, reason);
	}

	/** Expose only host values whose physical pool ownership has already been recorded. */
	values(): readonly Value[] {
		return this.#physical.values();
	}

	/** Report shared attempt waiters separately from the physical pool's resource counters. */
	stats(): Stats {
		return Object.freeze({ ...this.#physical.stats(), waiting: this.#waiting.length });
	}

	/** Stop queued admission first; the physical pool joins creation and all shared borrowers. */
	drain(reason?: unknown): Promise<void> {
		this.#draining = true;
		this.#reason = reason;
		for (const waiter of this.#waiting.splice(0)) {
			waiter.unlink();
			waiter.reject(new pool.PoolUnavailableError('draining', reason));
		}
		return this.#physical.drain(reason);
	}

	/** Remove the owner listener, drain shared borrowers, then join physical resource cleanup. */
	async [Symbol.asyncDispose](): Promise<void> {
		this.#options.ctx.signal.removeEventListener('abort', this.#abort);
		try {
			await this.drain('Activity host pool disposed.');
		} finally {
			await this.#physical[Symbol.asyncDispose]();
		}
	}

	/** Never wait for a new physical lease when an existing host can free a shared slot. */
	async #pump(): Promise<void> {
		if (this.#pumping) return;
		this.#pumping = true;
		try {
			while (!this.#draining && this.#waiting.length > 0) {
				const waiter = this.#waiting[0]!;
				// Reuse a healthy host that has call capacity before opening another host.
				// This spreads admitted work without moving any host-owned live values.
				let group = [...this.#groups].find((value) => !value.lease.invalid && value.active < this.#concurrent);
				if (group === undefined) {
					if (this.#groups.size >= this.#options.maximum) break;
					try {
						const lease = await this.#physical.acquire(waiter.ctx);
						group = { lease, active: 0 };
						this.#groups.add(group);
					} catch (error) {
						if (this.#waiting[0] === waiter) {
							this.#waiting.shift();
							waiter.unlink();
							waiter.reject(error);
						}
						continue;
					}
				}
				// Cancellation or drain may remove the first waiter during host creation.
				if (this.#draining || this.#waiting[0] !== waiter) {
					if (group.active === 0) {
						this.#groups.delete(group);
						try {
							await group.lease[Symbol.asyncDispose]();
						} catch {
							// The physical pool retains close failures for drain/disposal.
						}
					}
					continue;
				}
				this.#waiting.shift();
				waiter.unlink();
				// Reserve before waking the caller: another waiter must see this slot as held
				// even before the admitted async function gets its next JavaScript turn.
				group.active++;
				waiter.resolve(this.#lease(group));
			}
		} finally {
			this.#pumping = false;
		}
	}

	/** Invalidation is shared immediately; last return alone releases the physical lease. */
	#lease(group: Group<Value>): Lease<Value> {
		let completion: Promise<void> | undefined;
		return Object.freeze({
			value: group.lease.value,
			acquiredAt: group.lease.acquiredAt,
			get invalid() {
				return group.lease.invalid;
			},
			invalidate: (reason?: unknown) => group.lease.invalidate(reason),
			[Symbol.asyncDispose]: () =>
				completion ??= (async () => {
					group.active--;
					try {
						if (group.active === 0) {
							// Physical pool accounting retains the host until asynchronous return completes.
							this.#groups.delete(group);
							await group.lease[Symbol.asyncDispose]();
						}
					} finally {
						void this.#pump();
					}
				})(),
		});
	}
}

/** Resolve only a currently owned host. Fresh random provider identity prevents old references from aliasing a replacement without retaining tombstones. @internal */
export function resolve<Host extends { readonly reference: HostReferenceType }>(
	reference: HostReferenceType,
	incarnation: string,
	live: ReadonlySet<Host>,
	retiring?: ReadonlyMap<Host, Promise<void>>,
): Host {
	const ref = HostReferenceSchema.parse(reference);
	const host = ref.pool === incarnation ? [...live].find((host) => host.reference.id === ref.id) : undefined;
	if (!host || retiring?.has(host)) throw new HostSelectionError('lost');
	return host;
}
