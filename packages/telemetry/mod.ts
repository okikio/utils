/**
 * Report what an operation is doing with fields such as a request ID. Reporter failures stay separate from
 * the operation's result.
 *
 * Use a memory reporter to inspect events, then select a LogTape or OpenTelemetry adapter. A scope adds
 * shared fields. A bounded buffer can retain recent events until a failure makes them useful.
 *
 * Applications configure exporters and logging. Events cannot grant permission, settle a job, or prove
 * that an external write committed.
 *
 * @example
 * ```ts
 * import * as telemetry from '@okikio/telemetry';
 * const output = telemetry.memory();
 * const buffered = telemetry.buffer(output, { capacity: 2, maximumKeys: 64, maximumRecords: 1024 });
 * const scope = telemetry.create(buffered, { fields: { request_id: 'request-1' } });
 * await scope.report({ name: 'import.started', level: 'debug' });
 * await scope.report({ name: 'import.failed', level: 'error' });
 * console.log(output.records.map((event) => event.name).join(','));
 * ```
 *
 * @module
 */
import * as json from '@okikio/collection/record/json';
import * as faultCore from '@okikio/result/fault';
import type {
	BufferedReporter,
	BufferOptions,
	ContextFieldsInput,
	Event,
	EventInput,
	Fields,
	Level,
	MemoryReporter,
	ProjectionOptions,
	Reporter,
	ReporterErrorHandler,
	Scope,
	ScopeOptions,
	TraceFields,
	Value,
} from './types.ts';

const LEVELS = Object.freeze(['trace', 'debug', 'info', 'warning', 'error', 'fatal'] as const);
const LEVEL_RANK = Object.freeze(
	Object.fromEntries(LEVELS.map((level, index) => [level, index])) as Record<Level, number>,
);
const EVENT_NAME = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const FALLBACK_BUFFER_KEY = '__telemetry__';

/** Reporter that intentionally drops every record. */
export const noop: Readonly<{ report(): void }> = Object.freeze({ report() {} } satisfies Reporter);

/** Create one explicit telemetry scope around a reporter and stable correlation fields. */
export function create(reporter: Reporter = noop, options: ScopeOptions = {}): Scope {
	assertReporter(reporter);
	const projection = Object.freeze({ ...options.projection });
	const fields = freezeFields(options.fields ?? {}, projection);
	const now = options.now ?? isoNow;
	if (typeof now !== 'function') throw new TypeError('Telemetry now must be a function.');
	const onReporterError = options.onReporterError;
	if (onReporterError !== undefined && typeof onReporterError !== 'function') {
		throw new TypeError('Telemetry reporter error observer must be a function.');
	}

	return scope(reporter, fields, now, onReporterError, projection);
}

/** Create one immutable telemetry record without delivering it. */
export function event(
	input: EventInput,
	fields: Fields = {},
	now: () => string = isoNow,
	projection: ProjectionOptions = {},
): Event {
	assertEventName(input.name);
	const level = input.level ?? 'info';
	assertLevel(level);
	const at = input.at ?? now();
	if (typeof at !== 'string' || at.length === 0) {
		throw new TypeError('Telemetry event timestamp must be a non-empty string.');
	}
	const merged = mergeFields(projection, fields, input.fields ?? {});
	const projected = input.fault ??
		(input.error === undefined ? undefined : faultCore.encode(input.error, input.faultOptions));
	const frozenFault = projected === undefined ? undefined : freezeValue(json.copy(projected, projection));
	return Object.freeze({
		kind: 'telemetry-event',
		name: input.name,
		level,
		message: input.message ?? input.name,
		at,
		fields: merged,
		...(frozenFault === undefined ? {} : { fault: frozenFault }),
		...(input.error instanceof Error ? { error: input.error } : {}),
	});
}

/** Project the shared execution context into stable telemetry correlation fields. */
export function contextFields(ctx: ContextFieldsInput): Fields {
	if (ctx === null || typeof ctx !== 'object') throw new TypeError('Telemetry context projection requires a context.');
	return freezeFields({
		operation_id: ctx.id,
		...(ctx.traceId === undefined ? {} : { trace_id: ctx.traceId }),
		...(ctx.deploymentId === undefined ? {} : { deployment_id: ctx.deploymentId }),
		...(ctx.idempotencyKey === undefined ? {} : { idempotency_key: ctx.idempotencyKey }),
		started_at: ctx.startedAt.toString(),
		...(ctx.deadline === undefined ? {} : { deadline_at: ctx.deadline.toString() }),
	});
}

/** Merge trace fields from an instrumentation adapter with caller-owned fields. */
export function traceFields(trace: TraceFields | undefined): Fields {
	if (trace === undefined) return Object.freeze({});
	return freezeFields({
		...(trace.trace_id === undefined ? {} : { trace_id: trace.trace_id }),
		...(trace.span_id === undefined ? {} : { span_id: trace.span_id }),
		...(trace.trace_flags === undefined ? {} : { trace_flags: trace.trace_flags }),
		...(trace.trace_state === undefined ? {} : { trace_state: trace.trace_state }),
	});
}

