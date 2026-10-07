import type { EventBus } from '@okikio/observables';
import type { Context } from '@okikio/context';

/** Pool lifecycle event emitted after one state transition. */
export type Event =
	| Readonly<{ readonly type: 'creating' }>
	| Readonly<{ readonly type: 'created' }>
	| Readonly<{ readonly type: 'acquired'; readonly acquiredAt: string }>
	| Readonly<{ readonly type: 'released'; readonly reusable: boolean }>
	| Readonly<{ readonly type: 'invalidated'; readonly reason?: unknown }>
	| Readonly<{ readonly type: 'closed-value'; readonly reason?: unknown }>
	| Readonly<{ readonly type: 'draining'; readonly reason?: unknown }>
	| Readonly<{ readonly type: 'disposed' }>;

/** Current bounded-capacity counters. */
export interface Stats {
	/** Current owner state; transitions determine whether new work can be admitted. */
	readonly state: 'active' | 'draining' | 'disposed';
	/** Configured minimum reusable values retained by the pool. */
	readonly minimum: number;
	/** Maximum values owned across creation, health checks, leases, return and close transitions. */
	readonly maximum: number;
	/** Reusable pool values currently available without a live lease. */
	readonly idle: number;
	/** Pool values currently owned by borrowers. */
	readonly leased: number;
	/** Provider values whose creation has not yet settled. */
	readonly creating: number;
	/** Acquisition callers currently queued for pool capacity. */
	readonly waiting: number;
}

/** Caller-owned borrow of one reusable value. */
export interface Lease<Value> extends AsyncDisposable {
	/** Value carried by this contract; its schema and owner define the accepted shape. */
	readonly value: Value;
	/** Instant when this lease was granted by the owning clock. */
	readonly acquiredAt: Temporal.Instant;
	/** Whether the borrower marked this lease unusable for future reuse. */
	readonly invalid: boolean;
	/** Mark a lease unhealthy without closing it while the borrower still owns it. */
	invalidate(reason?: unknown): void;
}

/** Bounded process-local owner of reusable values. */
export interface Pool<Value> extends AsyncDisposable {
	/** Observation stream; terminal results and cancellation retain their separate authority. */
	readonly events: EventBus<Event>['events'];
	/** Borrow one value under an owned lease; disposing the lease returns or closes it. */
	acquire(ctx: Context): Promise<Lease<Value>>;
	/** Return an immutable occupancy or progress snapshot without transferring ownership. */
	stats(): Stats;
	/** Close idle values older than the configured maximum age while preserving the minimum. */
	maintain(): Promise<void>;
	/** Stop new admission and wait for existing ownership transitions to settle. */
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
	/** Largest idle set retained for reuse after leases return. */
	readonly maximumIdle?: number;
	/** Maximum idle age enforced before reuse and by explicit maintenance. */
	readonly maximumIdleAge?: Temporal.Duration | Temporal.DurationLike | string;
	/** Optional maximum wait for a pool lease; it does not extend the caller deadline. */
	readonly acquireTimeout?: Temporal.Duration | Temporal.DurationLike | string;
	/** Create a provider value under the supplied execution lifetime. */
	readonly create: (ctx: Context) => Value | Promise<Value>;
	/** Optional health check before reuse; false retires the value before a replacement is created. */
	readonly check?: (value: Value) => boolean | Promise<boolean>;
	/** Close one retired provider value; the pool joins this callback before releasing its capacity. */
	readonly close: (value: Value, reason?: unknown) => void | Promise<void>;
}
