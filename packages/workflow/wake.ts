/** Worker-local notification latch. Saved rows, rather than this latch, own the work. @module */

import { createEventDispatcher, waitForEvent } from '@okikio/observables/events';
import { pause } from './client.ts';

/** One worker's live notification state. A version change requests another database scan. */
interface Wake {
	readonly version: number;
	notify(): void;
	wait(previous: number, milliseconds: number, signal: AbortSignal): Promise<void>;
	close(): void;
}

/**
 * Remember notifications received during a scan. A notification between scanning
 * and subscribing must cause another scan instead of waiting for the idle timer.
 * Observables owns the live subscription. Each wait cancels its losing timer.
 */
export function wake(): Wake {
	const events = createEventDispatcher<{ change: void }>();
	let version = 0;
	return {
		get version() {
			return version;
		},
		notify() {
			version++;
			events.emit('change', undefined);
		},
		async wait(previous: number, milliseconds: number, signal: AbortSignal): Promise<void> {
			if (previous !== version || milliseconds <= 0 || signal.aborted) return;
			const stop = new AbortController();
			try {
				const combined = AbortSignal.any([signal, stop.signal]);
				const changed = waitForEvent(events, 'change', { signal: combined });
				await Promise.race([changed, pause(milliseconds, combined)]);
			} catch (error) {
				if (!signal.aborted) throw error;
			} finally {
				stop.abort();
			}
		},
		close() {
			events.close();
		},
	};
}
