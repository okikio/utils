/**
 * Give nested work one cancellation signal, deadline, clock and cleanup owner. Passing separate signals and timers through every call otherwise makes it easy to outlive the caller or forget a temporary resource.
 *
 * Start with create(), derive a child deadline for an expensive operation, and register cleanup on the context that owns it. Use view() or family scopes to attach capabilities without inventing a new lifetime. Snapshots carry identity and deadline across a transport; they do not carry resources or cancellation listeners. TestClock lets tests advance logical time without assuming a fast machine.
 *
 * @example
 * ```ts
 * import '@okikio/duration/polyfill';
 * import '@okikio/dispose/polyfill';
 * import * as context from '@okikio/context';
 * const clock = new context.TestClock();
 * await using parent = context.create({ id: 'import', clock });
 * await using child = context.timeout(parent, { seconds: 2 });
 * const waiting = context.wait(child, { seconds: 1 });
 * clock.advance({ seconds: 1 });
 * await waiting;
 * console.log(context.remaining(child)?.milliseconds);
 * ```
 *
 * @module
 */
import { delay as standardDelay } from '@std/async/delay';
import * as durationCore from '@okikio/duration';
import type { ChildOptions, Clock, Context, CreateOptions, Owned, RestoreOptions, Snapshot } from './types.ts';

const owners = new WeakMap<Owned, Readonly<{ controller: AbortController; dispose: () => Promise<void> }>>();
const views = new WeakMap<object, Context>();

/** Error raised when a context has been cancelled. */
export class ContextCancelledError extends Error {
	/** Caller or runtime reason retained for cancellation or failure diagnostics. */
	readonly reason: unknown;

	/** Create this ContextCancelledError from the explicit contract values supplied by its caller. */
	constructor(reason: unknown = undefined) {
		super('Context was cancelled.', reason === undefined ? undefined : { cause: reason });
		this.name = 'ContextCancelledError';
		this.reason = reason;
	}
}

/** Error raised when a context deadline has elapsed. */
export class ContextDeadlineExceededError extends Error {
	/** Latest permitted completion instant; serialized contexts use ISO timestamp text. */
	readonly deadline: Temporal.Instant;
	/** Instant when this observation was recorded. */
	readonly observedAt: Temporal.Instant;

	/** Create this ContextDeadlineExceededError from the explicit contract values supplied by its caller. */
	constructor(deadline: Temporal.Instant, observedAt: Temporal.Instant) {
		super(`Context deadline ${deadline.toString()} was exceeded at ${observedAt.toString()}.`);
		this.name = 'ContextDeadlineExceededError';
		this.deadline = deadline;
		this.observedAt = observedAt;
	}
}

/** Return whether a reason represents explicit context cancellation or deadline expiry. */
export function cancelled(value: unknown): boolean {
	return value instanceof ContextCancelledError || value instanceof ContextDeadlineExceededError;
}

/** Clock backed by the runtime's native Temporal implementation and timer queue. */
export const SystemClock = Object.freeze(
	{
		now: () => Temporal.Now.instant(),
		sleep: (milliseconds, signal) => delay(milliseconds, signal),
	} satisfies Clock,
);

type TestClockWaiter = Readonly<{
	target: Temporal.Instant;
	resolve: () => void;
	reject: (reason?: unknown) => void;
	signal?: AbortSignal;
	abort?: () => void;
}>;

/** Mutable deterministic clock intended for tests and simulations. */
export class TestClock implements Clock {
	#instant: Temporal.Instant;
	readonly #waiters = new Set<TestClockWaiter>();

	/** Create this TestClock from the explicit contract values supplied by its caller. */
	constructor(initial: Temporal.Instant | string = '2000-01-01T00:00:00Z') {
		this.#instant = toInstant(initial);
	}

	/** Return the current deterministic instant. */
	now(): Temporal.Instant {
		return this.#instant;
	}

	/** Wait until deterministic time advances by the requested milliseconds. */
	sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
		assertDelay(milliseconds);
		if (signal?.aborted) return Promise.reject(abortReason(signal));
		if (milliseconds === 0) return Promise.resolve();
		const target = this.#instant.add({ milliseconds });
		return new Promise<void>((resolve, reject) => {
			const settle = (action: () => void) => {
				if (!this.#waiters.delete(waiter)) return;
				if (waiter.signal !== undefined && waiter.abort !== undefined) {
					waiter.signal.removeEventListener('abort', waiter.abort);
				}
				action();
			};
			const abort = signal === undefined ? undefined : () => settle(() => reject(abortReason(signal)));
			const waiter: TestClockWaiter = Object.freeze({
				target,
				resolve: () => settle(resolve),
				reject,
				...(signal ? { signal, abort } : {}),
			});
			this.#waiters.add(waiter);
			if (signal !== undefined && abort !== undefined) signal.addEventListener('abort', abort, { once: true });
		});
	}

