import type { CleanupOutcome, ReaderOptions } from './reader.ts';

/** Shared size limits for stream materialization and batching. */
export interface LimitOptions<Value> {
	/** Maximum number of values retained in one materialized collection or batch. */
	readonly maximumItems?: number;
	/** Maximum estimated bytes retained in one materialized collection or batch. */
	readonly maximumBytes?: number;
	/** Required byte estimator when `maximumBytes` is set. */
	readonly size?: (value: Value) => number;
	/** Optional cancellation signal checked before and after each source read. */
	readonly signal?: AbortSignal;
	/** Observe eventual source-iterator cleanup separately from a promptly cancelled collection. */
	readonly onCleanup?: (completion: Promise<CleanupOutcome>) => void;
}

/** Required batch limits. At least one maximum must be supplied. */
export interface BatchOptions<Value> extends LimitOptions<Value> {
	/** Flush a nonempty batch after this many milliseconds, starting at its first item. Requires clock. */
	readonly maximumDelay?: number;
	/** Caller-owned cancellable clock; structurally accepts Context clocks without a runtime dependency. */
	readonly clock?: { sleep(milliseconds: number, signal?: AbortSignal): Promise<void> };
	/** Maximum number of values retained in one emitted batch. */
	readonly maximumItems?: number;
	/** Maximum estimated bytes retained in one emitted batch. */
	readonly maximumBytes?: number;
}

/** ReadableStream iteration policy. */
export interface IterableOptions extends ReaderOptions {}

/** UTF-8 line iteration policy. */
export interface LineOptions extends IterableOptions {
	/** Maximum original bytes across the input, including line endings. Undefined keeps an unbounded total. */
	readonly maximumBytes?: number;
	/** Reject invalid UTF-8 instead of replacing invalid byte sequences. Defaults to false. */
	readonly fatal?: boolean;
	/** Maximum UTF-8 bytes allowed in one line, excluding the line-feed separator. */
	readonly maximumLineBytes?: number;
	/** Optional cancellation signal. Aborting it cancels the source reader. */
	readonly signal?: AbortSignal;
}
