/** Deterministic fixtures over the actual Workflow scheduler and instruction history. @module */
import * as json from '@okikio/collection/record/json';
import type { Context } from '@okikio/context';
import * as workflow from './mod.ts';
import * as history from './history.ts';
import type {
	HistorySnapshotType,
	HistoryValueType,
	SchedulerOptions,
	WorkflowDefinition,
	WorkflowImplementation,
	WorkflowResult,
} from './types.ts';

/** Explicit replay fixture identity. Exported data is diagnostic, never an executable or authorized job. */
export interface FixtureType {
	/** Fixed archive schema revision. */
	readonly format: 1;
	/** Exact workflow contract recorded by the fixture. */
	readonly definition: Readonly<{ id: string; version: string }>;
	/** Original JSON wire value or explicit undefined marker; codecs still validate it on replay. */
	readonly input: HistoryValueType;
	/** Bounded process-local instruction history, not PostgreSQL lifecycle/attempt history. */
	readonly history: HistorySnapshotType;
}
/** Required limits apply to both returned fixtures and imported archives. */
export interface LimitsType {
	/** Maximum retained instruction records. */
	readonly maximumEntries: number;
	/** Maximum canonical UTF-8 fixture bytes before the archive envelope. */
	readonly maximumBytes: number;
}
/** Validate explicit limits before allocating a scheduler or copying history. */
export function limits(options: LimitsType): void {
	for (const value of [options.maximumEntries, options.maximumBytes]) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new RangeError('Workflow fixture limits must be positive safe integers.');
		}
	}
}
/** Explicit fixture recording services; the scheduler and history owner close before the run returns. */
export interface RunOptions extends LimitsType {
	/** Borrowed execution parent; cancellation and the selected clock propagate into the workflow. */
	readonly ctx: Context;
	/** Stable execution identity used by every recorded instruction path. */
	readonly runId: string;
	/** Original wire input, including explicit undefined; detached JSON is captured before validation. */
	readonly input: unknown;
	/** Explicit command/resource services. This recorder supplies and owns its own bounded history. */
	readonly scheduler?: Omit<SchedulerOptions, 'history' | 'disposeHistory'>;
}
/** Record a bounded successful run with explicit command services using the production scheduler. */
export async function run<Definition extends WorkflowDefinition>(
	implementation: WorkflowImplementation<Definition>,
	options: RunOptions,
): Promise<Readonly<{ value: WorkflowResult<Definition>; fixture: FixtureType }>> {
	limits(options);
	const input: HistoryValueType = options.input === undefined ? Object.freeze({ kind: 'undefined' }) : Object.freeze({
		kind: 'value',
		value: json.copy(options.input, { maximumStringCodeUnits: options.maximumBytes }),
	});
	await using records = history.memory({ maximumEntries: options.maximumEntries });
	// The underlying history owns admission and replay. This wrapper bounds each encoded
	// completion before publication, then counts cumulative retained metadata/payload bytes.
	let retainedBytes = 0;
	const measured = new Set<string>();
	const bounded: import('./types.ts').History = {
		/**
		 * Count each instruction's retained metadata once, then measure encoded completions through the same
		 * history contract used by the replay test.
		 */
		async schedule(input) {
			if (!measured.has(input.path)) {
				const metadata = json.stringify({ path: input.path, fingerprint: input.identity.fingerprint }, {
					maximumBytes: options.maximumBytes,
				});
				retainedBytes += new TextEncoder().encode(metadata).byteLength;
				if (retainedBytes > options.maximumBytes) throw new RangeError('Workflow history exceeds maximumBytes.');
				measured.add(input.path);
			}
			return await records.schedule({
				...input,
				async encode(completion) {
					const encoded = await input.encode(completion);
					const text = json.stringify(encoded, { maximumBytes: options.maximumBytes });
					const bytes = new TextEncoder().encode(text).byteLength;
					if (retainedBytes + bytes > options.maximumBytes) {
						throw new RangeError('Workflow history exceeds maximumBytes.');
					}
					retainedBytes += bytes;
					return encoded;
				},
			});
		},
		async close() {
			await records.close();
		},
		async [Symbol.asyncDispose]() {
			await records.close();
		},
	};
	await using scheduler = workflow.scheduler({ ...options.scheduler, history: bounded });
	await using ctx = await workflow.context({
		definition: implementation.definition,
		input: input.kind === 'undefined' ? undefined : input.value,
		runId: options.runId,
		ctx: options.ctx,
	});
	const value = await workflow.run({ ctx, implementation, scheduler });
	const fixture = freeze({
		format: 1,
		definition: { id: implementation.definition.id, version: implementation.definition.version },
		input,
		history: records.inspect(options.runId),
	}, options);
	return Object.freeze({ value, fixture });
}
/**
 * Copy, validate and freeze diagnostic fixture data without retaining caller-owned containers or
 * invoking getters.
 */
