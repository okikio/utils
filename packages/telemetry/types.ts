import type { FaultValue, Options as FaultOptions } from '@okikio/fault';

/** Severity shared by portable telemetry records and common logging backends. */
export type Level = 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal';

/** JSON-safe structured value accepted by telemetry fields. */
export type Value = FaultValue;

/** Immutable structured fields attached to a telemetry record or scope. */
export type Fields = Readonly<Record<string, Value>>;

/** Correlation fields extracted from a tracing implementation when one is active. */
export interface TraceFields {
	readonly trace_id?: string;
	readonly span_id?: string;
	readonly trace_flags?: number;
	readonly trace_state?: string;
}

/** Portable structured diagnostic record emitted by one observed transition. */
export interface Event {
	readonly kind: 'telemetry-event';
	/** Stable machine-readable event identity such as `queue.claim.expired`. */
	readonly name: string;
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
	readonly name: string;
	readonly level?: Level;
	readonly message?: string;
	readonly at?: string;
	readonly fields?: Fields;
	readonly error?: unknown;
	readonly fault?: FaultValue;
	readonly faultOptions?: FaultOptions;
}

/** Destination for structured telemetry records. */
export interface Reporter {
	report(event: Event): void | Promise<void>;
	/** Flush buffered/exporter state when this reporter owns any. */
	flush?(): void | Promise<void>;
}

/** Callback used when observational delivery itself fails. */
export type ReporterErrorHandler = (error: unknown, event?: Event) => void | Promise<void>;

/** Options used to create one explicit telemetry scope. */
export interface ScopeOptions {
	readonly fields?: Fields;
	/** Runtime-neutral clock. Defaults to `new Date().toISOString()`. */
	readonly now?: () => string;
	/** Optional non-authoritative observer for reporter failures. */
	readonly onReporterError?: ReporterErrorHandler;
}

/** Explicit correlation scope that does not require async-local runtime support. */
export interface Scope {
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
	readonly records: readonly Event[];
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
	flush(key?: string): Promise<void>;
	discard(key?: string): void;
	readonly keys: readonly string[];
}

/** Minimal instant-like value required by portable execution-context projection. */
export interface InstantLike {
	toString(): string;
}

/** Structural execution-context fields projected without importing or owning a runtime context. */
export interface ContextFieldsInput {
	readonly id: string;
	readonly traceId?: string;
	readonly deploymentId?: string;
	readonly idempotencyKey?: string;
	readonly startedAt: InstantLike;
	readonly deadline?: InstantLike;
}
