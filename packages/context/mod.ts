/**
 * Give an operation and its nested work one cancellation signal, clock, and cleanup owner. For example, a
 * request can give a download a shorter deadline while keeping it within the request's lifetime.
 *
 * Create an owner, derive a child when work needs its own lifetime, and register cleanup with the owner
 * that acquired the resource. A view adds capabilities to an existing lifetime. It does not create another
 * owner.
 *
 * Snapshots carry identity and deadlines across a transport. They do not transfer resources or
 * cancellation listeners. TestClock lets tests advance logical time explicitly.
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
 * console.log(context.remaining(child)?.total('milliseconds'));
 * ```
 *
 * @module
 */
import { AsyncDisposableStack, asyncDispose, DisposableStack } from '@okikio/dispose';
import { delay as standardDelay } from '@std/async/delay';
import * as durationCore from '@okikio/duration';
import { type Temporal, temporal } from '@okikio/duration/temporal';
import * as record from '@okikio/collection/record';
import type { ChildOptions, Clock, Context, CreateOptions, Owned, RestoreOptions, Snapshot } from './types.ts';

/** Identity, clock and cleanup authority always remain with the source lifetime. */
const lifetimeKeys = new Set<PropertyKey>([
	'id',
	'traceId',
	'deploymentId',
	'idempotencyKey',
	'startedAt',
	'deadline',
	'signal',
	'clock',
	'closed',
	'use',
	'adopt',
	'defer',
	'instrument',
	asyncDispose,
]);

/** Cancellation and cleanup authority is attached only to owners, never copied into a borrowed view. */
const owners = new WeakMap<Owned, Readonly<{ controller: AbortController; dispose: () => Promise<void> }>>();
/** Resolve nested capability views back to their source lifetime without retaining either object globally. */
const views = new WeakMap<object, Context>();

/** Error raised when a context has been cancelled. */
export class ContextCancelledError extends Error {
	/** Caller or runtime reason retained for cancellation or failure diagnostics. */
	readonly reason: unknown;

	/** Retain the caller's exact reason; a provider error can be inspected through cause and reason. */
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

	/** Record both the promised deadline and when the owning clock observed expiry. */
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

/** Clock backed by the selected local Temporal implementation and the runtime's timer queue. */
export const SystemClock = Object.freeze(
	{
		now: (): Temporal.Instant => temporal.Now.instant(),
		sleep: (milliseconds: number, signal: AbortSignal | undefined): Promise<void> => delay(milliseconds, signal),
	} satisfies Clock,
);

/** One simulated sleep and its abort registration. Waking or aborting removes the same waiter before settling it. */
type TestClockWaiter = Readonly<{
	target: Temporal.Instant;
	resolve: () => void;
	reject: (reason?: unknown) => void;
	signal?: AbortSignal;
	abort?: () => void;
}>;

/** Mutable deterministic clock intended for tests and simulations. */
export class TestClock implements Clock {
	/** Current simulated instant. Moving time wakes sleepers but does not run their asynchronous continuations. */
	#instant: Temporal.Instant;
	/** Live sleeps only; abort and wake remove each waiter and its listener exactly once. */
	readonly #waiters = new Set<TestClockWaiter>();

	/** Start from a chosen absolute instant; the default is 2000-01-01 UTC and schedules no native timer. */
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
			/** Remove authority to settle first: an abort racing with a clock advance must complete this sleep only once. */
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

