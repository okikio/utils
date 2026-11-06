/** A bounded, process-local inbox. PostgreSQL owns delivery that must survive a restart. @module */

import * as codec from '@okikio/schema/codec';
import { SystemClock } from '@okikio/context';
import { createEventDispatcher, waitForEvent } from '@okikio/observables/events';
import type { Clock } from '@okikio/context';
import { decode, encode, ExecutionError, fingerprint } from './execution.ts';
import type { EventResult, WorkflowContext, WorkflowEventCommand, WorkflowSignal } from './types.ts';

/** Caller-owned event inbox used by a local scheduler. Closing it releases all waiting work. */
export interface EventInbox extends Disposable {
	send<Value>(
		run: string,
		event: WorkflowSignal<Value>,
		value: Value,
		options: { readonly key: string },
	): Promise<void>;
	wait(ctx: WorkflowContext, command: WorkflowEventCommand, path: string): Promise<EventResult<unknown>>;
	close(): void;
}
/** One slot per run, event name, and key. Retain terminal slots to preserve deduplication until close. */
interface Slot {
	readonly id: string;
	hash?: string;
	value?: unknown;
	received?: number;
	path?: string;
	until?: string;
	outcome?: EventResult<unknown>;
}
/**
 * Create an inbox without starting a worker. Early events remain available.
 * Capacity counts all retained keys, including delivered and timed-out keys.
 * Supply the scheduler's clock when using a test clock. This inbox is not durable.
 */
export function events(options: { readonly capacity?: number; readonly clock?: Clock } = {}): EventInbox {
	const capacity = options.capacity ?? 1024;
	if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('Event capacity must be positive.');
	const clock = options.clock ?? SystemClock;
	const slots = new Map<string, Slot>();
	const changes = createEventDispatcher<Record<string, void>>();
	let closed = false;
	const slot = (run: string, event: string, key: string): Slot => {
		if (closed) throw new ExecutionError('events_closed');
		if (!run.trim() || !event.trim() || event.length > 256 || !key.trim() || key.length > 512) {
			throw new ExecutionError('event_key');
		}
		const id = JSON.stringify([run, event, key]);
		let value = slots.get(id);
		if (value === undefined) {
			if (slots.size >= capacity) throw new ExecutionError('event_capacity');
			value = { id };
			slots.set(id, value);
		}
		return value;
	};
	return Object.freeze({
		/**
		 * Retain one bounded checked value at the run/event/key address. An identical repeat is accepted;
		 * changed data under that address rejects.
		 */
		async send<Value>(run: string, event: WorkflowSignal<Value>, value: Value, input: { readonly key: string }) {
			const saved = encode(await codec.write(event.value, value), 65_536);
			const hash = await fingerprint(saved);
			const entry = slot(run, event.id, input.key);
			if (entry.hash !== undefined) {
				if (entry.hash !== hash) throw new ExecutionError('event_conflict');
				return;
			}
			if (
				entry.outcome ||
				entry.until !== undefined &&
					clock.now().epochMilliseconds >= Temporal.Instant.from(entry.until).epochMilliseconds
			) throw new ExecutionError('event_closed');
			entry.hash = hash;
			entry.value = decode(saved);
			entry.received = clock.now().epochMilliseconds;
			changes.emit(entry.id, undefined);
		},
		/**
		 * Wait for this exact addressed event or its deadline. Read retained early delivery before
		 * subscribing for new changes.
		 */
		async wait(ctx: WorkflowContext, command: WorkflowEventCommand, path: string) {
			const entry = slot(ctx.runId, command.event.id, command.eventKey);
			if (entry.path !== undefined && (entry.path !== path || entry.until !== command.until)) {
				throw new ExecutionError('event_wait_conflict');
			}
			entry.path = path;
			entry.until = command.until;
			for (;;) {
				ctx.signal.throwIfAborted();
				if (closed) throw new ExecutionError('events_closed');
				if (entry.outcome) return entry.outcome;
				const due = command.until === undefined ? Infinity : Temporal.Instant.from(command.until).epochMilliseconds;
				if (entry.hash !== undefined && entry.received! <= due) {
					entry.outcome = { type: 'received', value: await codec.read(command.event.value, entry.value) };
					return entry.outcome;
				}
				const delay = due - clock.now().epochMilliseconds;
				if (delay <= 0) return entry.outcome = { type: 'timeout' };
				// Subscribe before yielding so delivery cannot fall between the state check and the wait.
				// Observables owns subscription cleanup. Aborting the losing branch also releases its timer.
				const stop = new AbortController();
				const signal = AbortSignal.any([ctx.signal, stop.signal]);
				try {
					const changed = waitForEvent<Record<string, void>, string>(changes, entry.id, { signal });
					if (delay === Infinity) await changed;
					else await Promise.race([changed, clock.sleep(Math.min(delay, 2_147_483_647), signal)]);
				} finally {
					stop.abort();
				}
			}
		},
		close() {
			if (closed) return;
			closed = true;
			changes.close();
			slots.clear();
		},
		[Symbol.dispose]() {
			this.close();
		},
	});
}