/** Create a reporter that copies every record to each destination. */
export function fanout(...reporters: readonly Reporter[]): Reporter {
	for (const reporter of reporters) assertReporter(reporter);
	return Object.freeze({
		/**
		 * Keep ordinary records until this operation emits a trigger-level event.
		 * Flush that operation's retained history before the triggering record so
		 * an error is preceded by its context. Eviction bounds diagnostics only;
		 * the buffer is never the operation's saved result or recovery history.
		 */
		async report(value: Event): Promise<void> {
			const settled = await Promise.allSettled(reporters.map(async (reporter) => await reporter.report(value)));
			const failures = settled.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
			if (failures.length > 0) throw new AggregateError(failures, 'One or more telemetry reporters failed.');
		},
		async flush(): Promise<void> {
			const settled = await Promise.allSettled(reporters.map(async (reporter) => await reporter.flush?.()));
			const failures = settled.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
			if (failures.length > 0) throw new AggregateError(failures, 'One or more telemetry reporters failed to flush.');
		},
	});
}

/** Create a small in-memory reporter for unit tests and deterministic diagnostics. */
export function memory(): MemoryReporter {
	const records: Event[] = [];
	return Object.freeze({
		get records(): readonly Event[] {
			return Object.freeze([...records]);
		},
		report(value: Event): void {
			assertEvent(value);
			records.push(value);
		},
		clear(): void {
			records.length = 0;
		},
	});
}

/**
 * Retain low-severity history per correlation key and flush it when a failure arrives.
 *
 * The wrapper is intentionally backend-neutral. A host can call `discard(key)`
 * after successful completion and `flush(key)` when a warning or domain-specific
 * condition should reveal the preceding history.
 */
/** One ordered retained record. Identity stays distinct when a caller reports the same Event twice. */
interface Retained {
	readonly key: string;
	readonly value: Event;
}

/** Retain bounded FIFO failure history. Both global limits are required; dropped history is counted by stats(). */
export function buffer(target: Reporter, options: BufferOptions): BufferedReporter {
	assertReporter(target);
	const limit = (value: number, name: string): number => {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new TypeError(`Telemetry ${name} must be a non-negative safe integer.`);
		}
		return value;
	};
	const capacity = limit(options.capacity ?? 64, 'capacity');
	const maximumKeys = limit(options.maximumKeys, 'maximumKeys');
	const maximumRecords = limit(options.maximumRecords, 'maximumRecords');
	const trigger = options.trigger ?? 'error';
	assertLevel(trigger);
	if (options.key !== undefined && typeof options.key !== 'function') {
		throw new TypeError('Telemetry buffer key must be a function.');
	}
	const keyOf = options.key ?? defaultBufferKey;
	/** Both indexes own the same tokens. Removing a token releases both references before any await. */
	const buffers = new Map<string, Set<Retained>>();
	const ordered = new Set<Retained>();
	let dropped = 0;
	const remove = (entry: Retained): void => {
		ordered.delete(entry);
		const retained = buffers.get(entry.key)!;
		retained.delete(entry);
		if (retained.size === 0) buffers.delete(entry.key);
	};
	const evict = (entry: Retained): void => {
		remove(entry);
		dropped++;
	};
	const discard = (key?: string): void => {
		if (key === undefined) {
			buffers.clear();
			ordered.clear();
			return;
		}
		for (const entry of buffers.get(key) ?? []) remove(entry);
	};
	/** Detach this history before delivery, so reentrant reports belong to a new buffer rather than this flush. */
	const flushKey = async (key: string): Promise<void> => {
		const retained = [...(buffers.get(key) ?? [])];
		discard(key);
		for (const entry of retained) await target.report(entry.value);
	};
	return Object.freeze({
		get keys(): readonly string[] {
			return Object.freeze([...buffers.keys()]);
		},
		stats: () => Object.freeze({ keys: buffers.size, records: ordered.size, dropped }),
		async report(value: Event): Promise<void> {
			assertEvent(value);
			const key = keyOf(value);
			if (typeof key !== 'string' || key.length === 0) {
				throw new TypeError('Telemetry buffer key must be a non-empty string.');
			}
			if (LEVEL_RANK[value.level] >= LEVEL_RANK[trigger]) {
				await flushKey(key);
				await target.report(value);
				return;
			}
			if (capacity === 0 || maximumKeys === 0 || maximumRecords === 0) {
				dropped++;
				return;
			}
			if (!buffers.has(key) && buffers.size >= maximumKeys) {
				// FIFO key eviction discards all history of the oldest retained correlation.
				const oldest = buffers.values().next().value!;
				for (const entry of oldest) evict(entry);
			}
			const retained = buffers.get(key);
			if (retained !== undefined && retained.size >= capacity) evict(retained.values().next().value!);
			if (ordered.size >= maximumRecords) evict(ordered.values().next().value!);
			const entry = Object.freeze({ key, value });
			const group = buffers.get(key) ?? new Set<Retained>();
			group.add(entry);
			buffers.set(key, group);
			ordered.add(entry);
		},
		async flush(key?: string): Promise<void> {
			for (const candidate of key === undefined ? [...buffers.keys()] : [key]) await flushKey(candidate);
			await target.flush?.();
		},
		discard,
	});
}

