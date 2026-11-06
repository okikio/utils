/**
 * Synchronous typed state for local progress displays and coordination.
 *
 * A cell owns updates and subscriptions. Its reader exposes only reading and
 * observation, so attaching the reader to a Context does not grant mutation or
 * disposal authority. Values are borrowed; publish immutable values or replace
 * them with update(). This module does not recursively proxy or freeze payloads.
 * @module
 */
import { DisposableStack, dispose } from '@okikio/dispose';
import { EventBus } from '@okikio/observables/events';
import { Observable } from '@okikio/observables/observable';

/** One committed state transition; revisions increase even inside a notification batch. */
export interface Change<Value> {
	/** Value before the first update represented by this notification. */
	readonly previous: Value;
	/** Latest committed value represented by this notification. */
	readonly value: Value;
	/** Monotonic revision of the latest committed value. */
	readonly revision: number;
}

/** Disposable observation with no state-update or cell-disposal authority. */
export interface Subscription extends Disposable {
	/** True after explicit disposal, cancellation or cell closure. */
	readonly closed: boolean;
	/** Remove this subscriber exactly once, attempting every release even when signal unlinking throws. */
	unsubscribe(): void;
}

/** Optional ownership and initial-notification policy for one subscriber. */
export interface SubscribeOptions {
	/** Aborting this signal removes only this subscriber. */
	readonly signal?: AbortSignal;
	/** Deliver the current value immediately; defaults to false. */
	readonly immediate?: boolean;
}

/** Read capability that can be safely borrowed by a Context or a UI component. */
export interface Reader<Value> {
	/** Latest revision, beginning at zero. */
	readonly revision: number;
	/** Return the current value without copying or acquiring ownership. */
	get(): Value;
	/** Future changes as an owned-library Observable; completes when the cell closes and never exposes emission authority. */
	readonly changes: Observable<Change<Value>>;
	/** Observe future committed changes; callback errors are isolated from updates. */
	subscribe(observer: (change: Change<Value>) => void, options?: SubscribeOptions): Subscription;
}

/** State owner; keep this capability with the code responsible for mutations. */
export interface Cell<Value> extends Disposable {
	/** Separate runtime facade containing only read and subscribe operations. */
	readonly reader: Reader<Value>;
	/** Whether this cell has closed and stopped accepting updates. */
	readonly closed: boolean;
	/** Most recent observer/reporting error, retained without an unbounded error log. */
	readonly observerError: unknown;
	/** Replace the current value; equal values do not advance the revision. */
	set(value: Value): void;
	/** Derive a replacement from the current value. */
	update(change: (value: Value) => Value): void;
	/** Coalesce synchronous nested updates into one notification; this is not rollback. */
	batch<Return>(action: () => Return): Return;
}

/** Equality, notification bounds and diagnostics chosen by the state owner. */
export interface Options<Value> {
	/** Equality used to skip unchanged values; defaults to Object.is. */
	readonly equal?: (left: Value, right: Value) => boolean;
	/** Maximum synchronous feedback passes per update; defaults to 32. */
	readonly notificationLimit?: number;
	/** Optional isolated report. Returned Promise rejections are retained without calling this handler again. */
	readonly onError?: (error: unknown) => void | PromiseLike<void>;
}

/**
 * Create one state cell without installing listeners or timers elsewhere.
 *
 * During batching and reentrant notifications, only one pending change is
 * retained. Nested updates preserve the first previous value and latest value.
 * A feedback loop is stopped after notificationLimit passes; the latest state
 * remains readable and observerError records the problem. Observers do not
 * decide whether the state update succeeded.
 *
 * Disposal stops admission first, then attempts every subscription release and
 * Observable completion. Borrowed-signal cleanup failures are thrown after the
 * other releases have been attempted. Failed subscription acquisition rolls
 * back any listener already retained by the supplied signal.
 *
 * @example
 * ```ts
 * import * as state from '@okikio/context/state';
 * using progress = state.create({ completed: 0, total: 10 });
 * using subscription = progress.reader.subscribe(({ value }) => console.log(value.completed));
 * progress.update((value) => ({ ...value, completed: value.completed + 1 }));
 * ```
 */
