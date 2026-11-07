/** Observe accepted effects without transferring work ownership to subscribers. @module */
import { dispose } from '@okikio/dispose';
import { EventBus } from '@okikio/observables/events';
import type { Observable } from '@okikio/observables/observable';
import { observe as observation } from '@okikio/telemetry/observe';
import type { ObserveOptions as ObservationOptions } from '@okikio/telemetry/observe';
import type { Context } from '@okikio/context';
import type { EffectDefinition, EffectEmitter, EffectOccurrence } from './types.ts';

/** Borrow an optional recipient. Subscriber errors go to onError, never to the emitter. */
export interface ObserveOptions extends ObservationOptions {
	/** Recipient whose acceptance precedes publication. The observer never closes it. */
	readonly emitter?: EffectEmitter;
}
/** An effect recipient with a read-only stream of accepted occurrences. Closing it never closes the borrowed recipient. */
export interface EffectObserver<Effect extends EffectDefinition = EffectDefinition>
	extends EffectEmitter<Effect>, Disposable {
	/** Asynchronous notifications may skip intermediate accepted occurrences. */
	readonly events: Observable<EffectOccurrence<Effect>>;
	/** Most recently started occurrence to be accepted, or undefined before the first acceptance. */
	readonly latest: EffectOccurrence<Effect> | undefined;
	/** Reject new emits and complete subscribers after any queued notification. */
	close(): void;
}
/**
 * Publish only after the recipient accepts an occurrence. Keep one latest value,
 * not an unbounded history. Delivery is asynchronous and coalesces pending updates.
 * Use an outbox when every occurrence must reach a consumer. Unsubscribe to stop
 * observing; closing the observer stops new acceptance and completes subscribers.
 */
export function observe<Effect extends EffectDefinition = EffectDefinition>(
	options: ObserveOptions = {},
): EffectObserver<Effect> {
	const bus = new EventBus<EffectOccurrence<Effect>>();
	const events = observation(bus, options);
	let latest: EffectOccurrence<Effect> | undefined;
	let closed = false;
	let pending = false;
	let version = 0;
	let accepted = 0;
	// One microtask publishes the newest accepted occurrence. Concurrent emits
	// may coalesce; this observation cannot substitute for an authoritative ledger.
	const publish = () => {
		if (pending) return;
		pending = true;
		queueMicrotask(() => {
			pending = false;
			if (latest !== undefined) bus.emit(latest);
			if (closed) bus.close();
		});
	};
	return Object.freeze({
		events,
		get latest() {
			return latest;
		},
		async emit(ctx: Context, occurrence: EffectOccurrence<Effect>) {
			if (closed) throw new Error('Effect observer is closed.');
			const order = ++version;
			await options.emitter?.emit(ctx, occurrence);
			// A slower earlier acceptance must not overwrite a newer accepted value.
			if (closed || order < accepted) return;
			accepted = order;
			latest = occurrence;
			publish();
		},
		close() {
			if (closed) return;
			closed = true;
			if (pending) return;
			bus.close();
		},
		[dispose]() {
			this.close();
		},
	});
}