	/** Set deterministic time and release sleepers whose target is now due. */
	set(instant: Temporal.Instant | string): void {
		this.#instant = toInstant(instant);
		this.#wake();
	}

	/** Advance deterministic time and release sleepers whose target is now due. */
	advance(duration: Temporal.Duration | Temporal.DurationLike | string): Temporal.Instant {
		this.#instant = this.#instant.add(Temporal.Duration.from(duration));
		this.#wake();
		return this.#instant;
	}

	#wake(): void {
		for (const waiter of [...this.#waiters]) {
			if (Temporal.Instant.compare(waiter.target, this.#instant) <= 0) waiter.resolve();
		}
	}
}

/** Create one independently owned context. */
export function create(options: CreateOptions): Owned {
	assertIdentifier(options.id, 'id');
	if (options.traceId !== undefined) assertIdentifier(options.traceId, 'traceId');
	if (options.deploymentId !== undefined) assertIdentifier(options.deploymentId, 'deploymentId');
	if (options.idempotencyKey !== undefined) assertIdentifier(options.idempotencyKey, 'idempotencyKey');

	const clock = options.clock ?? SystemClock;
	const startedAt = options.startedAt ?? clock.now();
	const controller = new AbortController();
	const resources = new AsyncDisposableStack();
	const unlinkParent = linkSignal(options.signal, controller);
	let resolveClosed!: () => void;
	const closed = new Promise<void>((resolve) => resolveClosed = resolve);
	let disposal: Promise<void> | undefined;
	let deadlineWait: Promise<void> | undefined;

	if (options.deadline !== undefined) {
		deadlineWait = waitForDeadline(options.deadline, clock, controller);
	}

	const dispose = (): Promise<void> => {
		if (disposal !== undefined) return disposal;
		unlinkParent();
		if (!controller.signal.aborted) controller.abort(new ContextCancelledError('Context was disposed.'));
		disposal = resources.disposeAsync().finally(
			deadlineWait === undefined ? resolveClosed : async () => {
				await deadlineWait;
				resolveClosed();
			},
		);
		return disposal;
	};

	const owned = Object.freeze(
		{
			id: options.id,
			...(options.traceId !== undefined ? { traceId: options.traceId } : {}),
			...(options.deploymentId !== undefined ? { deploymentId: options.deploymentId } : {}),
			...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
			startedAt,
			...(options.deadline !== undefined ? { deadline: options.deadline } : {}),
			signal: controller.signal,
			clock,
			closed,
			use<Value extends Disposable | AsyncDisposable | null | undefined>(value: Value): Value {
				return resources.use(value);
			},
			adopt<Value>(value: Value, disposer: (value: Value) => void | PromiseLike<void>): Value {
				return resources.adopt(value, disposer);
			},
			defer(disposer: () => void | PromiseLike<void>): void {
				resources.defer(disposer);
			},
			[Symbol.asyncDispose]() {
				return dispose();
			},
		} satisfies Owned,
	);
	owners.set(owned, Object.freeze({ controller, dispose }));
	return owned;
}

/** Derive a child context that inherits identity, cancellation, and the parent deadline. */
export function child(parent: Context, options: ChildOptions = {}): Owned {
	const resolvedDeadline = earlier(parent.deadline, options.deadline);
	return create({
		id: options.id ?? parent.id,
		...(options.traceId ?? parent.traceId ? { traceId: options.traceId ?? parent.traceId } : {}),
		...(options.deploymentId ?? parent.deploymentId
			? { deploymentId: options.deploymentId ?? parent.deploymentId }
			: {}),
		...(options.idempotencyKey ?? parent.idempotencyKey
			? { idempotencyKey: options.idempotencyKey ?? parent.idempotencyKey }
			: {}),
		startedAt: parent.startedAt,
		...(resolvedDeadline ? { deadline: resolvedDeadline } : {}),
		signal: options.signal === undefined ? parent.signal : combineSignals([parent.signal, options.signal]),
		clock: options.clock ?? parent.clock,
	});
}

/** Derive a child with an absolute deadline that cannot exceed its parent's deadline. */
export function deadline(parent: Context, value: Temporal.Instant): Owned {
	return child(parent, { deadline: value });
}

/**
 * Start a deadline wait and return the owner of a child operation.
 *
 * Like a timer, the wait becomes due after the supplied duration. Its action is
 * to abort the child's signal; this function does not run a callback or await
 * work. Pass the signal to cooperative I/O and check it between synchronous
 * steps. The inherited clock controls the wait, and an earlier parent deadline
 * still wins.
 *
 * The returned `Owned` context needs `await using` or explicit awaited disposal.
 * Disposal cancels the deadline wait, removes the parent listener, and releases
 * child-owned resources. Deadline expiry alone does not dispose those resources,
 * and disposing this child does not cancel its parent.
 *
 * @returns A child context immediately, not a Promise for the operation's value.
 */
export function timeout(parent: Context, duration: Temporal.DurationLike | string): Owned {
	const value = parent.clock.now().add(Temporal.Duration.from(duration));
	return deadline(parent, value);
}

/**
 * Create a typed view that adds runtime-local fields without creating a new lifetime.
 *
 * The view retains the source context's cancellation and ownership identity. It is
 * useful when a focused utility adds one execution capability, such as permissions
 * or declared effects, while another utility adds a different typed view to the
 * same operation. Views can be nested safely.
 *
 * Stable Context properties cannot be replaced at compile time, and no property
 * already present on the concrete runtime value can be replaced at runtime. The
 * runtime check is necessary because generic composition helpers cannot always
 * prove whether an earlier view added the same extension key. Use `child()` when
 * work needs a new independently owned cancellation and cleanup lifetime.
 */
export function view<Base extends Context, Extension extends object>(
	base: Base,
	extension: Extension & { readonly [Key in Extract<keyof Extension, keyof Context>]: never },
): Base & Readonly<Extension> {
	for (const key of Reflect.ownKeys(extension)) {
		if (key in base) throw new TypeError(`Context view cannot replace existing property ${String(key)}.`);
	}
	const value = Object.freeze({ ...base, ...extension }) as Base & Readonly<Extension>;
	views.set(value, base);
	return value;
}

/** Cancel an owned context or a view of that owned context. Repeated cancellation is harmless. */
export function cancel(value: Owned, reason: unknown = new ContextCancelledError()): void {
	const owner = findOwner(value);
	if (owner === undefined) throw new TypeError('Context is not owned by @okikio/context.');
	if (!owner.controller.signal.aborted) owner.controller.abort(reason);
}

/** Throw the appropriate cancellation or deadline error when work must stop. */
export function check(value: Pick<Context, 'clock' | 'deadline' | 'signal'>): void {
	if (value.deadline !== undefined) {
		const observedAt = value.clock.now();
		if (Temporal.Instant.compare(observedAt, value.deadline) >= 0) {
			throw new ContextDeadlineExceededError(value.deadline, observedAt);
		}
	}
	if (!value.signal.aborted) return;
	const reason = value.signal.reason;
	if (reason instanceof ContextDeadlineExceededError || reason instanceof ContextCancelledError) throw reason;
	throw new ContextCancelledError(reason);
}

/** Return the cancellation reason without changing control flow. */
export function cause(value: Pick<Context, 'signal'>): unknown {
	return value.signal.aborted ? value.signal.reason : undefined;
}

/** Return the non-negative time remaining before the deadline. */
export function remaining(value: Pick<Context, 'clock' | 'deadline'>): Temporal.Duration | undefined {
	if (value.deadline === undefined) return undefined;
	return Temporal.Duration.from({ milliseconds: Math.max(0, millisecondsUntil(value.deadline, value.clock.now())) });
}

/**
 * Wait for a context-scoped duration.
 *
 * This is the context-aware convenience form of `delay()`. It observes the
 * context before and after the timer, converts context cancellation into the
 * context error model, and never hides an elapsed deadline.
 */
export async function wait(
	ctx: Pick<Context, 'clock' | 'deadline' | 'signal'>,
	duration: Temporal.Duration | Temporal.DurationLike | string,
): Promise<void> {
	check(ctx);
	const milliseconds = durationMilliseconds(duration);
	try {
		await ctx.clock.sleep(milliseconds, ctx.signal);
	} catch (error) {
		check(ctx);
		throw error;
	}
	check(ctx);
}

/**
 * Wait for one external cooperative gate while the context remains cancellable.
 *
 * `listen` owns the external gate and returns the cleanup that removes its
 * resume callback. This helper owns the context abort listener and removes both
 * listeners when either path settles. It does not cancel work outside the gate.
 */
export function waitFor(
	ctx: Pick<Context, 'signal'>,
	listen: (resume: () => void) => () => void,
): Promise<void> {
	if (ctx.signal.aborted) return Promise.reject(new ContextCancelledError(ctx.signal.reason));
	return new Promise<void>((resolve, reject) => {
		let remove = () => {};
		let settled = false;
		const finish = (action: () => void): void => {
			if (settled) return;
			settled = true;
			ctx.signal.removeEventListener('abort', abort);
			remove();
			action();
		};
		const resume = () => finish(resolve);
		const abort = () => finish(() => reject(new ContextCancelledError(ctx.signal.reason)));
		ctx.signal.addEventListener('abort', abort, { once: true });
		try {
			remove = listen(resume);
		} catch (error) {
			finish(() => reject(error));
			return;
		}
		if (settled) remove();
		else if (ctx.signal.aborted) abort();
	});
}

/**
 * Return whether a value settles before the supplied clock reaches a duration.
 *
 * Settlement includes fulfillment and rejection. This helper does not cancel the
 * value when time expires. It only cancels its own clock wait, so a host can
 * continue its existing shutdown or cleanup policy after a `false` result.
 */
export async function settles(
	value: PromiseLike<unknown>,
	milliseconds: number,
	clock: Pick<Clock, 'sleep'> = SystemClock,
): Promise<boolean> {
	if (milliseconds <= 0) return false;
	assertDelay(milliseconds);
	const controller = new AbortController();
	try {
		return await Promise.race([
			Promise.resolve(value).then(() => true, () => true),
			clock.sleep(milliseconds, controller.signal).then(() => false),
		]);
	} finally {
		controller.abort();
	}
}

/**
 * Delay for a bounded number of milliseconds using `@std/async/delay`.
 *
 * Passing an `AbortSignal` is equivalent to calling
 * `@std/async/delay(milliseconds, { signal })`. An `AbortController` is a
 * convenience accepted by this utility and is normalized to its signal.
 */
export function delay(
	milliseconds: number,
	cancellation?: AbortSignal | AbortController,
): Promise<void> {
	assertDelay(milliseconds);
	const signal = cancellation instanceof AbortController ? cancellation.signal : cancellation;
	return signal === undefined ? standardDelay(milliseconds) : standardDelay(milliseconds, { signal });
}

/** Validate the bounded timer range shared by system and deterministic clocks. @internal */
function assertDelay(milliseconds: number): void {
	if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 2_147_483_647) {
		throw new RangeError('Delay must be between 0 and 2147483647 milliseconds.');
	}
}

/** Return an AbortSignal reason with a standards-compatible fallback. @internal */
function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

/** Create a serializable context snapshot. Cancellation is intentionally not serialized. */
export function snapshot(value: Context): Snapshot {
	return Object.freeze({
		id: value.id,
		...(value.traceId !== undefined ? { traceId: value.traceId } : {}),
		...(value.deploymentId !== undefined ? { deploymentId: value.deploymentId } : {}),
		...(value.idempotencyKey !== undefined ? { idempotencyKey: value.idempotencyKey } : {}),
		startedAt: value.startedAt.toString(),
		...(value.deadline !== undefined ? { deadline: value.deadline.toString() } : {}),
	});
}

/** Restore a snapshot into a new local context and cancellation controller. */
export function restore(value: Snapshot, options: RestoreOptions = {}): Owned {
	return create({
		id: value.id,
		...(value.traceId !== undefined ? { traceId: value.traceId } : {}),
		...(value.deploymentId !== undefined ? { deploymentId: value.deploymentId } : {}),
		...(value.idempotencyKey !== undefined ? { idempotencyKey: value.idempotencyKey } : {}),
		startedAt: Temporal.Instant.from(value.startedAt),
		...(value.deadline !== undefined ? { deadline: Temporal.Instant.from(value.deadline) } : {}),
		...(options.signal !== undefined ? { signal: options.signal } : {}),
		...(options.clock !== undefined ? { clock: options.clock } : {}),
	});
}

/** Resolve the owner behind zero or more runtime-local context views. */
function findOwner(
	value: Context,
): Readonly<{ controller: AbortController; dispose: () => Promise<void> }> | undefined {
	let current: Context | undefined = value;
	const seen = new Set<Context>();
	while (current !== undefined && !seen.has(current)) {
		seen.add(current);
		const owner = owners.get(current as Owned);
		if (owner !== undefined) return owner;
		current = views.get(current);
	}
	return undefined;
}

/** Compose cancellation signals for an unowned view. */
export function combineSignals(signals: Iterable<AbortSignal | undefined>): AbortSignal {
	const active = [...signals].filter((signal): signal is AbortSignal => signal !== undefined);
	if (active.length === 0) return new AbortController().signal;
	if (active.length === 1) return active[0]!;
	return AbortSignal.any(active);
}

/**
 * Forward a parent abort exactly once and return the listener removal function.
 *
 * A parent that is already aborted must cancel the child before it is returned.
 * The child owner calls the returned function during cleanup, so the parent
 * never retains a completed operation through this listener.
 *
 * @internal
 */
function linkSignal(parent: AbortSignal | undefined, childController: AbortController): () => void {
	if (parent === undefined) return () => {};
	const abort = () => {
		if (!childController.signal.aborted) childController.abort(parent.reason);
	};
	if (parent.aborted) {
		abort();
		return () => {};
	}
	parent.addEventListener('abort', abort, { once: true });
	return () => parent.removeEventListener('abort', abort);
}

/**
 * Selects the earlier of two optional deadlines so child contexts can only shorten, never extend, parent lifetime.
 *
 * @internal
 */
function earlier(
	left: Temporal.Instant | undefined,
	right: Temporal.Instant | undefined,
): Temporal.Instant | undefined {
	if (left === undefined) return right;
	if (right === undefined) return left;
	return Temporal.Instant.compare(right, left) < 0 ? right : left;
}

/** Convert a non-calendar duration to the bounded millisecond delay used by runtime timers. @internal */
function durationMilliseconds(value: Temporal.Duration | Temporal.DurationLike | string): number {
	const duration = Temporal.Duration.from(value);
	if (duration.years !== 0 || duration.months !== 0) {
		throw new RangeError('Context wait does not accept calendar years or months.');
	}
	const milliseconds = durationCore.milliseconds(duration);
	if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 2_147_483_647) {
		throw new RangeError('Context wait duration must be between 0 and 2147483647 milliseconds.');
	}
	return milliseconds;
}