export function create<Value>(initial: Value, options: Options<Value> = {}): Cell<Value> {
	const limit = options.notificationLimit ?? 32;
	if (!Number.isSafeInteger(limit) || limit < 1) {
		throw new RangeError('State notification limit must be a positive integer.');
	}
	const equal = options.equal ?? Object.is;
	const bus = new EventBus<Change<Value>>();
	const subscriptions = new Set<Subscription>();
	let current = initial;
	let revision = 0;
	let closed = false;
	let depth = 0;
	let notifying = false;
	let pending: Change<Value> | undefined;
	let observerError: unknown;

	/** Keep reporting failure separate from committed state and other observers. */
	const report = (error: unknown): void => {
		observerError = error;
		try {
			void Promise.resolve(options.onError?.(error)).catch((reportError: unknown) => {
				observerError = reportError;
			});
		} catch (reportError) {
			observerError = reportError;
		}
	};

	/** Deliver bounded synchronous feedback with at most one pending aggregate. */
	const flush = (): void => {
		if (closed || notifying || depth > 0) return;
		notifying = true;
		let passes = 0;
		try {
			while (pending !== undefined && !closed) {
				if (passes++ >= limit) {
					pending = undefined;
					report(new RangeError('State observer feedback exceeded the notification limit.'));
					break;
				}
				const change = pending;
				pending = undefined;
				bus.emit(change);
			}
		} finally {
			notifying = false;
		}
	};

	/** Reject writes after disposal before evaluating caller-owned update functions. */
	const assertOpen = (): void => {
		if (closed) throw new ReferenceError('State cell is closed.');
	};

	/** Commit before announcing, so every observer can read the accepted latest value. */
	const set = (value: Value): void => {
		assertOpen();
		if (equal(current, value)) return;
		if (!Number.isSafeInteger(revision + 1)) throw new RangeError('State revision exceeded safe integer precision.');
		const previous = pending === undefined ? current : pending.previous;
		current = value;
		revision++;
		pending = Object.freeze({ previous, value, revision });
		flush();
	};

	/**
	 * Keep the actual EventBus private: its events getter returns the bus itself.
	 * A separate Observable permits pipelines and completion without exposing emit
	 * or close. A subscriber joining during emission observes only later revisions,
	 * so the bus's live Set iteration cannot replay the in-flight change to it.
	 */
	const changes = new Observable<Change<Value>>((observer) => {
		const subscribedAfter = revision;
		return bus.subscribe({
			next(change) {
				if (change.revision > subscribedAfter) observer.next(change);
			},
			complete: () => observer.complete(),
			error: (error) => observer.error(error),
		});
	});

	const reader: Reader<Value> = Object.freeze({
		get revision() {
			return revision;
		},
		get: () => current,
		changes,
		/** Link one observer to future revisions without granting writes or disposal of the source cell. */
		subscribe(observer: (change: Change<Value>) => void, subscribeOptions: SubscribeOptions = {}): Subscription {
			const { signal, immediate = false } = subscribeOptions;
			let stopped = closed || signal?.aborted === true;
			// A subscription created during notification must not receive the update
			// already in flight. immediate below is the separate current-value choice.
			const subscribedAfter = revision;
			// Each subscription owns its bus registration and borrowed-signal link.
			// Closing either must still release the other if one host method throws.
			const resources = new DisposableStack();
			/** Subscriber callbacks cannot veto a committed value or skip later observers. */
			const notify = (change: Change<Value>): void => {
				if (stopped) return;
				try {
					const result: unknown = observer(change);
					// JavaScript callers can return a Promise despite the synchronous observer type.
					// Observe its rejection without claiming to await or cancel caller-owned work.
					if (result !== null && typeof result === 'object' && 'then' in result) {
						void Promise.resolve(result).catch(report);
					}
				} catch (error) {
					report(error);
				}
			};
			/** Stop delivery before releasing registrations, since their cleanup may call back into the cell. */
			const unsubscribe = (): void => {
				if (stopped) return;
				stopped = true;
				resources.dispose();
			};
			const subscription: Subscription = Object.freeze({
				get closed() {
					return stopped;
				},
				unsubscribe,
				[dispose]: unsubscribe,
			});
			if (stopped) return subscription;
			// A structural signal can retain a listener and then throw from add.
			// The acquisition guard rolls back all local registrations and language
			// disposal preserves both that failure and a possible cleanup failure.
			using acquisition = new DisposableStack();
			let handedOff = false;
			acquisition.defer(() => {
				if (!handedOff) unsubscribe();
			});
			const source = bus.subscribe((change) => {
				if (change.revision > subscribedAfter) notify(change);
			});
			resources.defer(() => subscriptions.delete(subscription));
			resources.defer(() => source.unsubscribe());
			subscriptions.add(subscription);
			if (signal !== undefined) {
				// Registration can reenter closure before the host retains its listener.
				// Delay an early removal until add unwinds; language disposal also keeps
				// both failures if registration and that late removal throw.
				let attaching = true;
				let removalPending = false;
				resources.defer(() => {
					if (attaching) removalPending = true;
					else signal.removeEventListener('abort', unsubscribe);
				});
				using registration = new DisposableStack();
				registration.defer(() => {
					attaching = false;
					if (removalPending) signal.removeEventListener('abort', unsubscribe);
				});
				signal.addEventListener('abort', unsubscribe, { once: true });
			}
			if (signal?.aborted) unsubscribe();
			else if (immediate) notify(Object.freeze({ previous: current, value: current, revision }));
			handedOff = true;
			return subscription;
		},
	});
	return Object.freeze({
		reader,
		get closed() {
			return closed;
		},
		get observerError() {
			return observerError;
		},
		set,
		update(change: (value: Value) => Value): void {
			assertOpen();
			set(change(current));
		},
		/** Flush on unwind even when action throws; already committed updates are not rolled back. */
		batch<Return>(action: () => Return): Return {
			assertOpen();
			depth++;
			try {
				return action();
			} finally {
				depth--;
				flush();
			}
		},
		[dispose](): void {
			if (closed) return;
			closed = true;
			pending = undefined;
			// Snapshot ownership into a disposal stack before release mutates the
			// subscription set. Every observer and the raw Observable completion are
			// attempted even when one borrowed signal fails to unlink.
			using cleanup = new DisposableStack();
			cleanup.defer(() => bus.close());
			for (const subscription of subscriptions) cleanup.use(subscription);
		},
	});
}