export function freeze(input: unknown, options: LimitsType): FixtureType {
	limits(options);
	const text = json.stringify(input, {
		maximumBytes: options.maximumBytes,
		maximumStringCodeUnits: options.maximumBytes,
	});
	const value: unknown = JSON.parse(text);
	if (
		!record(value) || value.format !== 1 || !record(value.definition) || typeof value.definition.id !== 'string' ||
		typeof value.definition.version !== 'string' || !record(value.history) || typeof value.history.runId !== 'string' ||
		!Array.isArray(value.history.entries) || !historyValue(value.input)
	) throw new TypeError('Invalid workflow fixture.');
	if (
		Object.keys(value).some((key) => !['format', 'definition', 'input', 'history'].includes(key)) ||
		Object.keys(value.definition).some((key) => !['id', 'version'].includes(key)) ||
		Object.keys(value.history).some((key) => !['runId', 'entries'].includes(key))
	) throw new TypeError('Unknown workflow fixture field.');
	if (value.history.entries.length > options.maximumEntries) {
		throw new RangeError('Workflow fixture exceeds maximumEntries.');
	}
	const paths = new Set<string>();
	for (const entry of value.history.entries) {
		if (
			!record(entry) || typeof entry.path !== 'string' || !entry.path || typeof entry.fingerprint !== 'string' ||
			!entry.fingerprint || entry.pending !== false || !record(entry.completion) || !completion(entry.completion) ||
			Object.keys(entry).some((key) => !['path', 'fingerprint', 'pending', 'completion'].includes(key))
		) throw new TypeError('Fixture requires completed instruction records.');
		if (paths.has(entry.path)) throw new TypeError('Duplicate workflow fixture path.');
		paths.add(entry.path);
	}
	return deep(value) as unknown as FixtureType;
}
/** Inspect parsed inert JSON only; accessors were rejected by the bounded copy before this point. */
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Saved undefined uses an explicit tag; undefined is never an omitted successful value. */
function historyValue(value: unknown): boolean {
	return record(value) &&
		(value.kind === 'undefined' && Object.keys(value).length === 1 ||
			value.kind === 'value' && Object.keys(value).length === 2 && Object.hasOwn(value, 'value'));
}
/**
 * Validate the structural completion envelope; current exact instruction codecs validate payload
 * meaning during replay.
 */
function completion(value: Record<string, unknown>): boolean {
	if (Object.keys(value).length !== 2) return false;
	if (value.type === 'success') return historyValue(value.value);
	if (value.type === 'fault') return historyValue(value.fault);
	if (value.type === 'cancelled') return historyValue(value.reason);
	if (value.type !== 'failure' || !record(value.failure)) return false;
	const failure = value.failure;
	if (Object.keys(failure).length !== 2) return false;
	if (failure.kind === 'value') return historyValue(failure.value);
	return failure.kind === 'occurrence' && record(failure.value) && Object.keys(failure.value).length === 3 &&
		typeof failure.value.id === 'string' && typeof failure.value.message === 'string' &&
		Object.hasOwn(failure.value, 'data');
}
/** Parsed JSON depth is already bounded to 128 by the input copy; freeze children before their parent. */
function deep(value: unknown): unknown {
	if (value !== null && typeof value === 'object') {
		for (const item of Object.values(value)) deep(item);
		Object.freeze(value);
	}
	return value;
}

/**

 * A canonical archive detects accidental corruption; its SHA-256 digest is not authentication or

 * authorization.

 */
export async function encode(fixture: FixtureType, options: LimitsType): Promise<string> {
	const value = freeze(fixture, options);
	const data = json.stringify(value, { maximumBytes: options.maximumBytes });
	const digest = await integrity(data);
	return JSON.stringify({ format: 1, digest, data });
}
/** Import inert completed histories only. A trusted exact definition is still required by replay.check(). */
export async function decode(archive: string, options: LimitsType): Promise<FixtureType> {
	limits(options);
	// JSON escaping can expand a bounded payload by six times; cap the envelope before parsing.
	if (archive.length > options.maximumBytes * 6 + 256) throw new RangeError('Workflow archive exceeds envelope bound.');
	const envelope: unknown = JSON.parse(archive);
	if (
		!record(envelope) || Object.keys(envelope).length !== 3 || envelope.format !== 1 ||
		typeof envelope.data !== 'string' || typeof envelope.digest !== 'string' || !/^[a-f0-9]{64}$/.test(envelope.digest)
	) throw new TypeError('Invalid workflow archive.');
	if (new TextEncoder().encode(envelope.data).byteLength > options.maximumBytes) {
		throw new RangeError('Workflow archive exceeds maximumBytes.');
	}
	if (await integrity(envelope.data) !== envelope.digest) throw new TypeError('Workflow archive integrity mismatch.');
	return freeze(JSON.parse(envelope.data), options);
}
/** Web Crypto hashes only bounded canonical bytes; no runtime adapter, database or side effect is acquired. */
async function integrity(text: string): Promise<string> {
	return Array.from(
		new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
		(byte) => byte.toString(16).padStart(2, '0'),
	).join('');
}
