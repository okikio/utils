/** Bounded JSON Lines reporting through a caller-owned destination. @module */
import * as fault from '@okikio/result/fault';
import type { Event, Reporter, Value } from './types.ts';

/** Explicit output and application redaction policy. No logging runtime is configured. */
export interface Options {
	/** Write one complete LF-terminated line. Concurrent calls require a concurrency-safe destination. */
	readonly write: (line: string) => void | Promise<void>;
	/** Redact application secrets in text, including messages, URLs and fault strings. Defaults to identity. */
	readonly redact?: (text: string) => string;
	/** Maximum encoded bytes per line, including LF. Oversized events fail before writing. Defaults to 65536. */
	readonly maximumBytes?: number;
}

/**
 * Report JSON Lines with bounded structural projection and common secret fields removed.
 * Raw Error objects are never included. Key filtering covers credentials such as
 * authorization, cookie, password, secret, token and API keys; it cannot recognize
 * secrets embedded in arbitrary text. Supply redact for the application's text policy.
 * The caller owns ordering, backpressure, destination flush and close. Reporter
 * rejection follows the surrounding telemetry scope's observation-failure policy.
 */
export function reporter(options: Options): Reporter {
	const { write, redact = (text: string) => text, maximumBytes = 65536 } = options;
	if (typeof write !== 'function' || typeof redact !== 'function') {
		throw new TypeError('JSON reporter requires functions.');
	}
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
		throw new RangeError('JSON event limit must be positive.');
	}
	return Object.freeze({
		async report(event: Event): Promise<void> {
			const line = project(event, redact, maximumBytes);
			await write(line);
		},
	});
}

/** Walk only the bounded, getter-free projection; never inspect the live error. */
function filter(value: Value, redact: (text: string) => string): Value {
	if (typeof value === 'string') return redact(value);
	if (value === null || typeof value !== 'object') return value;
	if (Array.isArray(value)) return value.map((entry) => filter(entry, redact));
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [
			key,
			/(?:authorization|cookie|password|passwd|secret|token|api[-_]?key)/iu.test(key)
				? '[redacted]'
				: filter(entry, redact),
		]),
	);
}

/** Produce a bounded complete line before admission; the queue counts its exact UTF-8 bytes. */
function project(event: Event, redact: (text: string) => string, maximumBytes: number): string {
	const projected = fault.encode({
		name: event.name,
		level: event.level,
		message: event.message,
		at: event.at,
		fields: event.fields,
		...(event.fault === undefined ? {} : { fault: event.fault }),
	}, { maximumDepth: 8, maximumEntries: 64, maximumStringLength: 4096, includeStack: false });
	const line = JSON.stringify(filter(projected, redact)) + '\n';
	if (new TextEncoder().encode(line).byteLength > maximumBytes) {
		throw new RangeError('JSON event exceeds its byte limit.');
	}
	return line;
}

/** JSON delivery limits include the active write plus every waiting line. */
export interface QueueOptions extends Options {
	/** Maximum active and waiting lines. Zero disables admission. */
	readonly maximumRecords: number;
	/** Exact UTF-8 bytes of active and waiting lines, including their terminating LF. */
	readonly maximumQueuedBytes: number;
	/** Only waiting lines can be evicted. If the active line prevents admission, drop-oldest drops the new line. */
	readonly overflow: 'drop-oldest' | 'drop-newest' | 'reject';
	/** Flush the borrowed destination after earlier writes settle. No close authority is acquired. */
	readonly flush?: () => void | Promise<void>;
}

/** Bounded owned queue around a borrowed writer. The application owns the destination's lifetime. */
export interface QueuedReporter extends Reporter, AsyncDisposable {
	/** Drain earlier writes and flush the destination. Concurrent callers share one flush. */
	flush(): Promise<void>;
	/** Seal admission, join every admitted write and flush. Repeated close retains the same outcome. */
	close(): Promise<void>;
	/** Exact retained encoded bytes exclude caller Events, projection temporaries, JS string overhead and sink-owned buffers. */
	stats(): Readonly<
		{ records: number; bytes: number; dropped: number; errors: number; state: 'open' | 'closing' | 'closed' }
	>;
}

/**
 * Queue JSON lines with explicit loss policy and exact encoded-byte admission.
 * report returns after admission, not delivery. Sink failures are retained as one first error and a
 * count; flush/close reject with that first value after attempting remaining writes and destination
 * flush. Admission rejection and projection errors still throw from report. Use ordinary reporter()
 * and await report for direct caller backpressure. This queue never retains blocked producers.
 *
 * An active write cannot be evicted or forcibly cancelled. A stalled writer stalls flush/close;
 * close is a join, not a timeout or proof of remote receipt. Do not call flush/close from inside write or the destination flush callback.
 * No LogTape/OTel setup is performed and no optional exporter queue is wrapped automatically.
 */
