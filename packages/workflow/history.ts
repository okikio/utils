/**
 * Workflow instruction history and replay semantics.
 *
 * A history owner receives every deterministic instruction before external work
 * starts. It can return an already recorded completion during replay or call
 * `next()` to advance a new instruction. Concrete durable storage belongs in a
 * package. This module provides only the generic behavior contract and a bounded
 * process-local reference implementation.
 *
 * @module
 */
import * as context from '@okikio/context';
import type {
	History,
	HistoryCompletionType,
	HistoryEntryType,
	HistoryInput,
	HistoryOptions,
	MemoryHistory,
	HistorySnapshotType,
	WorkflowCompletionAny,
} from './types.ts';

/** Raised when replay yields different instruction identity at an existing path. */
export class ReplayError extends Error {
	/** Workflow run whose replay diverged. */
	readonly runId: string;
	/** Deterministic instruction path that no longer matches history. */
	readonly path: string;
	/** Fingerprint already recorded by history. */
	readonly expected: string;
	/** Fingerprint yielded by the current workflow program. */
	readonly actual: string;

	/** Create one replay-divergence error with the recorded and newly yielded fingerprints. */
	constructor(runId: string, path: string, expected: string, actual: string) {
		super(
			`Workflow run ${JSON.stringify(runId)} diverged at ${JSON.stringify(path)}. ` +
				`Recorded fingerprint ${JSON.stringify(expected)} does not match ${JSON.stringify(actual)}.`,
		);
		this.name = 'ReplayError';
		this.runId = runId;
		this.path = path;
		this.expected = expected;
		this.actual = actual;
	}
}

/** Raised when bounded process-local history cannot admit another instruction. */
export class HistoryCapacityError extends RangeError {
	/** Configured maximum retained instruction count. */
	readonly maximum: number;

	/** Create one capacity error before local history would exceed its configured retained-entry limit. */
	constructor(maximum: number) {
		super(`Workflow history reached its configured maximum of ${maximum} retained instructions.`);
		this.name = 'HistoryCapacityError';
		this.maximum = maximum;
	}
}

/** Mutable state retained for one instruction in the process-local history. */
interface EntryState {
	/** Workflow run that owns this retained instruction record. */
	readonly runId: string;
	/** Deterministic instruction path within that workflow run. */
	readonly path: string;
	/** Fingerprint fixed when the instruction first enters history. */
	readonly fingerprint: string;
	/** Recorded terminal completion returned during later replay. */
	completion?: HistoryCompletionType;
	/** In-flight local advancement shared by concurrent callers until it settles. */
	pending?: Promise<WorkflowCompletionAny>;
}

/**
 * Creates a bounded process-local workflow history.
 *
 * The history deduplicates concurrent scheduling of the same run/path and
 * returns a recorded completion on replay. It rejects a changed fingerprint at
 * an existing path. Process exit loses all entries, so this implementation is
 * suitable for tests and local execution only.
 *
 * The configured `maximumEntries` bounds retained memory. A durable provider
 * can implement the same {@link History} interface with database claims and
 * persisted completion encoding.
 *
 * @example Local replay
 * ```ts
 * import * as history from '@okikio/workflow/history';
 * import * as workflow from '@okikio/workflow';
 *
 * await using records = history.memory({ maximumEntries: 1_000 });
 * await using scheduler = workflow.scheduler({ history: records });
 * ```
 *
 * @example Inspect one run in a test
 * ```ts
 * const snapshot = records.inspect('run-42');
 * console.log(snapshot.entries);
 * ```
 */
export function memory(options: HistoryOptions = {}): MemoryHistory {
	const maximum = positive(options.maximumEntries ?? 10_000, 'history maximumEntries');
	const entries = new Map<string, EntryState>();
	let closed = false;

	const history: MemoryHistory = Object.freeze({
		async schedule(input: HistoryInput): Promise<WorkflowCompletionAny> {
			if (closed) throw new Error('Workflow history is closed.');
			context.check(input.ctx);
			const key = entryKey(input.ctx.runId, input.path);
			const existing = entries.get(key);
			if (existing !== undefined) {
				if (existing.fingerprint !== input.identity.fingerprint) {
					throw new ReplayError(input.ctx.runId, input.path, existing.fingerprint, input.identity.fingerprint);
				}
				if (existing.completion !== undefined) return await input.decode(existing.completion);
				if (existing.pending !== undefined) return await existing.pending;
			}

			if (existing === undefined && entries.size >= maximum) throw new HistoryCapacityError(maximum);
			const state = existing ?? {
				runId: input.ctx.runId,
				path: input.path,
				fingerprint: input.identity.fingerprint,
			};
			if (existing === undefined) entries.set(key, state);

			// Store the in-flight promise before invoking external work. Concurrent
			// callers therefore follow the same instruction instead of dispatching a
			// duplicate operation inside this process.
			const pending = input.next().then(async (completion) => {
				// Encode before publishing completion into retained history. A concrete
				// durable provider can persist this exact data without retaining schemas,
				// Error instances, or definition objects.
				state.completion = await input.encode(completion);
				delete state.pending;
				return completion;
			}, (error) => {
				delete state.pending;
				throw error;
			});
			state.pending = pending;
			return await pending;
		},
		inspect(runId: string): HistorySnapshotType {
			const output: HistoryEntryType[] = [];
			for (const state of entries.values()) {
				if (state.runId !== runId) continue;
				output.push(Object.freeze({
					path: state.path,
					fingerprint: state.fingerprint,
					...(state.completion === undefined ? {} : { completion: state.completion }),
					pending: state.pending !== undefined,
				}));
			}
			output.sort((left, right) => left.path.localeCompare(right.path));
			return Object.freeze({ runId, entries: Object.freeze(output) });
		},
		async close(): Promise<void> {
			closed = true;
			entries.clear();
		},
		async [Symbol.asyncDispose](): Promise<void> {
			await history.close();
		},
	});
	return history;
}

/** Returns the collision-free process-local map key for one run instruction. */
function entryKey(runId: string, path: string): string {
	return `${runId.length}:${runId}${path}`;
}

/** Rejects invalid bounded counts before allocating process-local history state. */
function positive(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer.`);
	return value;
}
