/**
 * Reuse expensive resources without giving two callers the same exclusive lease. A caller borrows a
 * connection, browser page, or worker handle, then returns its lease after use.
 *
 * The pool owns the values it creates. Its owner closes the pool; callers release individual leases.
 * Resource limits, waiting limits, validation, and acquisition timeouts control different parts of that
 * lifetime.
 *
 * A pool limits local resources. It does not grant permission to run a durable job or coordinate ownership
 * across hosts.
 *
 * @example
 * ```ts
 * import * as context from '@okikio/context';
 * import * as pool from '@okikio/pool';
 * await using ctx = context.create({ id: 'connection-owner' });
 * let opened = 0;
 * await using connections = await pool.create({
 * 	ctx,
 * 	maximum: 2,
 * 	maximumWaiting: 32,
 * 	create: () => ({ id: ++opened }),
 * 	close: () => {},
 * });
 * {
 * 	await using lease = await connections.acquire(ctx);
 * 	console.log(lease.value.id);
 * }
 * console.log(connections.stats().leased);
 * ```
 *
 * @module
 */
import * as telemetry from '@okikio/telemetry/instrument';
import { EventBus } from '@okikio/observables/events';
import { observe } from '@okikio/telemetry/observe';
import * as context from '@okikio/context';
import * as duration from '@okikio/duration';
import { type Temporal, temporal } from '@okikio/duration/temporal';
import type { Context, Owned } from '@okikio/context';
import { AsyncDisposableStack, SuppressedError } from '@okikio/dispose';

import type { CreateOptions, Event, Lease, Pool, Stats } from './types.ts';

/** Acquisition attempted while a pool is draining or disposed. */
export class PoolUnavailableError extends Error {
	/** Lifecycle state that rejected the acquisition. */
	readonly state: 'draining' | 'disposed';
	/** Original drain/disposal reason when the owner supplied one. */
	readonly reason: unknown;

	/** Create one unavailable error without losing the owner-supplied stop reason. */
	constructor(state: 'draining' | 'disposed', reason?: unknown) {
		super(`Pool is ${state}.`, reason === undefined ? undefined : { cause: reason });
		this.name = 'PoolUnavailableError';
		this.state = state;
		this.reason = reason;
	}
}

/** Pool acquisition exceeded its configured timeout. */
export class PoolAcquireTimeoutError extends Error {
	/** Configured timeout that elapsed before a value became available. */
	readonly duration: Temporal.Duration;

	/** Create one acquisition-timeout error with the normalized configured duration. */
	constructor(duration: Temporal.Duration) {
		super(`Pool acquisition exceeded ${duration.toString()}.`);
		this.name = 'PoolAcquireTimeoutError';
		this.duration = duration;
	}
}

/** Acquisition rejected before enqueue because all waiting slots are occupied. */
export class PoolWaitLimitError extends Error {
	/** Configured waiting admission bound; zero disables queueing. */
	readonly maximumWaiting: number;
	constructor(maximumWaiting: number) {
		super(`Pool waiting limit of ${maximumWaiting} reached.`);
		this.name = 'PoolWaitLimitError';
		this.maximumWaiting = maximumWaiting;
	}
}

/** Exact-value selection cannot silently create a replacement or wait behind unrelated work. */
export class PoolSelectionError extends Error {
	/** Busy includes acquisition/return transitions; missing includes retired or unknown values. */
	readonly code: 'busy' | 'missing';
	constructor(code: 'busy' | 'missing') {
		super(`Pool value is ${code}.`);
		this.name = 'PoolSelectionError';
		this.code = code;
	}
}

/** Identity of one acquisition, independent from its possibly equal or undefined value. */
interface Slot<Value> {
	/** Provider value owned by this acquisition only. */
	readonly value: Value;
	/** Owning clock instant after provider creation completed, independent from idle return time. */
	readonly createdAt: Temporal.Instant;
	/** Granted leases, incremented only when ownership is transferred to a borrower. */
	uses: number;
	/** Retirement stops reuse immediately but capacity remains owned through close. */
	retired?: boolean;
	/** Published before invoking close so reentrant retirement joins the same receipt. */
	closing?: Promise<void>;
	/** Settles after physical close, including failure; created only for explicit retirement. */
	retirement?: ReturnType<typeof Promise.withResolvers<void>>;
}