export function queued(options: QueueOptions): QueuedReporter {
	const {
		write,
		redact = (text: string) => text,
		maximumBytes = 65536,
		maximumRecords,
		maximumQueuedBytes,
		overflow,
		flush,
	} = options;
	if (
		typeof write !== 'function' || typeof redact !== 'function' || (flush !== undefined && typeof flush !== 'function')
	) {
		throw new TypeError('JSON queue requires writer, redactor and optional flush functions.');
	}
	if (
		!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 ||
		!Number.isSafeInteger(maximumRecords) || maximumRecords < 0 ||
		!Number.isSafeInteger(maximumQueuedBytes) || maximumQueuedBytes < 0 ||
		!['drop-oldest', 'drop-newest', 'reject'].includes(overflow)
	) throw new RangeError('Invalid JSON queue bounds or overflow policy.');
	/** Only encoded lines are retained; live Events and Errors never enter the delivery queue. */
	const waiting = new Set<{ readonly line: string; readonly bytes: number }>();
	let active: { readonly line: string; readonly bytes: number } | undefined;
	let bytes = 0;
	let dropped = 0;
	let errors = 0;
	let state: 'open' | 'closing' | 'closed' = 'open';
	/** Box preserves a sink rejection with undefined and bounds diagnostic retention to one value. */
	let failure: { readonly error: unknown } | undefined;
	let driving: Promise<void> | undefined;
	/** Set before calling the writer because a synchronous writer may reenter report. */
	let pumping = false;
	/** FIFO removal keeps admission/eviction constant-time even at a large configured bound. */
	const take = (): { readonly line: string; readonly bytes: number } => {
		const entry = waiting.values().next().value!;
		waiting.delete(entry);
		return entry;
	};
	let flushing = false;
	let flushPromise: Promise<void> | undefined;
	let closePromise: Promise<void> | undefined;
	/** Keep a count and one boxed reason, including undefined, rather than retaining every sink failure. */
	const remember = (error: unknown): void => {
		errors++;
		failure ??= { error };
	};
	/** The single writer owns the active line through settlement; its bytes remain charged during I/O. */
	const pump = (): void => {
		if (pumping || flushing || waiting.size === 0) return;
		pumping = true;
		driving = (async () => {
			while (waiting.size !== 0) {
				active = take();
				try {
					await write(active.line);
				} catch (error) {
					remember(error);
				} finally {
					bytes -= active.bytes;
					active = undefined;
				}
			}
		})().finally(() => {
			driving = undefined;
			pumping = false;
			pump();
		});
	};
	/** Share one drain and destination flush. Admission stays open until close seals it separately. */
	const drain = (): Promise<void> => {
		if (flushPromise !== undefined) return flushPromise;
		flushPromise = (async () => {
			while (driving !== undefined) await driving;
			// Pause delivery, not admission, around destination flush. New lines belong to a later flush.
			flushing = true;
			try {
				await flush?.();
			} catch (error) {
				remember(error);
			} finally {
				flushing = false;
				pump();
			}
			if (failure !== undefined) throw failure.error;
		})().finally(() => {
			flushPromise = undefined;
		});
		return flushPromise;
	};
	/** Seal admission before awaiting so no reentrant producer can extend this join indefinitely. */
	const close = (): Promise<void> => {
		if (closePromise !== undefined) return closePromise;
		state = 'closing';
		closePromise = (async () => {
			try {
				do {
					try {
						await drain();
					} catch { /* Retain the first error but still join lines admitted during an earlier flush. */ }
				} while (driving !== undefined || waiting.size !== 0);
				if (failure !== undefined) throw failure.error;
			} finally {
				state = 'closed';
			}
		})();
		return closePromise;
	};
	return Object.freeze({
		/**
		 * Admit one encoded record within both the record count and byte budgets.
		 * An active write keeps its budget until it settles. Drop-oldest can remove
		 * waiting records, but cannot retract bytes already passed to the writer.
		 */
		report(event: Event): void {
			if (state !== 'open') throw new ReferenceError('JSON queue is closed to admission.');
			const line = project(event, redact, maximumBytes);
			const size = new TextEncoder().encode(line).byteLength;
			const fits = (): boolean =>
				waiting.size + (active === undefined ? 0 : 1) < maximumRecords && size <= maximumQueuedBytes - bytes;
			if (overflow === 'drop-oldest' && size <= maximumQueuedBytes && maximumRecords > 0) {
				while (!fits() && waiting.size !== 0) {
					bytes -= take().bytes;
					dropped++;
				}
			}
			if (!fits()) {
				if (overflow === 'reject') throw new RangeError('JSON queue admission exceeds its record or byte limit.');
				dropped++;
				return;
			}
			waiting.add({ line, bytes: size });
			bytes += size;
			pump();
		},
		flush: drain,
		close,
		stats: () =>
			Object.freeze({ records: waiting.size + (active === undefined ? 0 : 1), bytes, dropped, errors, state }),
		[Symbol.asyncDispose]: close,
	});
}
