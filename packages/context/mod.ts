/**
 * Local operation identity, cancellation, deadlines, tracing, time, and owned cleanup.
 *
 * A context does not schedule work or resolve declared capability resources.
 * An owned context does provide the standard explicit-resource-management
 * operations needed by code that creates live values during its lifetime.
 *
 * @module
 */
import '@okikio/dispose/polyfill';
import { delay as standardDelay } from '@std/async/delay';
import type { ChildOptions, Clock, Context, CreateOptions, Owned, RestoreOptions, Snapshot } from './types.ts';

const owners = new WeakMap<Owned, Readonly<{ controller: AbortController; dispose: () => Promise<void> }>>();
const views = new WeakMap<object, Context>();

/** Error raised when a context has been cancelled. */
export class ContextCancelledError extends Error {
	readonly reason: unknown;

	constructor(reason: unknown = undefined) {
		super('Context was cancelled.', reason === undefined ? undefined : { cause: reason });
		this.name = 'ContextCancelledError';
		this.reason = reason;
	}
}

/** Error raised when a context deadline has elapsed. */
export class ContextDeadlineExceededError extends Error {
	readonly deadline: Temporal.Instant;
	readonly observedAt: Temporal.Instant;

	constructor(deadline: Temporal.Instant, observedAt: Temporal.Instant) {
		super(`Context deadline ${deadline.toString()} was exceeded at ${observedAt.toString()}.`);
		this.name = 'ContextDeadlineExceededError';
		this.deadline = deadline;
		this.observedAt = observedAt;
	}
}

/** Clock backed by the runtime's native Temporal implementation. */
export const SystemClock: Clock = Object.freeze({ now: () => Temporal.Now.instant() });

/** Mutable deterministic clock intended for tests and simulations. */
export class TestClock implements Clock {
	#instant: Temporal.Instant;

	constructor(initial: Temporal.Instant | string = '2000-01-01T00:00:00Z') {
		this.#instant = toInstant(initial);
	}

	/**
	 * Reads the current instant from the context clock so tests and runtime code share the same time source.
	 *
	 * @internal
	 */
	now(): Temporal.Instant {
		return this.#instant;
	}

	/**
	 * Sets state on the internal builder or record used by the operation context.
	 *
	 * @internal
	 */
	set(instant: Temporal.Instant | string): void {
		this.#instant = toInstant(instant);
	}

	/**
	 * Advances state by one controlled transition under the operation context.
	 *
	 * @internal
	 */
	advance(duration: Temporal.Duration | Temporal.DurationLike | string): Temporal.Instant {
		this.#instant = this.#instant.add(Temporal.Duration.from(duration));
		return this.#instant;
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
	let timer: ReturnType<typeof setTimeout> | undefined;
	let resolveClosed!: () => void;
	const closed = new Promise<void>((resolve) => resolveClosed = resolve);
	let disposal: Promise<void> | undefined;

	if (options.deadline !== undefined) {
		const delay = millisecondsUntil(options.deadline, clock.now());
		if (delay <= 0) controller.abort(new ContextDeadlineExceededError(options.deadline, clock.now()));
		else {
			timer = setTimeout(() => {
				controller.abort(new ContextDeadlineExceededError(options.deadline!, clock.now()));
			}, delay);
		}
	}

	const dispose = (): Promise<void> => {
		if (disposal !== undefined) return disposal;
		if (timer !== undefined) clearTimeout(timer);
		unlinkParent();
		if (!controller.signal.aborted) controller.abort(new ContextCancelledError('Context was disposed.'));
		disposal = resources.disposeAsync().finally(resolveClosed);
		return disposal;
	};

	const owned: Owned = Object.freeze({
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
	});
	owners.set(owned, Object.freeze({ controller, dispose }));
	return owned;
}

/** Derive a child context that inherits identity, cancellation, and the parent deadline. */
export function child(parent: Context, options: ChildOptions = {}): Owned {
	const resolvedDeadline = earlier(parent.deadline, options.deadline);
	return create({
		id: options.id ?? parent.id,
		...(options.traceId ?? parent.traceId ? { traceId: options.traceId ?? parent.traceId } : {}),
		...(options.deploymentId ?? parent.deploymentId ? { deploymentId: options.deploymentId ?? parent.deploymentId } : {}),
		...(options.idempotencyKey ?? parent.idempotencyKey ? { idempotencyKey: options.idempotencyKey ?? parent.idempotencyKey } : {}),
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

/** Derive a child with a relative timeout that cannot exceed its parent's deadline. */
export function timeout(parent: Context, duration: Temporal.DurationLike | string): Owned {
	const value = parent.clock.now().add(Temporal.Duration.from(duration));
	return deadline(parent, value);
}

/**
 * Create a typed view that adds runtime-local fields without creating a new lifetime.
 *
 * The view retains the source context's cancellation and ownership identity. It is
 * useful when a focused utility adds one execution concern, such as permissions
 * or required effects, while another utility adds a different concern to the
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
		await delay(milliseconds, ctx.signal);
	} catch (error) {
		check(ctx);
		throw error;
	}
	check(ctx);
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
	if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 2_147_483_647) {
		throw new RangeError('Delay must be between 0 and 2147483647 milliseconds.');
	}
	const signal = cancellation instanceof AbortController ? cancellation.signal : cancellation;
	return signal === undefined ? standardDelay(milliseconds) : standardDelay(milliseconds, { signal });
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
 * Links signal idempotently for the operation context.
 *
 * Context internals own cancellation links, deadlines, timers, and clock behavior for one finite operation.
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
function earlier(left: Temporal.Instant | undefined, right: Temporal.Instant | undefined): Temporal.Instant | undefined {
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
	const milliseconds = duration.total({ unit: 'millisecond', relativeTo: Temporal.PlainDate.from('2000-01-01') });
	if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 2_147_483_647) {
		throw new RangeError('Context wait duration must be between 0 and 2147483647 milliseconds.');
	}
	return milliseconds;
}

function millisecondsUntil(deadline: Temporal.Instant, now: Temporal.Instant): number {
	const difference = deadline.epochMilliseconds - now.epochMilliseconds;
	return Number.isFinite(difference) ? Math.max(0, Math.min(difference, 2_147_483_647)) : 0;
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

export type { Clock, Snapshot, Context, Resources, Owned, CreateOptions, ChildOptions, RestoreOptions } from './types.ts';
