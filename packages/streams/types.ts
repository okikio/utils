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
}

/** Required batch limits. At least one maximum must be supplied. */
export interface BatchOptions<Value> extends LimitOptions<Value> {
	/** Maximum number of values retained in one emitted batch. */
	readonly maximumItems?: number;
	/** Maximum estimated bytes retained in one emitted batch. */
	readonly maximumBytes?: number;
}

/** ReadableStream iteration policy. */
export interface IterableOptions {
	/** Keep the source open when iteration ends early. Defaults to `false`. */
	readonly preventCancel?: boolean;
}

/** UTF-8 line iteration policy. */
export interface LineOptions extends IterableOptions {
	/** Maximum UTF-8 bytes allowed in one line, excluding the line-feed separator. */
	readonly maximumLineBytes?: number;
	/** Optional cancellation signal. Aborting it cancels the source reader. */
	readonly signal?: AbortSignal;
}
