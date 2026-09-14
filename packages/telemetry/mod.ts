/**
 * Runtime-neutral structured telemetry, correlation, and failure-history mechanics.
 *
 * The package does not configure logging, tracing, exporters, environment
 * variables, or async-local storage. Hosts choose those policies and may adapt
 * these records to LogTape, OpenTelemetry, Sentry, a test recorder, or another
 * backend.
 *
 * @module
 */
import * as faultCore from '@okikio/fault';
import type {
	BufferedReporter,
	BufferOptions,
	ContextFieldsInput,
	Event,
	EventInput,
	Fields,
	Level,
	MemoryReporter,
	Reporter,
	ReporterErrorHandler,
	Scope,
	ScopeOptions,
	TraceFields,
	Value,
} from './types.ts';

const LEVELS = Object.freeze(['trace', 'debug', 'info', 'warning', 'error', 'fatal'] as const);
const LEVEL_RANK = Object.freeze(Object.fromEntries(LEVELS.map((level, index) => [level, index])) as Record<Level, number>);
const EVENT_NAME = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const FALLBACK_BUFFER_KEY = '__telemetry__';

/** Reporter that intentionally drops every record. */
export const noop = Object.freeze({ report() {} } satisfies Reporter);

/** Create one explicit telemetry scope around a reporter and stable correlation fields. */
export function create(reporter: Reporter = noop, options: ScopeOptions = {}): Scope {
	assertReporter(reporter);
	const fields = freezeFields(options.fields ?? {});
	const now = options.now ?? isoNow;
	if (typeof now !== 'function') throw new TypeError('Telemetry now must be a function.');
	const onReporterError = options.onReporterError;
	if (onReporterError !== undefined && typeof onReporterError !== 'function') {
		throw new TypeError('Telemetry reporter error observer must be a function.');
	}

	return scope(reporter, fields, now, onReporterError);
}

/** Create one immutable telemetry record without delivering it. */
export function event(input: EventInput, fields: Fields = {}, now: () => string = isoNow): Event {
	assertEventName(input.name);
	const level = input.level ?? 'info';
	assertLevel(level);
	const at = input.at ?? now();
	if (typeof at !== 'string' || at.length === 0) throw new TypeError('Telemetry event timestamp must be a non-empty string.');
	const merged = mergeFields(fields, input.fields ?? {});
	const projected = input.fault ?? (input.error === undefined ? undefined : faultCore.encode(input.error, input.faultOptions));
	const frozenFault = projected === undefined ? undefined : snapshotValue(projected, 'fault');
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
export function buffer(target: Reporter, options: BufferOptions = {}): BufferedReporter {
	assertReporter(target);
	const capacity = options.capacity ?? 64;
	if (!Number.isSafeInteger(capacity) || capacity < 0) throw new TypeError('Telemetry buffer capacity must be a non-negative safe integer.');
	const trigger = options.trigger ?? 'error';
	assertLevel(trigger);
	if (options.key !== undefined && typeof options.key !== 'function') throw new TypeError('Telemetry buffer key must be a function.');
	const keyOf = options.key ?? defaultBufferKey;
	const buffers = new Map<string, Event[]>();

	const flushKey = async (key: string): Promise<void> => {
		const retained = buffers.get(key);
		buffers.delete(key);
		if (retained === undefined) return;
		for (const value of retained) await target.report(value);
	};

	return Object.freeze({
		get keys(): readonly string[] {
			return Object.freeze([...buffers.keys()]);
		},
		async report(value: Event): Promise<void> {
			assertEvent(value);
			const key = keyOf(value);
			if (typeof key !== 'string' || key.length === 0) throw new TypeError('Telemetry buffer key must be a non-empty string.');
			if (LEVEL_RANK[value.level] >= LEVEL_RANK[trigger]) {
				await flushKey(key);
				await target.report(value);
				return;
			}
			if (capacity === 0) return;
			const retained = buffers.get(key) ?? [];
			retained.push(value);
			if (retained.length > capacity) retained.splice(0, retained.length - capacity);
			buffers.set(key, retained);
		},
		async flush(key?: string): Promise<void> {
			if (key !== undefined) {
				await flushKey(key);
				await target.flush?.();
				return;
			}
			for (const candidate of [...buffers.keys()]) await flushKey(candidate);
			await target.flush?.();
		},
		discard(key?: string): void {
			if (key === undefined) buffers.clear();
			else buffers.delete(key);
		},
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
	onReporterError?: ReporterErrorHandler,
): Scope {
	return Object.freeze({
		fields,
		async report(input: EventInput): Promise<Event> {
			const value = event(input, fields, now);
			try {
				await reporter.report(value);
			} catch (error) {
				try { await onReporterError?.(error, value); } catch { /* telemetry failure observation is non-authoritative */ }
			}
			return value;
		},
		child(extra: Fields): Scope {
			return scope(reporter, mergeFields(fields, extra), now, onReporterError);
		},
		async flush(): Promise<void> {
			try {
				await reporter.flush?.();
			} catch (error) {
				try { await onReporterError?.(error); } catch { /* telemetry failure observation is non-authoritative */ }
			}
		},
	});
}

/** Merge field maps without invoking accessor properties. @internal */
function mergeFields(...sources: readonly Fields[]): Fields {
	const output: Record<string, Value> = Object.create(null);
	for (const fields of sources) {
		const snapshot = snapshotFields(fields);
		for (const [key, value] of Object.entries(snapshot)) output[key] = value;
	}
	return Object.freeze(output);
}

/** Snapshot one structured field map without invoking accessor properties. @internal */
function freezeFields(fields: Fields): Fields {
	return snapshotFields(fields);
}

/** Clone JSON-safe values so later caller mutation cannot rewrite emitted telemetry history. @internal */
function snapshotFields(fields: Fields): Fields {
	if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) throw new TypeError('Telemetry fields must be a record.');
	const prototype = Object.getPrototypeOf(fields);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Telemetry fields must use a plain record.');
	const output: Record<string, Value> = Object.create(null);
	for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(fields))) {
		if (!descriptor.enumerable) continue;
		if (key.length === 0) throw new TypeError('Telemetry field names cannot be empty.');
		if (!('value' in descriptor)) throw new TypeError(`Telemetry field ${JSON.stringify(key)} cannot be an accessor.`);
		output[key] = snapshotValue(descriptor.value as Value, key);
	}
	return Object.freeze(output);
}