/** One reusable acquisition retained after its previous lease returned it. */
interface Idle<Value> {
	/** Stable acquisition identity retained through health checks, leases and cleanup. */
	readonly slot: Slot<Value>;
	/** Time when the previous lease returned the value to idle ownership. */
	readonly returnedAt: Temporal.Instant;
}

/** One FIFO acquisition continuation blocked while the pool is at capacity. */
interface Waiter {
	/** Resume the acquisition after a state change can make progress possible. */
	readonly resolve: () => void;
	/** Reject the acquisition when cancellation or pool shutdown ends the wait. */
	readonly reject: (reason: unknown) => void;
	/** Remove the waiter's abort listener before the continuation is released. */
	readonly unlink: () => void;
}

/** Mutable ownership state retained behind one immutable public lease. */
interface LeaseState {
	/** Whether the borrower marked the value unsafe to reuse. */
	invalid: boolean;
	/** Optional invalidation reason passed to provider cleanup. */
	reason?: unknown;
	/** Whether this lease has already completed its one release transition. */
	released: boolean;
	/** Shared completion keeps repeated disposal joined to the original return or close. */
	completion?: Promise<void>;
}

/** Acquisition-scoped child context and its owned cleanup path. */
interface Acquisition {
	/** Context passed to provider creation and pool wait checks. */
	readonly ctx: Context;
	/** Normalized timeout used to map a deadline failure into the pool error type. */
	readonly timeout?: Temporal.Duration;
}

/** Validated immutable limits captured before the pool starts provider work. */
interface Limits {
	/** Minimum number of retained reusable values. */
	readonly minimum: number;
	/** Maximum number of values owned, leased, or being created. */
	readonly maximum: number;
	/** Queued continuations count until wake, abort, timeout or drain removes them. */
	readonly maximumWaiting: number;
	/** Maximum number of returned values retained while idle. */
	readonly maximumIdle: number;
	/** Maximum idle age before a reusable value is retired. */
	readonly maximumIdleAge?: Temporal.Duration;
	/** Absolute creation age checked before reuse and during maintenance. */
	readonly maximumAge?: Temporal.Duration;
	/** Maximum completed/granted leases before the value must retire. */
	readonly maximumUses?: number;
	/** Optional upper bound for one acquisition wait. */
	readonly acquireTimeout?: Temporal.Duration;
}

/**
 * Create a bounded reusable-value pool with explicit ownership and FIFO waiter wakeups.
 *
 * ```text
 * acquire(ctx)
 *    |
 *    +-- idle value -------------------------------> Lease
 *    |
 *    +-- capacity available -> create(value) ------> Lease
 *    |
 *    `-- saturated -> FIFO waiter -> release ------> retry acquire
 *
 * Lease.dispose() -> idle queue or close(value)
 * Lease.invalidate(reason) -> close(value)
 * Pool.drain() -> stop admission -> wait active transitions -> close idle
 * ```
 *
 * The pool owns every created value. A lease only borrows one value until its
 * disposal either returns a healthy value to the pool or closes it.
 */
export async function create<Value>(options: CreateOptions<Value>): Promise<Pool<Value>> {
	const limits = resolve(options);
	const runtime = new Runtime(options, limits);
	await runtime.start();
	return runtime.pool;
}

/**
 * Mutable lifecycle owner behind one immutable public `Pool` facade.
 *
 * Named ownership transitions keep the important races reviewable: creation can
 * finish after cancellation, release can overlap drain, and drain must wait for
 * every transition that can still own a value.
 */
class Runtime<Value> {
	/** Caller-owned provider behavior and parent context borrowed for this pool. */
	readonly #options: CreateOptions<Value>;
	/** Validated capacity and timing policy captured before provider work begins. */
	readonly #limits: Limits;
	/** Child context that owns the complete pool lifetime after startup. */
	readonly #owner: Owned;
	/** Lifecycle event bus disposed with the pool. */
	readonly #events = new EventBus<Event>();
	/** Immutable public facade. Mutable lifecycle state stays private to this owner. */
	readonly #pool: Pool<Value>;
	/** Reusable values currently retained by the pool. */
	readonly #idle: Idle<Value>[] = [];
	/** Values temporarily borrowed by live leases. */
	readonly #leased = new Map<Slot<Value>, LeaseState>();
	/** Values in health, creation or close transitions still reserve capacity until ownership transfers. */
	readonly #reserved = new Set<Slot<Value>>();
	/** FIFO acquisitions blocked because the pool cannot currently make progress. */
	readonly #waiters: Waiter[] = [];
	/** Cleanup failures retained so drain cannot falsely report successful shutdown. */
	readonly #failures: unknown[] = [];
	/** Provider creations that may still produce a pool-owned value. */
	#creating = 0;
	/** Async transitions that can still inspect, return, create, or close a value. */
	#operations = 0;
	/** Current admission and ownership state. */
	#state: 'active' | 'draining' | 'disposed' = 'active';
	/** Reason supplied when drain or disposal stopped new admission. */
	#reason: unknown;
	/** Shared drain barrier used by concurrent drain/dispose callers. */
	#drain: Promise<void> | undefined;
	/** Complete shutdown, including context and event cleanup, shared before any observer can reenter. */
	#disposal: Promise<void> | undefined;
	/** Resolver released only after every pool-owned transition has settled. */
	#resolve: (() => void) | undefined;