/**
 * Keep the absolute deadline authoritative across bounded clock waits.
 * A long deadline can require several timer slices. Recheck after each slice
 * rather than treating the timer limit as the deadline. Abort stops scheduling;
 * disposal joins this waiter before reporting the owner closed.
 * @internal
 */
async function waitForDeadline(deadline: Temporal.Instant, clock: Clock, controller: AbortController): Promise<void> {
	try {
		while (!controller.signal.aborted) {
			const now = clock.now();
			const milliseconds = millisecondsUntil(deadline, now);
			if (milliseconds === 0) {
				controller.abort(new ContextDeadlineExceededError(deadline, now));
				return;
			}
			await clock.sleep(milliseconds, controller.signal);
		}
	} catch (error) {
		// Cancellation settles the wait; an independent clock failure must not
		// silently leave deadline-bound work active without a functioning timer.
		if (!controller.signal.aborted) controller.abort(error);
	}
}

/** Round future nanoseconds up to a bounded timer delay so a fractional millisecond cannot expire early. @internal */
function millisecondsUntil(deadline: Temporal.Instant, now: Temporal.Instant): number {
	const difference = deadline.epochNanoseconds - now.epochNanoseconds;
	if (difference <= 0n) return 0;
	const milliseconds = (difference + 999_999n) / 1_000_000n;
	return Number(milliseconds > 2_147_483_647n ? 2_147_483_647n : milliseconds);
}

/**
 * Converts the source value to instant expected by the operation context.
 *
 * @internal
 */
function toInstant(value: Temporal.Instant | string): Temporal.Instant {
	return typeof value === 'string' ? Temporal.Instant.from(value) : value;
}

/**
 * Rejects invalid identifier before it can enter authoritative module state.
 *
 * @internal
 */
function assertIdentifier(value: string, name: string): void {
	if (value.trim().length === 0) throw new TypeError(`${name} must not be empty.`);
	if (value.length > 512) throw new TypeError(`${name} must not exceed 512 characters.`);
}

export type {
	ChildOptions,
	Clock,
	Context,
	CreateOptions,
	Owned,
	Resources,
	RestoreOptions,
	Snapshot,
} from './types.ts';
