/**
 * Bounded reusable-value pooling with explicit disposable leases.
 *
 * The caller supplies value creation, health checks, and close behavior. The
 * pool owns admission, waiting, leasing, return, drain, and cleanup.
 *
 * @module
 */
import { EventBus } from '@okikio/observables';
import * as context from '@okikio/context';
import * as duration from '@okikio/duration';
import type { Context, Owned } from '@okikio/context';

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

/** One reusable value retained by the pool after its previous lease returned it. */
interface Idle<Value> {
	/** Pool-owned reusable value. */
	readonly value: Value;
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
}

/** Acquisition-scoped child context and its owned cleanup path. */
interface Acquisition {
	/** Context passed to provider creation and pool wait checks. */
	readonly ctx: Context;
	/** Normalized timeout used to map a deadline failure into the pool error type. */
	readonly timeout?: Temporal.Duration;
	/** Dispose every child context created only for this acquisition. */
	readonly dispose: () => Promise<void>;
}

/** Validated immutable limits captured before the pool starts provider work. */
interface Limits {
	/** Minimum number of retained reusable values. */
	readonly minimum: number;
	/** Maximum number of values owned, leased, or being created. */
	readonly maximum: number;
	/** Maximum number of returned values retained while idle. */
	readonly maximumIdle: number;
	/** Maximum idle age before a reusable value is retired. */
	readonly maximumIdleAge?: Temporal.Duration;
	/** Optional upper bound for one acquisition wait. */
	readonly acquireTimeout?: Temporal.Duration;
}