	/** Create one lifecycle owner and its frozen public facade without starting provider work. */
	constructor(options: CreateOptions<Value>, limits: Limits) {
		this.#options = options;
		this.#limits = limits;
		this.#owner = context.child(options.ctx, { id: `${options.ctx.id}:pool` });
		this.#pool = Object.freeze({
			events: observe(this.#events.events),
			acquire: (ctx: Context) => this.acquire(ctx),
			select: (ctx: Context, value: Value) => this.select(ctx, value),
			retire: (value: Value, reason?: unknown) => this.retire(value, reason),
			stats: () => this.stats(),
			values: () => this.values(),
			maintain: () => this.maintain(),
			drain: (reason?: unknown) => this.drain(reason),
			[Symbol.asyncDispose]: () => this.dispose(),
		});
	}

	/** Immutable caller-facing pool facade backed by this runtime owner. */
	get pool(): Pool<Value> {
		return this.#pool;
	}

	/**
	 * Create the configured minimum before the pool becomes observable to callers.
	 *
	 * Startup uses its own child context. If one creation fails, every value that
	 * was already created is closed before the failure escapes.
	 */
	async start(): Promise<void> {
		await using startupCtx = context.child(this.#options.ctx, { id: `${this.#options.ctx.id}:pool-startup` });
		try {
			for (let index = 0; index < this.#limits.minimum; index += 1) {
				const value = await this.#create(startupCtx);
				try {
					context.check(startupCtx);
				} catch (error) {
					await this.#discard(value, error);
				}
				this.#reserved.delete(value);
				this.#idle.push({ slot: value, returnedAt: this.#options.ctx.clock.now() });
			}
		} catch (error) {
			await this.#cleanup(error);
		}
	}

	/** Acquire a healthy value or join the FIFO wakeup queue; each wake retries capacity admission. */
	async acquire(ctx: Context): Promise<Lease<Value>> {
		return await telemetry.get(ctx).span('pool.acquire', {}, () => this.#acquire(ctx));
	}
	/** Retain capacity through acquisition and cleanup. Observation does not own the lease or caller cancellation. */
	async #acquire(ctx: Context): Promise<Lease<Value>> {
		this.#begin();
		let acquisition: Acquisition | undefined;
		let granted: Lease<Value> | undefined;
		try {
			await using resources = new AsyncDisposableStack();
			acquisition = this.#context(ctx, resources);
			// A wakeup only means capacity may have changed. Another caller or a
			// health check can take that capacity, so repeat admission before lending.
			// Waiting here releases the JavaScript event loop, not an existing lease.
			while (true) {
				this.#check(acquisition.ctx);
				this.#admit();
				if (this.#idle.length === 0 && this.#owned() >= this.#limits.maximum) {
					await this.#wait(acquisition.ctx);
					continue;
				}

				await this.#expire();
				const reused = await this.#take();
				if (reused !== undefined) {
					try {
						this.#check(acquisition.ctx);
						this.#admit();
					} catch (error) {
						await this.#discard(reused, error);
					}
					return granted = this.#lease(reused);
				}
				if (this.#owned() < this.#limits.maximum) {
					const value = await this.#create(acquisition.ctx);
					try {
						this.#check(acquisition.ctx);
						this.#admit();
					} catch (error) {
						await this.#discard(value, error);
					}
					return granted = this.#lease(value);
				}
				await this.#wait(acquisition.ctx);
			}
		} catch (error) {
			const failure = acquisition?.timeout !== undefined && error instanceof context.ContextDeadlineExceededError
				? new PoolAcquireTimeoutError(acquisition.timeout)
				: error;
			if (granted !== undefined) {
				// A child cleanup can fail after a lease was prepared but before the
				// caller receives it. Retire that unreachable value before rejecting.
				granted.invalidate(failure);
				await using _release = granted;
				throw failure;
			}
			throw failure;
		} finally {
			this.#end();
		}
	}

	/** Exact selection reserves idle ownership before any health-check await. Busy selection never queues. */
	async select(ctx: Context, target: Value): Promise<Lease<Value>> {
		this.#begin();
		let granted: Lease<Value> | undefined;
		try {
			this.#check(ctx);
			this.#admit();
			await this.#expire();
			this.#unique(target);
			const index = this.#idle.findIndex((entry) => Object.is(entry.slot.value, target));
			if (index < 0) {
				const slot = [...this.#leased.keys(), ...this.#reserved].find((slot) => Object.is(slot.value, target));
				throw new PoolSelectionError(slot && !slot.retired ? 'busy' : 'missing');
			}
			const slot = this.#idle.splice(index, 1)[0]!.slot;
			this.#reserved.add(slot);
			try {
				if (this.#rotated(slot, this.#options.ctx.clock.now()) || !await this.#healthy(slot)) {
					await this.#discard(slot, new PoolSelectionError('missing'));
				}
				this.#check(ctx);
				this.#admit();
				if (this.#rotated(slot, this.#options.ctx.clock.now())) throw new PoolSelectionError('missing');
			} catch (error) {
				if (!slot.closing) await this.#discard(slot, error);
				throw error;
			}
			return granted = this.#lease(slot);
		} catch (error) {
			if (granted) {
				granted.invalidate(error);
				await granted[Symbol.asyncDispose]();
			}
			throw error;
		} finally {
			this.#end();
		}
	}

	/** Value identity is only addressable when it denotes one slot; equal primitive or reused object values are ambiguous. */
	#unique(target: Value): void {
		const matches = [...this.#idle.map((entry) => entry.slot), ...this.#leased.keys(), ...this.#reserved]
			.filter((slot) => Object.is(slot.value, target));
		if (matches.length > 1) throw new TypeError('Exact pool selection requires a unique value identity.');
	}

	/** Mark even a health-check/return slot before awaiting; that transition must observe retirement before reuse. */
	retire(target: Value, reason?: unknown): Promise<void> {
		this.#unique(target);
		const slot = [...this.#idle.map((entry) => entry.slot), ...this.#leased.keys(), ...this.#reserved]
			.find((slot) => Object.is(slot.value, target));
		if (!slot) return Promise.reject(new PoolSelectionError('missing'));
		if (slot.retirement) return slot.retirement.promise;
		slot.retirement = Promise.withResolvers<void>();
		// A borrower may close first; keep the public rejection while avoiding an unobserved internal receipt.
		void slot.retirement.promise.catch(() => {});
		slot.retired = true;
		const leased = this.#leased.get(slot);
		if (leased) this.#invalidate(leased, reason);
		const index = this.#idle.findIndex((entry) => entry.slot === slot);
		if (index >= 0) {
			this.#idle.splice(index, 1);
			this.#reserved.add(slot);
			this.#begin();
			void this.#close(slot, reason).catch(() => {}).finally(() => this.#end());
		} else if (slot.closing) {
			void slot.closing.then(slot.retirement.resolve, slot.retirement.reject);
		}
		return slot.retirement.promise;
	}

	/** Do not expose a factory result before the pool has recorded ownership; provider discovery relies on this boundary. */
	values(): readonly Value[] {
		return Object.freeze([...this.#idle.map((entry) => entry.slot), ...this.#leased.keys(), ...this.#reserved]
			.map((slot) => slot.value));
	}

	/** Return an immutable snapshot of current pool occupancy and waiter pressure. */
	stats(): Stats {
		return Object.freeze({
			state: this.#state,
			minimum: this.#limits.minimum,
			maximum: this.#limits.maximum,
			maximumWaiting: this.#limits.maximumWaiting,
			idle: this.#idle.length,
			leased: this.#leased.size,
			creating: this.#creating,
			waiting: this.#waiters.length,
		});
	}

	/** Retire idle values; idle-age expiry preserves minimum, while absolute-age rotation may go below it. */
	async maintain(): Promise<void> {
		this.#begin();
		try {
			this.#admit();
			await this.#expire();
		} finally {
			this.#end();
		}
	}

	/**
	 * Stop admission and wait until no pool-owned transition can still produce or retain a value.
	 *
	 * Drain closes retained idle values immediately, but it remains pending while
	 * leases, creations, health checks, release cleanup, or other active pool
	 * operations can still change ownership.
	 */
	async drain(reason?: unknown): Promise<void> {
		if (this.#state === 'disposed') {
			this.#throwFailures();
			return;
		}
		if (this.#drain === undefined) {
			// Publish the shared barrier before notifying observers: an observer can
			// reenter drain without creating another shutdown owner. Idle closure is
			// itself an owned transition, even after the idle array has been emptied.
			this.#drain = new Promise<void>((resolve) => this.#resolve = resolve);
			this.#begin();
			this.#state = 'draining';
			this.#reason = reason;
			this.#events.emit(Object.freeze({ type: 'draining', ...(reason === undefined ? {} : { reason }) }));
			this.#rejectAll(new PoolUnavailableError('draining', reason));
			try {
				const values = this.#idle.splice(0).map((entry) => entry.slot);
				await Promise.allSettled(values.map((value) => this.#close(value, reason)));
			} finally {
				this.#end();
			}
		}
		await this.#drain;
		this.#throwFailures();
	}

	/** Publish one complete shutdown before drain observers or cleanup can reenter disposal. */
	dispose(): Promise<void> {
		if (this.#disposal !== undefined) return this.#disposal;
		const completion = Promise.withResolvers<void>();
		this.#disposal = completion.promise;
		void this.#dispose().then(completion.resolve, completion.reject);
		return completion.promise;
	}

	/** Join the owner context, then notify and release observers, retaining every shutdown failure. */
	async #dispose(): Promise<void> {
		await using resources = new AsyncDisposableStack();
		resources.use(this.#events);
		resources.defer(() => this.#events.emit(Object.freeze({ type: 'disposed' })));
		resources.use(this.#owner);
		try {
			await this.drain('Pool was disposed.');
		} finally {
			this.#state = 'disposed';
		}
	}

	/** Register each child with the acquisition scope before another clock or deadline operation can fail. */
	#context(ctx: Context, resources: AsyncDisposableStack): Acquisition {
		const borrowed = resources.use(context.child(this.#owner, {
			id: ctx.id,
			signal: ctx.signal,
			deadline: ctx.deadline,
			clock: ctx.clock,
		}));
		const timeout = this.#limits.acquireTimeout;
		const selected = timeout === undefined
			? borrowed
			: resources.use(context.deadline(borrowed, borrowed.clock.now().add(timeout)));
		return Object.freeze({
			ctx: selected,
			...(timeout === undefined ? {} : { timeout }),
		});
	}

	/** Reject cancellation/deadline before a pool action can transfer or create ownership. */
	#check(ctx: Context): void {
		if (ctx.signal.aborted) throw ctx.signal.reason ?? new context.ContextCancelledError();
		context.check(ctx);
	}

	/** Reject new work after drain has stopped admission. */
	#admit(): void {
		if (this.#state === 'active') return;
		throw new PoolUnavailableError(this.#state, this.#reason);
	}

	/** Count every owned value, including asynchronous health, return and close transitions. */
	#owned(): number {
		return this.#idle.length + this.#leased.size + this.#creating + this.#reserved.size;
	}

	/** Create one provider value while keeping drain aware of in-flight ownership. */
	async #create(ctx: Context): Promise<Slot<Value>> {
		this.#creating += 1;
		this.#events.emit(Object.freeze({ type: 'creating' }));
		try {
			const created = await this.#options.create(ctx);
			const value: Slot<Value> = { value: created, createdAt: this.#options.ctx.clock.now(), uses: 0 };
			this.#reserved.add(value);
			this.#events.emit(Object.freeze({ type: 'created' }));
			return value;
		} finally {
			this.#creating -= 1;
			this.#settle();
		}
	}

	/** Reserve each removed idle value against capacity until health checking transfers or closes it. */
	async #take(): Promise<Slot<Value> | undefined> {
		while (this.#idle.length > 0) {
			const entry = this.#idle.shift()!;
			this.#reserved.add(entry.slot);
			if (
				!this.#rotated(entry.slot, this.#options.ctx.clock.now()) && await this.#healthy(entry.slot) &&
				!this.#rotated(entry.slot, this.#options.ctx.clock.now())
			) {
				return entry.slot;
			}
			await this.#close(entry.slot, 'Pool health check failed.');
		}
		return undefined;
	}

	/** Create one immutable lease whose disposal performs exactly one return-or-close transition. */
	#lease(value: Slot<Value>): Lease<Value> {
		const acquiredAt = this.#options.ctx.clock.now();
		const state: LeaseState = { invalid: false, released: false };
		this.#reserved.delete(value);
		value.uses++;
		this.#leased.set(value, state);
		this.#events.emit(Object.freeze({ type: 'acquired', acquiredAt: acquiredAt.toString() }));

		return Object.freeze({
			value: value.value,
			acquiredAt,
			get invalid() {
				return state.invalid;
			},
			invalidate: (reason?: unknown) => this.#invalidate(state, reason),
			[Symbol.asyncDispose]: () => this.#release(value, state),
		});
	}

	/** Mark one live lease invalid without closing it before the borrower releases ownership. */
	#invalidate(state: LeaseState, reason?: unknown): void {
		if (state.released || state.invalid) return;
		state.invalid = true;
		state.reason = reason;
		this.#events.emit(Object.freeze({ type: 'invalidated', ...(reason === undefined ? {} : { reason }) }));
	}

	/** Publish the lease's one return transition so repeated disposal joins in-flight provider cleanup. */
	#release(value: Slot<Value>, lease: LeaseState): Promise<void> {
		if (lease.completion !== undefined) return lease.completion;
		const completion = Promise.withResolvers<void>();
		lease.completion = completion.promise;
		lease.released = true;
		void this.#return(value, lease).then(completion.resolve, completion.reject);
		return completion.promise;
	}

	/** Return a released healthy value to idle ownership or close it before waking the next waiter. */
	async #return(value: Slot<Value>, lease: LeaseState): Promise<void> {
		this.#begin();
		// Keep the returned value counted while reset and health checks await I/O.
		// Otherwise another acquire could open a replacement above maximum.
		this.#reserved.add(value);
		this.#leased.delete(value);
		let reusable = false;
		let closing = false;
		let releaseFailed = false;
		let releaseFailure: unknown;
		try {
			reusable = !lease.invalid && this.#state === 'active' && !this.#rotated(value, this.#options.ctx.clock.now());
			if (reusable && this.#options.reset !== undefined) {
				try {
					await this.#options.reset(value.value);
				} catch (failure) {
					// The failed reset still owns a value. Retire it before releasing capacity or reporting failure.
					reusable = false;
					closing = true;
					await this.#discard(value, failure);
				}
			}
			reusable = reusable && this.#state === 'active' && await this.#healthy(value);
			// Drain can begin while the provider checks health. A healthy value must
			// still be closed when its owner has stopped admitting reusable values.
			reusable = reusable && this.#state === 'active' && !this.#rotated(value, this.#options.ctx.clock.now());
			if (reusable && this.#idle.length < this.#limits.maximumIdle) {
				this.#idle.push({ slot: value, returnedAt: this.#options.ctx.clock.now() });
			} else {
				reusable = false;
				closing = true;
				await this.#close(value, lease.reason ?? this.#reason);
			}
		} catch (error) {
			releaseFailed = true;
			releaseFailure = error;
			// Provider-close failures are retained by their single cleanup owner.
			// Preserve another release failure without counting that close twice.
			if (!closing) this.#failures.push(error);
		} finally {
			this.#reserved.delete(value);
			this.#events.emit(Object.freeze({ type: 'released', reusable }));
			this.#wake();
			this.#end();
		}
		if (releaseFailed) throw releaseFailure;
	}

	/** Rotation excludes active borrowers; every return/reuse checks the creation clock and granted-use count. */
	#rotated(value: Slot<Value>, now: Temporal.Instant): boolean {
		return value.retired === true ||
			(this.#limits.maximumUses !== undefined && value.uses >= this.#limits.maximumUses) ||
			(this.#limits.maximumAge !== undefined &&
				duration.compare(value.createdAt.until(now), this.#limits.maximumAge) >= 0);
	}

	/** Treat provider health-check exceptions as an unhealthy reusable value. */
	async #healthy(value: Slot<Value>): Promise<boolean> {
		if (this.#options.check === undefined) return true;
		try {
			return await this.#options.check(value.value);
		} catch {
			return false;
		}
	}

	/** Close one pool-owned value, retaining each cleanup failure once for shutdown. */
	#close(value: Slot<Value>, reason?: unknown): Promise<void> {
		if (value.closing) return value.closing;
		const done = Promise.withResolvers<void>();
		value.closing = done.promise;
		void (async () => {
			try {
				await this.#options.close(value.value, reason);
			} catch (error) {
				this.#failures.push(error);
				throw error;
			} finally {
				this.#reserved.delete(value);
				this.#events.emit(Object.freeze({ type: 'closed-value', ...(reason === undefined ? {} : { reason }) }));
				this.#wake();
			}
		})().then(() => {
			value.retirement?.resolve();
			done.resolve();
		}, (error: unknown) => {
			value.retirement?.reject(error);
			done.reject(error);
		});
		return done.promise;
	}

	/** Close a value created after its acquisition became invalid, preserving primary and cleanup failures. */
	async #discard(value: Slot<Value>, primaryFailure: unknown): Promise<never> {
		try {
			await this.#close(value, primaryFailure);
		} catch (closeFailure) {
			throw new SuppressedError(closeFailure, primaryFailure, 'Pool acquisition and cleanup failed.');
		}
		throw primaryFailure;
	}

	/** Retire absolute-age/use rotations unconditionally; apply the minimum floor only to idle-age expiry. */
	async #expire(): Promise<void> {
		if (
			(this.#limits.maximumIdleAge === undefined && this.#limits.maximumAge === undefined) || this.#idle.length === 0
		) return;
		const now = this.#options.ctx.clock.now();
		const retained: Idle<Value>[] = [];
		const expired: Slot<Value>[] = [];
		for (const entry of this.#idle) {
			const age = entry.returnedAt.until(now);
			if (
				this.#rotated(entry.slot, now) || (this.#limits.maximumIdleAge !== undefined &&
					duration.compare(age, this.#limits.maximumIdleAge) >= 0 &&
					this.#idle.length - expired.length > this.#limits.minimum)
			) {
				this.#reserved.add(entry.slot);
				expired.push(entry.slot);
			} else {
				retained.push(entry);
			}
		}
		this.#idle.splice(0, this.#idle.length, ...retained);
		const settled = await Promise.allSettled(expired.map((value) => this.#close(value, 'Pool idle timeout elapsed.')));
		const failures = settled
			.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
			.map((result) => result.reason);
		if (failures.length > 0) {
			throw new AggregateError(failures, 'One or more expired pooled values could not be closed.');
		}
	}

	/** Block one acquisition without transferring value ownership to the waiter. */
	#wait(ctx: Context): Promise<void> {
		if (this.#waiters.length >= this.#limits.maximumWaiting) {
			return Promise.reject(new PoolWaitLimitError(this.#limits.maximumWaiting));
		}
		return new Promise<void>((resolve, reject) => {
			const abort = () => {
				const index = this.#waiters.indexOf(waiter);
				if (index >= 0) this.#waiters.splice(index, 1);
				reject(ctx.signal.reason ?? new context.ContextCancelledError());
			};
			const unlink = () => ctx.signal.removeEventListener('abort', abort);
			const waiter: Waiter = { resolve, reject, unlink };
			if (ctx.signal.aborted) {
				reject(ctx.signal.reason ?? new context.ContextCancelledError());
				return;
			}
			this.#waiters.push(waiter);
			ctx.signal.addEventListener('abort', abort, { once: true });
		});
	}

	/** Wake the oldest waiter after release or cleanup may have made capacity available. */
	#wake(): void {
		const waiter = this.#waiters.shift();
		if (waiter === undefined) return;
		waiter.unlink();
		waiter.resolve();
	}

	/** Reject every waiter when drain makes future acquisition impossible. */
	#rejectAll(reason: unknown): void {
		while (this.#waiters.length > 0) {
			const waiter = this.#waiters.shift()!;
			waiter.unlink();
			waiter.reject(reason);
		}
	}

	/** Record one async transition that can still affect pool ownership. */
	#begin(): void {
		this.#operations += 1;
	}

	/** Finish one async ownership transition and re-evaluate the drain barrier. */
	#end(): void {
		this.#operations -= 1;
		if (this.#operations < 0) throw new Error('Pool active-operation count became negative.');
		this.#settle();
	}

	/** Release the drain barrier only when no lease, creation, or async ownership transition remains. */
	#settle(): void {
		if (this.#state !== 'draining' || this.#leased.size > 0 || this.#creating > 0 || this.#operations > 0) return;
		this.#resolve?.();
		this.#resolve = undefined;
	}

	/** Surface retained provider-close failures instead of reporting a clean drain. */
	#throwFailures(): void {
		if (this.#failures.length === 0) return;
		throw new AggregateError([...this.#failures], 'One or more pooled values could not be closed.');
	}

	/** Release partially initialized values and runtime resources after startup fails. */
	async #cleanup(primaryFailure: unknown): Promise<never> {
		await using resources = new AsyncDisposableStack();
		resources.use(this.#events);
		resources.use(this.#owner);
		this.#state = 'draining';
		const settled = await Promise.allSettled(
			this.#idle.splice(0).map((entry) => this.#close(entry.slot, primaryFailure)),
		);
		const closeFailures = settled
			.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
			.map((result) => result.reason);
		if (closeFailures.length > 0) {
			throw new AggregateError([primaryFailure, ...closeFailures], 'Pool startup and cleanup failed.');
		}
		throw primaryFailure;
	}
}

/** Validate and freeze pool limits before creating contexts or provider values. */
function resolve<Value>(options: CreateOptions<Value>): Limits {
	const minimum = nonNegativeInteger(options.minimum ?? 0, 'pool minimum');
	const maximum = positiveInteger(options.maximum, 'pool maximum');
	const maximumWaiting = nonNegativeInteger(options.maximumWaiting, 'pool maximumWaiting');
	if (minimum > maximum) throw new TypeError('Pool minimum must not exceed maximum.');
	const maximumIdle = nonNegativeInteger(options.maximumIdle ?? maximum, 'pool maximumIdle');
	if (maximumIdle > maximum) throw new TypeError('Pool maximumIdle must not exceed maximum.');
	if (maximumIdle < minimum) throw new TypeError('Pool maximumIdle must not be less than minimum.');
	const maximumIdleAge = options.maximumIdleAge === undefined
		? undefined
		: nonNegativeDuration(options.maximumIdleAge, 'pool maximumIdleAge');
	const acquireTimeout = options.acquireTimeout === undefined
		? undefined
		: positiveDuration(options.acquireTimeout, 'pool acquireTimeout');
	const maximumAge = options.maximumAge === undefined
		? undefined
		: positiveDuration(options.maximumAge, 'pool maximumAge');
	const maximumUses = options.maximumUses === undefined
		? undefined
		: positiveInteger(options.maximumUses, 'pool maximumUses');
	return Object.freeze({
		minimum,
		maximum,
		maximumWaiting,
		maximumIdle,
		maximumIdleAge,
		maximumAge,
		maximumUses,
		acquireTimeout,
	});
}

/** Validate one positive integer before it becomes a capacity limit. */
function positiveInteger(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer.`);
	return value;
}

/** Validate one non-negative integer before it becomes a capacity limit. */
function nonNegativeInteger(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer.`);
	return value;
}

/** Normalize a positive duration before it becomes an acquisition timing rule. */
function positiveDuration(value: Temporal.Duration | Temporal.DurationLike | string, label: string): Temporal.Duration {
	let parsed: Temporal.Duration;
	try {
		parsed = temporal.Duration.from(value);
	} catch {
		throw new TypeError(`${label} must be positive.`);
	}
	if (duration.compare(parsed, temporal.Duration.from('PT0S')) <= 0) throw new TypeError(`${label} must be positive.`);
	return parsed;
}

/** Normalize a non-negative duration before it becomes an idle-retirement timing rule. */
function nonNegativeDuration(
	value: Temporal.Duration | Temporal.DurationLike | string,
	label: string,
): Temporal.Duration {
	let parsed: Temporal.Duration;
	try {
		parsed = temporal.Duration.from(value);
	} catch {
		throw new TypeError(`${label} must not be negative.`);
	}
	if (duration.compare(parsed, temporal.Duration.from('PT0S')) < 0) {
		throw new TypeError(`${label} must not be negative.`);
	}
	return parsed;
}

export type { CreateOptions, Event, Lease, Pool, Stats } from './types.ts';

/**
 * Borrow and join lease disposal around one callback. Callback failure alone does not invalidate a resource;
 * call lease.invalidate(reason) when the provider state is unsafe. Standard async disposal preserves both
 * callback and release failures through SuppressedError.
 */
export async function withLease<Value, Output>(
	pool: Pool<Value>,
	ctx: Context,
	action: (value: Value, lease: Lease<Value>) => Output | PromiseLike<Output>,
): Promise<Output> {
	await using lease = await pool.acquire(ctx);
	return await action(lease.value, lease);
}