/** Return whether one severity is at least as important as another. */
export function atLeast(level: Level, threshold: Level): boolean {
	assertLevel(level);
	assertLevel(threshold);
	return LEVEL_RANK[level] >= LEVEL_RANK[threshold];
}

/** Build one immutable nested scope while preserving reporter and error policy. @internal */
function scope(
	reporter: Reporter,
	fields: Fields,
	now: () => string,
	onReporterError: ReporterErrorHandler | undefined,
	projection: ProjectionOptions,
): Scope {
	return Object.freeze({
		fields,
		/** Validate and build the event first; contain delivery failures without hiding malformed event input. */
		async report(input: EventInput): Promise<Event> {
			const value = event(input, fields, now, projection);
			try {
				await reporter.report(value);
			} catch (error) {
				try {
					await onReporterError?.(error, value);
				} catch { /* telemetry failure observation is non-authoritative */ }
			}
			return value;
		},
		child(extra: Fields): Scope {
			return scope(reporter, mergeFields(projection, fields, extra), now, onReporterError, projection);
		},
		async flush(): Promise<void> {
			try {
				await reporter.flush?.();
			} catch (error) {
				try {
					await onReporterError?.(error);
				} catch { /* telemetry failure observation is non-authoritative */ }
			}
		},
	});
}

/** Merge field maps without invoking accessor properties. @internal */
function mergeFields(projection: ProjectionOptions, ...sources: readonly Fields[]): Fields {
	const output: Record<string, Value> = Object.create(null);
	for (const fields of sources) {
		const snapshot = snapshotFields(fields, projection);
		for (const [key, value] of Object.entries(snapshot)) output[key] = value;
	}
	return snapshotFields(output, projection);
}

/** Snapshot one structured field map without invoking accessor properties. @internal */
function freezeFields(fields: Fields, projection: ProjectionOptions = {}): Fields {
	return snapshotFields(fields, projection);
}

/** Use the shared JSON limits so cycles, aliases and aggregate text have one bounded-copy owner. */
function snapshotFields(fields: Fields, projection: ProjectionOptions): Fields {
	if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
		throw new TypeError('Telemetry fields must be a record.');
	}
	const copied = json.copy(fields, projection) as Fields;
	for (const key of Object.keys(copied)) {
		if (key.length === 0) throw new TypeError('Telemetry field names cannot be empty.');
	}
	return freezeValue(copied) as Fields;
}

/** Freeze only the already-validated, bounded copy; never visit the caller's live object a second time. */
function freezeValue(value: Value): Value {
	if (value !== null && typeof value === 'object') {
		for (const child of Object.values(value)) freezeValue(child);
		Object.freeze(value);
	}
	return value;
}

/** Reject malformed event names before they become stable diagnostic keys. @internal */
function assertEventName(name: string): void {
	if (typeof name !== 'string' || !EVENT_NAME.test(name)) {
		throw new TypeError(`Invalid telemetry event name ${JSON.stringify(name)}.`);
	}
}

/** Reject unsupported severities before adapter selection. @internal */
function assertLevel(level: string): asserts level is Level {
	if (!Object.hasOwn(LEVEL_RANK, level)) throw new TypeError(`Invalid telemetry level ${JSON.stringify(level)}.`);
}

/** Reject malformed reporter objects at composition sites. @internal */
function assertReporter(reporter: Reporter): void {
	if (reporter === null || typeof reporter !== 'object' || typeof reporter.report !== 'function') {
		throw new TypeError('Telemetry reporter must provide report(event).');
	}
}

/** Reject malformed event objects accepted by reporter wrappers. @internal */
function assertEvent(value: Event): void {
	if (value === null || typeof value !== 'object' || value.kind !== 'telemetry-event') {
		throw new TypeError('Telemetry reporter requires an event.');
	}
	assertEventName(value.name);
	assertLevel(value.level);
}

/** Derive a stable buffer key from the strongest available correlation identity. @internal */
function defaultBufferKey(value: Event): string {
	for (const field of ['trace_id', 'request_id', 'operation_id', 'workflow_id', 'item_id']) {
		const candidate = value.fields[field];
		if (typeof candidate === 'string' && candidate.length > 0) return candidate;
	}
	return FALLBACK_BUFFER_KEY;
}

/** Runtime-neutral wall-clock fallback used only when the caller does not provide a clock. @internal */
function isoNow(): string {
	return new Date().toISOString();
}

export type {
	BufferedReporter,
	BufferOptions,
	ContextFieldsInput,
	Event,
	EventInput,
	Fields,
	Level,
	MemoryReporter,
	ProjectionOptions,
	Reporter,
	ReporterErrorHandler,
	Scope,
	ScopeOptions,
	TraceFields,
	Value,
} from './types.ts';
