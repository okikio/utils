import type { PoolEventType as Event } from '@okikio/telemetry/events';
import type { EventBus } from '@okikio/observables/events';
import type { Context } from '@okikio/context';
import type { Temporal } from '@okikio/duration/temporal';

/** Pool lifecycle event emitted after one state transition. */
export type { PoolEventType as Event } from '@okikio/telemetry/events';

/** Current bounded-capacity counters. */
export interface Stats {
	/** Current owner state; transitions determine whether new work can be admitted. */
	readonly state: 'active' | 'draining' | 'disposed';
	/** Configured minimum reusable values retained by the pool. */
	readonly minimum: number;
	/** Maximum values owned across creation, health checks, leases, return and close transitions. */
	readonly maximum: number;
	/** Maximum queued acquisitions. Zero rejects blocked callers; active creation and leases use maximum instead. */
	readonly maximumWaiting: number;
	/** Reusable pool values currently available without a live lease. */
	readonly idle: number;
	/** Pool values currently owned by borrowers. */
	readonly leased: number;
	/** Provider values whose creation has not yet settled. */
	readonly creating: number;
	/** Acquisition callers currently queued for pool capacity. */
	readonly waiting: number;
}

/** Caller-owned borrow of one reusable value. Repeated disposal joins the same return or close. */
export interface Lease<Value> extends AsyncDisposable {
	/** The exclusively borrowed connection, page or other value. Return the lease instead of closing this value yourself. */
	readonly value: Value;
	/** Instant when this lease was granted by the owning clock. */
	readonly acquiredAt: Temporal.Instant;
	/** Whether the borrower marked this lease unusable for future reuse. */
	readonly invalid: boolean;
	/** Mark a lease unhealthy without closing it while the borrower still owns it. */
	invalidate(reason?: unknown): void;
}

/** Bounded process-local owner of reusable values. Disposal joins all cleanup and retains its outcome for later callers. */
export interface Pool<Value> extends AsyncDisposable {
	/** Observation stream; terminal results and cancellation retain their separate authority. */
	readonly events: EventBus<Event>['events'];
	/** Borrow one value under an owned lease; disposing the lease returns or closes it. */
	acquire(ctx: Context): Promise<Lease<Value>>;
	/** Borrow this exact retained value by Object.is identity. Busy/missing rejects immediately; never creates or substitutes a value. */
	select(ctx: Context, value: Value): Promise<Lease<Value>>;
	/** Stop reuse of this exact value, join existing borrowers and close. Never await from inside its own lease. */
	retire(value: Value, reason?: unknown): Promise<void>;
	/** Return an immutable occupancy or progress snapshot without transferring ownership. */
	stats(): Stats;
	/** Snapshot of values already owned by slots, including leases and closing transitions. Does not transfer disposal authority. */
	values(): readonly Value[];
	/** Close expired idle values, preserving the minimum; reject with all retirement failures after attempting each close. */
	maintain(): Promise<void>;
	/** Stop admission and join idle closure and active transitions; retained provider-close failures reject every drain caller. */
	drain(reason?: unknown): Promise<void>;
}

/** Inputs accepted while creating a pool. */
export interface CreateOptions<Value> {
	/** Borrowed execution context for identity, cancellation, deadlines and clock access. */
	readonly ctx: Context;
	/** Minimum reusable values retained by the pool; omitted input defaults to zero. */
	readonly minimum?: number;
	/** Maximum values owned across creation, health checks, leases, return and close transitions. */
	readonly maximum: number;
	/** Maximum queued acquisitions. Zero rejects blocked callers; active creation and leases use maximum instead. */
	readonly maximumWaiting: number;
	/** Largest idle set retained for reuse after leases return. */
	readonly maximumIdle?: number;
	/** Maximum idle age enforced before reuse and by explicit maintenance. */
	readonly maximumIdleAge?: Temporal.Duration | Temporal.DurationLike | string;
	/** Optional maximum wait for a pool lease; it does not extend the caller deadline. */
	readonly acquireTimeout?: Temporal.Duration | Temporal.DurationLike | string;
	/** Create a provider value under the supplied execution lifetime. */
	readonly create: (ctx: Context) => Value | Promise<Value>;
	/** Reset borrower state before health checking and idle publication. Failure closes the value and rejects lease disposal. */
	readonly reset?: (value: Value) => void | Promise<void>;
	/** Maximum creation age before reuse. Active leases are never interrupted; retirement occurs on return or next acquisition. */
	readonly maximumAge?: Temporal.Duration | Temporal.DurationLike | string;
	/** Maximum granted leases per created value. Positive safe integer; retirement happens after the last lease returns. */
	readonly maximumUses?: number;
	/** Optional health check before reuse; false retires the value before a replacement is created. */
	readonly check?: (value: Value) => boolean | Promise<boolean>;
	/** Close one retired provider value; the pool joins this callback before releasing its capacity. */
	readonly close: (value: Value, reason?: unknown) => void | Promise<void>;
}