/**
 * Create a bounded reusable-value pool with explicit ownership and fair acquisition waits.
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
	readonly #leased = new Map<Value, LeaseState>();
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
	/** Resolver released only after every pool-owned transition has settled. */
	#resolve: (() => void) | undefined;

	/** Create one lifecycle owner and its frozen public facade without starting provider work. */
	constructor(options: CreateOptions<Value>, limits: Limits) {
		this.#options = options;
		this.#limits = limits;
		this.#owner = context.child(options.ctx, { id: `${options.ctx.id}:pool` });
		this.#pool = Object.freeze({
			events: this.#events.events,
			acquire: (ctx: Context) => this.acquire(ctx),
			stats: () => this.stats(),
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
				this.#idle.push({ value, returnedAt: this.#options.ctx.clock.now() });
			}
		} catch (error) {
			await this.#cleanup(error);
		}
	}

	/** Acquire one healthy value or wait FIFO until cancellation, timeout, or capacity changes. */
	async acquire(ctx: Context): Promise<Lease<Value>> {
		const acquisition = this.#context(ctx);
		this.#begin();
		try {
			while (true) {
				this.#check(acquisition.ctx);
				this.#admit();
				if (this.#idle.length === 0 && this.#owned() >= this.#limits.maximum) {
					await this.#wait(acquisition.ctx);
					continue;
				}

				await this.#expire();
				const reused = await this.#take();
				if (reused !== undefined) return this.#lease(reused);
				if (this.#owned() < this.#limits.maximum) {
					const value = await this.#create(acquisition.ctx);
					try {
						this.#check(acquisition.ctx);
						this.#admit();
					} catch (error) {
						await this.#discard(value, error);
					}
					return this.#lease(value);
				}
				await this.#wait(acquisition.ctx);
			}
		} catch (error) {
			if (acquisition.timeout !== undefined && error instanceof context.ContextDeadlineExceededError) {
				throw new PoolAcquireTimeoutError(acquisition.timeout);
			}
			throw error;
		} finally {
			try {
				await acquisition.dispose();
			} finally {
				this.#end();
			}
		}
	}

	/** Return an immutable snapshot of current pool occupancy and waiter pressure. */
	stats(): Stats {
		return Object.freeze({
			state: this.#state,
			minimum: this.#limits.minimum,
			maximum: this.#limits.maximum,
			idle: this.#idle.length,
			leased: this.#leased.size,
			creating: this.#creating,
			waiting: this.#waiters.length,
		});
	}

	/** Retire idle values that exceeded their age limit without reducing the configured minimum. */
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
		if (this.#state === 'disposed') return;
		if (this.#drain === undefined) {
			this.#state = 'draining';
			this.#reason = reason;
			this.#events.emit(Object.freeze({ type: 'draining', ...(reason === undefined ? {} : { reason }) }));
			this.#rejectAll(new PoolUnavailableError('draining', reason));
			this.#drain = new Promise<void>((resolve) => this.#resolve = resolve);

			const values = this.#idle.splice(0).map((entry) => entry.value);
			const settled = await Promise.allSettled(values.map((value) => this.#close(value, reason)));
			for (const result of settled) if (result.status === 'rejected') this.#failures.push(result.reason);
			this.#settle();
		}
		await this.#drain;
		this.#throwFailures();
	}

	/** Drain and release the owner context and event bus exactly once. */
	async dispose(): Promise<void> {
		if (this.#state === 'disposed') return;
		let drainFailed = false;
		let drainFailure: unknown;
		try {
			await this.drain('Pool was disposed.');
		} catch (error) {
			drainFailed = true;
			drainFailure = error;
		} finally {
			this.#state = 'disposed';
			await this.#owner[Symbol.asyncDispose]();
			this.#events.emit(Object.freeze({ type: 'disposed' }));
			this.#events[Symbol.dispose]();
		}
		if (drainFailed) throw drainFailure;
	}

	/** Build one acquisition child context and optionally tighten it with the configured timeout. */
	#context(ctx: Context): Acquisition {
		const borrowed = context.child(this.#owner, {
			id: ctx.id,
			signal: ctx.signal,
			deadline: ctx.deadline,
			clock: ctx.clock,
		});
		if (this.#limits.acquireTimeout === undefined) {
			return Object.freeze({
				ctx: borrowed,
				dispose: async () => await borrowed[Symbol.asyncDispose](),
			});
		}

		const timeout = this.#limits.acquireTimeout;
		const timed = context.deadline(borrowed, borrowed.clock.now().add(timeout));
		return Object.freeze({
			ctx: timed,
			timeout,
			dispose: async () => {
				await timed[Symbol.asyncDispose]();
				await borrowed[Symbol.asyncDispose]();
			},
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

	/** Count idle, leased, and in-flight-created values against the configured capacity. */
	#owned(): number {
		return this.#idle.length + this.#leased.size + this.#creating;
	}

	/** Create one provider value while keeping drain aware of in-flight ownership. */
	async #create(ctx: Context): Promise<Value> {
		this.#creating += 1;
		this.#events.emit(Object.freeze({ type: 'creating' }));
		try {
			const value = await this.#options.create(ctx);
			this.#events.emit(Object.freeze({ type: 'created' }));
			return value;
		} finally {
			this.#creating -= 1;
			this.#settle();
		}
	}

	/** Remove idle values from shared ownership until one passes the optional health check. */
	async #take(): Promise<Value | undefined> {
		while (this.#idle.length > 0) {
			const entry = this.#idle.shift()!;
			if (await this.#healthy(entry.value)) return entry.value;
			await this.#close(entry.value, 'Pool health check failed.');
		}
		return undefined;
	}

	/** Create one immutable lease whose disposal performs exactly one return-or-close transition. */
	#lease(value: Value): Lease<Value> {
		const acquiredAt = this.#options.ctx.clock.now();
		const state: LeaseState = { invalid: false, released: false };
		this.#leased.set(value, state);
		this.#events.emit(Object.freeze({ type: 'acquired', acquiredAt: acquiredAt.toString() }));

		return Object.freeze({
			value,
			acquiredAt,
			get invalid() { return state.invalid; },
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

	/** Return a released healthy value to idle ownership or close it before waking the next waiter. */
	async #release(value: Value, lease: LeaseState): Promise<void> {
		if (lease.released) return;
		lease.released = true;
		this.#begin();
		this.#leased.delete(value);
		let reusable = false;
		let releaseFailed = false;
		let releaseFailure: unknown;
		try {
			reusable = !lease.invalid && this.#state === 'active' && await this.#healthy(value);
			if (reusable && this.#idle.length < this.#limits.maximumIdle) {
				this.#idle.push({ value, returnedAt: this.#options.ctx.clock.now() });
			} else {
				reusable = false;
				await this.#close(value, lease.reason ?? this.#reason);
			}
		} catch (error) {
			releaseFailed = true;
			releaseFailure = error;
			this.#failures.push(error);
		} finally {
			this.#events.emit(Object.freeze({ type: 'released', reusable }));
			this.#wake();
			this.#end();
		}
		if (releaseFailed) throw releaseFailure;
	}

	/** Treat provider health-check exceptions as an unhealthy reusable value. */
	async #healthy(value: Value): Promise<boolean> {
		if (this.#options.check === undefined) return true;
		try {
			return await this.#options.check(value);
		} catch {
			return false;
		}
	}

	/** Close one pool-owned value and emit closure even when provider cleanup fails. */
	async #close(value: Value, reason?: unknown): Promise<void> {
		try {
			await this.#options.close(value, reason);
		} finally {
			this.#events.emit(Object.freeze({ type: 'closed-value', ...(reason === undefined ? {} : { reason }) }));
		}
	}

	/** Close a value created after its acquisition became invalid, preserving primary and cleanup failures. */
	async #discard(value: Value, primaryFailure: unknown): Promise<never> {
		try {
			await this.#close(value, primaryFailure);
		} catch (closeFailure) {
			throw new AggregateError([primaryFailure, closeFailure], 'Pool acquisition and cleanup failed.');
		}
		throw primaryFailure;
	}

	/** Retire expired idle values while preserving at least the configured minimum. */
	async #expire(): Promise<void> {
		if (this.#limits.maximumIdleAge === undefined || this.#idle.length === 0) return;
		const now = this.#options.ctx.clock.now();
		const retained: Idle<Value>[] = [];
		const expired: Value[] = [];
		for (const entry of this.#idle) {
			const age = entry.returnedAt.until(now);
			if (duration.compare(age, this.#limits.maximumIdleAge) >= 0 && this.#idle.length - expired.length > this.#limits.minimum) {
				expired.push(entry.value);
			} else {
				retained.push(entry);
			}
		}
		this.#idle.splice(0, this.#idle.length, ...retained);
		await Promise.allSettled(expired.map((value) => this.#close(value, 'Pool idle timeout elapsed.')));
	}

	/** Block one acquisition without transferring value ownership to the waiter. */
	#wait(ctx: Context): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let waiter!: Waiter;
			const abort = () => {
				const index = this.#waiters.indexOf(waiter);
				if (index >= 0) this.#waiters.splice(index, 1);
				reject(ctx.signal.reason ?? new context.ContextCancelledError());
			};
			const unlink = () => ctx.signal.removeEventListener('abort', abort);
			waiter = { resolve, reject, unlink };
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
		this.#state = 'draining';
		const settled = await Promise.allSettled(
			this.#idle.splice(0).map((entry) => this.#close(entry.value, primaryFailure)),
		);
		await this.#owner[Symbol.asyncDispose]();
		this.#events[Symbol.dispose]();
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
	return Object.freeze({ minimum, maximum, maximumIdle, maximumIdleAge, acquireTimeout });
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
		parsed = Temporal.Duration.from(value);
	} catch {
		throw new TypeError(`${label} must be positive.`);
	}
	if (duration.compare(parsed, Temporal.Duration.from('PT0S')) <= 0) throw new TypeError(`${label} must be positive.`);
	return parsed;
}

/** Normalize a non-negative duration before it becomes an idle-retirement timing rule. */
function nonNegativeDuration(value: Temporal.Duration | Temporal.DurationLike | string, label: string): Temporal.Duration {
	let parsed: Temporal.Duration;
	try {
		parsed = Temporal.Duration.from(value);
	} catch {
		throw new TypeError(`${label} must not be negative.`);
	}
	if (duration.compare(parsed, Temporal.Duration.from('PT0S')) < 0) throw new TypeError(`${label} must not be negative.`);
	return parsed;
}

export type { Event, Stats, Lease, Pool, CreateOptions } from './types.ts';
