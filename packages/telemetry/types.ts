import type { FaultValue, Options as FaultOptions } from '@okikio/fault';

/** Severity shared by portable telemetry records and common logging backends. */
export type Level = 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal';

/** JSON-safe structured value accepted by telemetry fields. */
export type Value = FaultValue;

/** Immutable structured fields attached to a telemetry record or scope. */
export type Fields = Readonly<Record<string, Value>>;

/** Correlation fields extracted from a tracing implementation when one is active. */
export interface TraceFields {
	/** Optional OpenTelemetry trace correlation identifier. */
	readonly trace_id?: string;
	/** Optional OpenTelemetry span correlation identifier. */
	readonly span_id?: string;
	/** Optional trace flags carried for diagnostic correlation. */
	readonly trace_flags?: number;
	/** Optional vendor trace state carried for diagnostic correlation. */
	readonly trace_state?: string;
}

/** Portable structured diagnostic record emitted by one observed transition. */
export interface Event {
	/** Stable discriminant that selects the documented variant. */
	readonly kind: 'telemetry-event';
	/** Stable machine-readable event identity such as `queue.claim.expired`. */
	readonly name: string;
	/** Diagnostic severity used by the reporter. */
	readonly level: Level;
	/** Short human-readable description. Dashboards should group by `name`, not this text. */
	readonly message: string;
	/** ISO-8601 timestamp chosen by the scope clock. */
	readonly at: string;
	/** Bounded JSON-safe diagnostic fields. */
	readonly fields: Fields;
	/** Bounded projection of one associated unexpected runtime fault. */
	readonly fault?: FaultValue;
	/** Original local Error retained only for in-process adapters that can preserve it. */
	readonly error?: Error;
}

/** Input accepted when one telemetry record is created. */
export interface EventInput {
	/** Declared name used by the owning protocol. */
	readonly name: string;
	/** Diagnostic severity used by the reporter. */
	readonly level?: Level;
	/** Human-readable explanation; use the stable code or discriminant for program decisions. */
	readonly message?: string;
	/** Observation instant supplied by the owning clock. */
	readonly at?: string;
	/** Named fields that belong to this representation or observation. */
	readonly fields?: Fields;
	/** Unexpected error retained for diagnostic projection or the explicit failure branch. */
	readonly error?: unknown;
	/** Unexpected diagnostic data projected for this boundary. */
	readonly fault?: FaultValue;
	/** Explicit projection limits for unexpected diagnostic data. */
	readonly faultOptions?: FaultOptions;
}

/** Destination for structured telemetry records. */
export interface Reporter {
	/** Deliver one diagnostic event to the explicit reporter; observation does not settle authoritative work. */
	report(event: Event): void | Promise<void>;
	/** Flush buffered/exporter state when this reporter owns any. */
	flush?(): void | Promise<void>;
}

/** Callback used when observational delivery itself fails. */
export type ReporterErrorHandler = (error: unknown, event?: Event) => void | Promise<void>;

/** Options used to create one explicit telemetry scope. */
export interface ScopeOptions {
	/** Named fields that belong to this representation or observation. */
	readonly fields?: Fields;
	/** Runtime-neutral clock. Defaults to `new Date().toISOString()`. */
	readonly now?: () => string;
	/** Optional non-authoritative observer for reporter failures. */
	readonly onReporterError?: ReporterErrorHandler;
}

/** Explicit correlation scope that does not require async-local runtime support. */
export interface Scope {
	/** Named fields that belong to this representation or observation. */
	readonly fields: Fields;
	/** Emit one record with this scope's correlation fields. Reporter failures remain observational. */
	report(input: EventInput): Promise<Event>;
	/** Create a nested explicit scope whose fields override matching parent fields. */
	child(fields: Fields): Scope;
	/** Flush the underlying reporter when it exposes a flush operation. */
	flush(): Promise<void>;
}

/** Reporter that retains records in memory for tests and local diagnostics. */
export interface MemoryReporter extends Reporter {
	/** Retained observations available to the caller. */
	readonly records: readonly Event[];
	/** Remove retained diagnostic state from this owner. */
	clear(): void;
}

/** Options controlling bounded failure-history buffering. */
export interface BufferOptions {
	/** Maximum retained pre-trigger records per correlation key. @default 64 */
	readonly capacity?: number;
	/** Minimum severity that flushes retained history before the triggering event. @default error */
	readonly trigger?: Level;
	/** Derive the buffer key. Defaults to trace, request, operation, then a shared fallback key. */
	readonly key?: (event: Event) => string;
}

/** Reporter that holds low-severity history until a failure or explicit flush. */
export interface BufferedReporter extends Reporter {
	/** Deliver or release buffered diagnostic events under the reporter contract. */
	flush(key?: string): Promise<void>;
	/** Discard buffered diagnostic records without making them authoritative events. */
	discard(key?: string): void;
	/** Correlation keys with buffered history that has not been flushed or discarded. */
	readonly keys: readonly string[];
}

/** Minimal instant-like value required by portable execution-context projection. */
export interface InstantLike {
	/** Serialize the instant for diagnostic fields without importing or owning its runtime clock. */
	toString(): string;
}

/** Structural execution-context fields projected without importing or owning a runtime context. */
export interface ContextFieldsInput {
	/** Stable identity used to correlate this contract or occurrence. */
	readonly id: string;
	/** Optional trace correlation identity; it does not authorize the operation. */
	readonly traceId?: string;
	/** Optional host deployment identity carried with the operation. */
	readonly deploymentId?: string;
	/** Caller-owned identity for repeated work; a receiving provider must enforce its idempotency policy. */
	readonly idempotencyKey?: string;
	/** Start instant captured by the owning clock, or its serialized ISO timestamp. */
	readonly startedAt: InstantLike;
	/** Latest permitted completion instant; serialized contexts use ISO timestamp text. */
	readonly deadline?: InstantLike;
}