/** Snapshot one JSON-safe field value recursively without invoking user accessors. @internal */
function snapshotValue(value: Value, name: string): Value {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new TypeError(`Telemetry field ${JSON.stringify(name)} must contain finite numbers.`);
		return value;
	}
	if (Array.isArray(value)) {
		const output: Value[] = [];
		const descriptors = Object.getOwnPropertyDescriptors(value);
		for (let index = 0; index < value.length; index += 1) {
			const descriptor = descriptors[String(index)];
			if (descriptor === undefined) {
				output[index] = null;
				continue;
			}
			if (!('value' in descriptor)) throw new TypeError(`Telemetry field ${JSON.stringify(name)} cannot contain accessors.`);
			output[index] = snapshotValue(descriptor.value as Value, name);
		}
		return Object.freeze(output);
	}
	if (typeof value !== 'object') throw new TypeError(`Telemetry field ${JSON.stringify(name)} must be JSON-safe.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`Telemetry field ${JSON.stringify(name)} must use plain records.`);
	const output: Record<string, Value> = Object.create(null);
	for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
		if (!descriptor.enumerable) continue;
		if (!('value' in descriptor)) throw new TypeError(`Telemetry field ${JSON.stringify(name)} cannot contain accessors.`);
		output[key] = snapshotValue(descriptor.value as Value, name);
	}
	return Object.freeze(output);
}

/** Reject malformed event names before they become stable diagnostic keys. @internal */
function assertEventName(name: string): void {
	if (typeof name !== 'string' || !EVENT_NAME.test(name)) throw new TypeError(`Invalid telemetry event name ${JSON.stringify(name)}.`);
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
	if (value === null || typeof value !== 'object' || value.kind !== 'telemetry-event') throw new TypeError('Telemetry reporter requires an event.');
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
	Reporter,
	ReporterErrorHandler,
	Scope,
	ScopeOptions,
	TraceFields,
	Value,
} from './types.ts';
