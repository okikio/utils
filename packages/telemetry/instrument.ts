/** Explicit, portable execution observations. Importing this module installs no backend. @module */
import * as schema from '@okikio/schema';
import * as record from '@okikio/collection/record';
import { create as scope } from './mod.ts';
import type { Reporter, ScopeOptions, Value } from './types.ts';

/** Versioned W3C trace identity saved with work. Arbitrary baggage is never copied. */
export const TraceSchema: schema.Reader<{ version: 1; traceparent: string }, unknown> = schema.define((input) => {
	if (!record.is(input)) schema.reject('Expected saved trace context.');
	if (
		input.version !== 1 || typeof input.traceparent !== 'string' ||
		!/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(input.traceparent)
	) schema.reject('Expected version one W3C trace context.');
	const parts = input.traceparent.split('-');
	if (/^0+$/.test(parts[1]!) || /^0+$/.test(parts[2]!)) schema.reject('Trace identifiers must be nonzero.');
	return { version: 1 as const, traceparent: input.traceparent };
});

/** Diagnostic trace context never changes command identity or write permission. */
export type TraceType = schema.Output<typeof TraceSchema>;
/** Portable fields allow optional values; undefined entries are omitted before reporting. */
export type Attributes = Readonly<Record<string, Value | undefined>>;

/** Per-operation observation. A handled failure can be recorded without throwing again. */
export interface Observation {
	/** Mark this operation as failed. Arbitrary exception messages and payloads are not exported. */
	fail(reason: unknown): void;
}

/** Borrowed instrumentation supplied by an application to an execution context or host. */
export interface Instrument {
	/** Observe one operation and preserve its exact result, thrown value, and single invocation. */
	span<Result>(
		name: string,
		fields: Attributes,
		callback: (observation: Observation) => Promise<Result>,
		parent?: TraceType,
	): Promise<Result>;
	/** Record one fact after a state change. An observation cannot authorize or settle work. */
	notice(name: string, fields?: Attributes, level?: 'debug' | 'info' | 'warning'): void;
	/** Capture adapter-owned active trace identity, when implicit trace propagation is available. */
	capture(): TraceType | undefined;
	/** Join admitted observations and flush the borrowed reporter. The application owns its deadline. */
	flush(): Promise<void>;
}

/** Portable instrumentation policy. Slow delivery has a finite budget and never delays application work. */
export interface Options extends ScopeOptions {
	/** Explicit reporter. Omitting it produces observations without an external destination. */
	readonly reporter?: Reporter;
	/** Maximum concurrently pending reports, including synchronous deliveries awaiting settlement. @default 1024 */
	readonly maximumPending?: number;
	/** Monotonic milliseconds used only to measure duration. @default performance.now */
	readonly monotonic?: () => number;
}

/** Portable instrumentation exposes the number of observations dropped by its admission budget. */
export interface PortableInstrument extends Instrument {
	/** Reports skipped while the delivery budget was full. This is not a count of failed operations. */
	readonly dropped: number;
}

const ignored: Observation = Object.freeze({ fail() {} });

/** No-op implementation used when an application has not supplied instrumentation. */
export const noop: Instrument = Object.freeze({
	async span<Result>(
		_name: string,
		_fields: Attributes,
		callback: (observation: Observation) => Promise<Result>,
	): Promise<Result> {
		return await callback(ignored);
	},
	notice() {},
	capture() {
		return undefined;
	},
	async flush() {},
});

/** Select the explicitly borrowed instrument; there is no process-wide implicit fallback. */
export function get(owner?: { readonly instrument?: Instrument }): Instrument {
	return owner?.instrument ?? noop;
}

/** Copy valid trace identity. Invalid diagnostic metadata never rejects business work. */
export function saved(input: unknown): TraceType | undefined {
	try {
		return TraceSchema.parse(input);
	} catch {
		return undefined;
	}
}

/** Create a Reporter-backed instrument that works without async-local or runtime-specific APIs. */
export function create(options: Options = {}): PortableInstrument {
	const maximum = options.maximumPending ?? 1024;
	if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 65_536) {
		throw new RangeError('Instrumentation maximumPending must be an integer from 1 to 65536.');
	}
	const now = options.monotonic ?? (() => performance.now());
	if (typeof now !== 'function') throw new TypeError('Instrumentation monotonic must be a function.');
	const target = scope(options.reporter, options);
	const pending = new Set<Promise<unknown>>();
	let dropped = 0;

	/** Acquire a reporting slot before calling the reporter, including synchronous reentrant reporters. */
	function notice(name: string, fields: Attributes = {}, level: 'debug' | 'info' | 'warning' = 'info'): void {
		if (pending.size >= maximum) {
			dropped++;
			return;
		}
		let release!: () => void;
		const reserved = new Promise<void>((resolve) => {
			release = resolve;
		});
		pending.add(reserved);
		try {
			const clean: Record<string, Value> = {};
			for (const [key, value] of Object.entries(fields)) {
				if (value !== undefined) Object.defineProperty(clean, key, { value, enumerable: true });
			}
			void target.report({ name, level, fields: clean }).catch(() => {}).finally(() => {
				pending.delete(reserved);
				release();
			});
		} catch {
			pending.delete(reserved);
			release();
		}
	}

	return Object.freeze({
		get dropped() {
			return dropped;
		},
		notice,
		capture() {
			return undefined;
		},
		async flush() {
			await Promise.all([...pending]);
			await target.flush();
		},
		/**
		 * Observe one callback without taking ownership of its result. The callback
		 * still runs if timing or reporting fails, and its original rejection stays
		 * visible after the final diagnostic record is attempted.
		 */
		async span<Result>(
			name: string,
			fields: Attributes,
			callback: (observation: Observation) => Promise<Result>,
			_parent?: TraceType,
		): Promise<Result> {
			let failed = false;
			let started: number | undefined;
			try {
				started = now();
			} catch { /* A clock is observational. */ }
			const observation: Observation = {
				fail(reason) {
					failed = true;
					try {
						notice('operation.failed', { ...fields, error_type: errorType(reason) }, 'warning');
					} catch { /* Diagnostic fields cannot change work completion. */ }
				},
			};
			notice(`${name}.started`, fields, 'debug');
			try {
				return await callback(observation);
			} catch (reason) {
				observation.fail(reason);
				throw reason;
			} finally {
				let elapsed: number | undefined;
				try {
					const duration = started === undefined ? undefined : now() - started;
					if (duration !== undefined && Number.isFinite(duration) && duration >= 0) elapsed = duration;
				} catch { /* A broken timer cannot replace the work result. */ }
				try {
					notice(
						`${name}.finished`,
						{ ...fields, outcome: failed ? 'error' : 'success', duration_ms: elapsed },
						'debug',
					);
				} catch { /* Diagnostic fields cannot replace the callback result. */ }
			}
		},
	});
}

/** Bounded exception kind without serializing customer data or invoking arbitrary coercion hooks. */
export function errorType(reason: unknown): string {
	try {
		return reason instanceof Error && typeof reason.name === 'string' ? reason.name.slice(0, 128) : typeof reason;
	} catch {
		return 'unknown';
	}
}