	/** Inspect ordered due instants without acquiring, waking or cancelling any sleeper. */
	pending(): readonly Temporal.Instant[] {
		return Object.freeze([...this.#waiters].map((waiter) => waiter.target).sort(temporal.Instant.compare));
	}

	/** Set deterministic time and release sleepers whose target is now due. */
	set(instant: Temporal.Instant | string): void {
		this.#instant = toInstant(instant);
		this.#wake();
	}

	/** Advance deterministic time and release sleepers whose target is now due. */
	advance(duration: Temporal.Duration | Temporal.DurationLike | string): Temporal.Instant {
		this.#instant = elapsedTarget(this.#instant, duration);
		this.#wake();
		return this.#instant;
	}

	/** Wake a snapshot of due sleepers; settlement can remove entries while this pass runs. */
	#wake(): void {
		for (const waiter of [...this.#waiters]) {
			if (temporal.Instant.compare(waiter.target, this.#instant) <= 0) waiter.resolve();
		}
	}
}

/**
 * Create an operation owner with its own cancellation and cleanup stack.
 *
 * A supplied signal is borrowed and linked until disposal. Clock and instrument
 * are also borrowed. The owner disposes only values explicitly registered with
 * use/adopt/defer; aborting its signal alone does not run that cleanup stack.
 * Every disposal call joins the same completion, including calls from an abort
 * observer or a cleanup callback. The closed observation settles after cleanup
 * and deadline retirement even when disposal rejects with a cleanup failure.
 * Cleanup callbacks must not await this same disposal completion: the completion
 * is waiting for those callbacks, so doing so creates a dependency cycle.
 */
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
	/** Published before any callback can reenter; all callers join the entire cleanup lifetime. */
	let disposal: Promise<void> | undefined;
	let deadlineWait: Promise<void> | undefined;

	if (options.deadline !== undefined) {
		deadlineWait = waitForDeadline(options.deadline, clock, controller);
	}

	/**
	 * Cancel once, then join resources, the deadline wait, and the final closed notification.
	 * Publish the shared promise before cleanup can call back into disposal.
	 */
	const dispose = (): Promise<void> => {
		if (disposal !== undefined) return disposal;
		const completion = Promise.withResolvers<void>();
		disposal = completion.promise;

		// Closed is the last observation, after resources and the canceled clock
		// have retired. A cleanup failure must not skip either remaining action.
		const closing = new AsyncDisposableStack();
		closing.defer(resolveClosed);
		closing.defer(async () => {
			await deadlineWait;
		});
		closing.use(resources);

		// Unlink and abort synchronously so callers see cancellation immediately.
		// Structural signal implementations may throw while unlinking; cancellation
		// and owned cleanup still run, with all failures retained by the stacks.
		const cancellation = new DisposableStack();
		cancellation.defer(() => {
			if (!controller.signal.aborted) controller.abort(new ContextCancelledError('Context was disposed.'));
		});
		cancellation.defer(unlinkParent);
		try {
			cancellation.dispose();
		} catch (error) {
			closing.defer(() => {
				throw error;
			});
		}
		void closing.disposeAsync().then(completion.resolve, completion.reject);
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
			...(options.instrument === undefined ? {} : { instrument: options.instrument }),
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
			[asyncDispose]() {
				return dispose();
			},
		} satisfies Owned,
	);
	owners.set(owned, Object.freeze({ controller, dispose }));
	return owned;
}

/**
 * Derive a separately owned child that inherits identity, cancellation, and the
 * earlier of the two deadlines. Parent cancellation reaches the child signal;
 * it does not join the child cleanup. Dispose each returned child at its owner.
 */
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
		...((options.instrument ?? parent.instrument) === undefined
			? {}
			: { instrument: options.instrument ?? parent.instrument }),
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
 * still wins. Days mean 24 elapsed hours and weeks mean seven days; months and
 * years require a caller-chosen calendar and therefore reject here.
 *
 * The returned `Owned` context needs `await using` or explicit awaited disposal.
 * Disposal cancels the deadline wait, removes the parent listener, and releases
 * child-owned resources. Deadline expiry alone does not dispose those resources,
 * and disposing this child does not cancel its parent.
 *
 * @returns A child context immediately, not a Promise for the operation's value.
 */
export function timeout(parent: Context, duration: Temporal.DurationLike | string): Owned {
	const value = elapsedTarget(parent.clock.now(), duration);
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
 * Context identity and lifetime operations cannot be replaced. Additional
 * capability fields use explicit shallow overrides, so a permission view can
 * narrow an earlier permission set without mutating its source. The result type
 * removes overridden fields before applying the replacement types. Use child()
 * when work needs a new independently owned cancellation and cleanup lifetime.
 */
export function view<Base extends Context, Extension extends object>(
	base: Base,
	extension: Extension & { readonly [Key in Extract<keyof Extension, keyof Owned>]: never },
): Omit<Base, keyof Extension> & Readonly<Extension> {
	for (
		let owner: object | null = extension;
		owner !== null && owner !== Object.prototype;
		owner = Object.getPrototypeOf(owner)
	) {
		for (const key of Reflect.ownKeys(owner)) {
			if (lifetimeKeys.has(key)) throw new TypeError(`Context view cannot replace lifetime property ${String(key)}.`);
		}
	}
	const value = Object.create(Object.getPrototypeOf(base)) as Omit<Base, keyof Extension> & Readonly<Extension>;
	delegateProperties(value, extension);
	delegateProperties(value, base);
	Object.freeze(value);
	views.set(value, base);
	return value;
}

/**
 * Delegate data, getters and methods without flattening a class or changing its receiver.
 *
 * A view borrows the original object. Forwarding getters preserves non-enumerable
 * and inherited fields; binding method reads preserves private-field receivers.
 * The cache keeps repeated reads of the same method stable without modifying it.
 */
function delegateProperties(target: object, source: object): void {
	const methods = new WeakMap<(...args: never[]) => unknown, (...args: never[]) => unknown>();
	for (
		let owner: object | null = source;
		owner !== null && owner !== Object.prototype;
		owner = Object.getPrototypeOf(owner)
	) {
		for (const key of Reflect.ownKeys(owner)) {
			if (Object.hasOwn(target, key)) continue;
			const descriptor = Object.getOwnPropertyDescriptor(owner, key)!;
			const read = (): unknown => {
				const value: unknown = Reflect.get(source, key, source);
				if (typeof value !== 'function' || key === 'constructor') return value;
				const callable = value as (...args: never[]) => unknown;
				let method = methods.get(callable);
				if (method === undefined) {
					method = callable.bind(source);
					methods.set(callable, method);
				}
				return method;
			};
			Object.defineProperty(target, key, {
				enumerable: descriptor.enumerable,
				configurable: false,
				// Data descriptors retain their public shape and exact capability identity.
				// Getters still delegate to the original receiver instead of being flattened.
				...('value' in descriptor ? { value: read(), writable: false } : { get: read }),
			});
		}
	}
}

/** Cancel an owned context or a view of that owned context. Repeated cancellation is harmless. */
export function cancel(value: Owned, reason: unknown = new ContextCancelledError()): void {
	const owner = findOwner(value);
	if (owner === undefined) throw new TypeError('Context is not owned by @okikio/context.');
	if (!owner.controller.signal.aborted) owner.controller.abort(reason);
}

/**
 * Check the current clock before cancellation, so an elapsed deadline wins even
 * before its timer continuation runs. Non-context abort reasons are wrapped in
 * ContextCancelledError; cause() retains the original signal reason.
 */
export function check(value: Pick<Context, 'clock' | 'deadline' | 'signal'>): void {
	if (value.deadline !== undefined) {
		const observedAt = value.clock.now();
		if (temporal.Instant.compare(observedAt, value.deadline) >= 0) {
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

/** Return the exact non-negative time remaining, without timer rounding or timer-length limits. */
export function remaining(value: Pick<Context, 'clock' | 'deadline'>): Temporal.Duration | undefined {
	if (value.deadline === undefined) return undefined;
	const now = value.clock.now();
	return temporal.Instant.compare(value.deadline, now) <= 0
		? temporal.Duration.from({ seconds: 0 })
		: now.until(value.deadline);
}

/**
 * Wait for a context-scoped duration.
 *
 * Days and weeks are fixed elapsed time; months and years require an external
 * calendar and reject. Long waits use bounded timer slices while the absolute
 * target remains authoritative. A sub-millisecond remainder rounds up only at
 * the timer call, so the wait cannot finish early. Cancellation uses the context
 * error model and leaves the parent's resources with their existing owner.
 */
export async function wait(
	ctx: Pick<Context, 'clock' | 'deadline' | 'signal'>,
	duration: Temporal.Duration | Temporal.DurationLike | string,
): Promise<void> {
	check(ctx);
	const nanoseconds = durationCore.elapsedNanoseconds(duration);
	if (nanoseconds < 0n) throw new RangeError('Context wait duration must not be negative.');
	const target = new temporal.Instant(ctx.clock.now().epochNanoseconds + nanoseconds);
	try {
		// Retain the zero-duration scheduling opportunity while slicing longer waits.
		do {
			await ctx.clock.sleep(millisecondsUntil(target, ctx.clock.now()), ctx.signal);
			check(ctx);
		} while (temporal.Instant.compare(ctx.clock.now(), target) < 0);
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
 * listeners before its Promise settles. Registration may resume or abort
 * synchronously; settlement waits until its cleanup callback is available.
 * Cleanup must be synchronous. A cleanup failure rejects, preserving a prior
 * cancellation or registration failure through SuppressedError. This helper
 * does not cancel work outside the gate.
 */
export function waitFor(
	ctx: Pick<Context, 'signal'>,
	listen: (resume: () => void) => () => void,
): Promise<void> {
	if (ctx.signal.aborted) return Promise.reject(new ContextCancelledError(ctx.signal.reason));
	return new Promise<void>((resolve, reject) => {
		const resources = new DisposableStack();
		/** A synchronous resume is provisional until registration supplies its cleanup. */
		let registering = true;
		let settled = false;
		let outcome: { readonly kind: 'resume' } | { readonly kind: 'abort'; readonly reason: unknown } | undefined;
		/** Release both listeners once; preserve a rejection even when a cleanup also throws. */
		const settle = (): void => {
			if (registering || settled || outcome === undefined) return;
			settled = true;
			const selected = outcome;
			if (selected.kind === 'abort') {
				resources.defer(() => {
					throw selected.reason;
				});
			}
			try {
				resources.dispose();
				resolve();
			} catch (error) {
				reject(error);
			}
		};
		const resume = (): void => {
			outcome ??= { kind: 'resume' };
			settle();
		};
		const abort = (): void => {
			outcome ??= { kind: 'abort', reason: new ContextCancelledError(ctx.signal.reason) };
			settle();
		};
		try {
			resources.defer(() => ctx.signal.removeEventListener('abort', abort));
			ctx.signal.addEventListener('abort', abort, { once: true });
			if (ctx.signal.aborted) abort();
			if (outcome === undefined) resources.defer(listen(resume));
		} catch (error) {
			// A registration failure remains observable even after a synchronous
			// resume; the Promise has not yet reported successful completion.
			resources.defer(() => {
				throw error;
			});
			outcome ??= { kind: 'resume' };
		} finally {
			registering = false;
			settle();
		}
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
	const signal = cancellation !== undefined && 'signal' in cancellation ? cancellation.signal : cancellation;
	return signal === undefined ? standardDelay(milliseconds) : standardDelay(milliseconds, { signal });
}

/** Validate the bounded timer range shared by system and deterministic clocks. @internal */
function assertDelay(milliseconds: number): void {
	if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 2_147_483_647) {
		throw new RangeError('Delay must be between 0 and 2147483647 milliseconds.');
	}
}

/** Preserve the signal's exact rejection reason, including an explicit null. @internal */
function abortReason(signal: AbortSignal): unknown {
	return signal.reason;
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

/** Check inert transport fields before restoring a local lifetime. Date syntax is checked by restore(). */
export function isSnapshot(value: unknown): value is Snapshot {
	return record.is(value) && typeof value.id === 'string' && typeof value.startedAt === 'string' &&
		(value.traceId === undefined || typeof value.traceId === 'string') &&
		(value.deploymentId === undefined || typeof value.deploymentId === 'string') &&
		(value.idempotencyKey === undefined || typeof value.idempotencyKey === 'string') &&
		(value.deadline === undefined || typeof value.deadline === 'string');
}

/**
 * Observe a promise until cancellation. Reject with the exact signal reason.
 * This removes only our listener. It does not cancel or join the underlying work.
 * A later rejection remains consumed even when cancellation won the race.
 */
export function observe<Value>(signal: AbortSignal, value: Promise<Value>): Promise<Value> {
	return new Promise<Value>((resolve, reject) => {
		const finish = (action: () => void) => {
			signal.removeEventListener('abort', abort);
			action();
		};
		const abort = () => finish(() => reject(signal.reason));
		signal.addEventListener('abort', abort, { once: true });
		value.then((result) => finish(() => resolve(result)), (error) => finish(() => reject(error)));
		if (signal.aborted) abort();
	});
}

/** Restore a snapshot into a new local context and cancellation controller. */
export function restore(value: Snapshot, options: RestoreOptions = {}): Owned {
	return create({
		id: value.id,
		...(value.traceId !== undefined ? { traceId: value.traceId } : {}),
		...(value.deploymentId !== undefined ? { deploymentId: value.deploymentId } : {}),
		...(value.idempotencyKey !== undefined ? { idempotencyKey: value.idempotencyKey } : {}),
		startedAt: temporal.Instant.from(value.startedAt),
		...(value.deadline !== undefined ? { deadline: temporal.Instant.from(value.deadline) } : {}),
		...(options.signal !== undefined ? { signal: options.signal } : {}),
		...(options.clock !== undefined ? { clock: options.clock } : {}),
		...(options.instrument !== undefined ? { instrument: options.instrument } : {}),
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
	// Structural hosts can attach a listener and then throw. Register its removal
	// first so construction failure releases that partial acquisition, preserving
	// both setup and cleanup failures through the standard disposal protocol.
	using registration = new DisposableStack();
	registration.defer(() => parent.removeEventListener('abort', abort));
	parent.addEventListener('abort', abort, { once: true });
	if (parent.aborted) abort();
	const linked = registration.move();
	return () => linked.dispose();
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
	return temporal.Instant.compare(right, left) < 0 ? right : left;
}

/** Add fixed elapsed units exactly; calendar units cannot choose their own anchor or time zone. @internal */
function elapsedTarget(
	instant: Temporal.Instant,
	duration: Temporal.Duration | Temporal.DurationLike | string,
): Temporal.Instant {
	return new temporal.Instant(instant.epochNanoseconds + durationCore.elapsedNanoseconds(duration));
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
 * Accept either an existing instant or ISO instant text for a deterministic clock.
 *
 * @internal
 */
function toInstant(value: Temporal.Instant | string): Temporal.Instant {
	return typeof value === 'string' ? temporal.Instant.from(value) : value;
}

/**
 * Keep operation identities non-empty and bounded before storing them in local or transport context data.
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

export * as state from './state.ts';
export * as events from './events.ts';
export { create as createState } from './state.ts';
export { from as fromEvents } from './events.ts';
