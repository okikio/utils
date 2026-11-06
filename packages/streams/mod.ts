/**
 * Read asynchronous data a piece at a time instead of collecting the complete source. For example, split
 * incoming bytes into lines or group records into bounded batches for a database write.
 *
 * Item, byte, and line limits bound the adapter's retained state. They cannot bound an array that the
 * consumer keeps growing. Use collect() only when a finite in-memory result is intended.
 *
 * Pass cancellation to source I/O as well as to the adapter. Early return releases owned readers promptly,
 * although source cleanup may finish later. Object byte estimates come from the caller; line framing
 * counts original encoded bytes.
 *
 * @example
 * ```ts
 * import * as streams from '@okikio/streams';
 * const batches = streams.batch(['a', 'b', 'c'], { maximumItems: 2 });
 * console.log(JSON.stringify(await Array.fromAsync(batches)));
 * const bytes = new Response(`first
 * second
 * `).body!;
 * console.log(JSON.stringify(await Array.fromAsync(streams.lines(bytes, { maximumLineBytes: 64 }))));
 * ```
 *
 * @module
 */
import type { BatchOptions, IterableOptions, LimitOptions, LineOptions } from './types.ts';
import * as readers from './reader.ts';
import type { CleanupOutcome } from './reader.ts';

/** Materialization or batching exceeded an explicit item or byte limit. */
export class StreamLimitError extends Error {
	/** Whether the caller-configured limit was based on item count or estimated bytes. */
	readonly limit: 'items' | 'bytes';
	/** The configured maximum that the caller declared as part of the contract. */
	readonly maximum: number;
	/** The observed count or byte estimate that crossed the configured maximum. */
	readonly actual: number;

	/** Create one typed limit failure that reports both the configured maximum and the observed amount. */
	constructor(limit: 'items' | 'bytes', maximum: number, actual: number) {
		super(`Stream ${limit} limit ${maximum} was exceeded by ${actual}.`);
		this.name = 'StreamLimitError';
		this.limit = limit;
		this.maximum = maximum;
		this.actual = actual;
	}
}

/** Convert an iterable into a Web ReadableStream while retaining source cancellation. */
export function readable<Value>(
	source: Iterable<Value | PromiseLike<Value>> | AsyncIterable<Value>,
): ReadableStream<Value> {
	const iterator = toAsyncIterator(source);
	return new ReadableStream<Value>({
		/** Request one iterator value when the Web Stream has capacity; the stream owns subsequent demand. */
		async pull(controller) {
			try {
				const next = await iterator.next();
				if (next.done) controller.close();
				else controller.enqueue(next.value);
			} catch (error) {
				controller.error(error);
			}
		},
		/** Forward cancellation to the source iterator and wait for its return hook. */
		async cancel(reason) {
			await iterator.return?.(reason);
		},
	});
}

/** Iterate a Web ReadableStream with explicit early-return cancellation policy. */
export async function* iterable<Value>(
	source: ReadableStream<Value>,
	options: IterableOptions = {},
): AsyncIterableIterator<Value> {
	const reader = readers.open(source, options);
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) return;
			yield next.value;
		}
	} finally {
		void reader.close('ReadableStream iteration ended early.');
	}
}

/** One UTF-8 line exceeded the caller-declared byte limit. */
export class StreamLineLimitError extends RangeError {
	/** Maximum UTF-8 bytes accepted for one line. */
	readonly maximum: number;
	/** Line bytes observed when the limit was crossed. */
	readonly actual: number;

	/** Create this StreamLineLimitError from the explicit contract values supplied by its caller. */
	constructor(maximum: number, actual: number) {
		super(`Stream line byte limit ${maximum} was exceeded by ${actual}.`);
		this.name = 'StreamLineLimitError';
		this.maximum = maximum;
		this.actual = actual;
	}
}

/**
 * Decode a byte stream into UTF-8 lines while preserving stream cancellation.
 *
 * The line-feed separator is not returned. A carriage return immediately
 * before the separator is removed. The final unterminated line is returned.
 * Early exit requests cancellation and releases the reader without waiting for
 * unbounded source cleanup. The source owner remains responsible for that cleanup.
 */
export async function* lines(
	source: ReadableStream<Uint8Array>,
	options: LineOptions = {},
): AsyncIterableIterator<string> {
	const maximum = options.maximumLineBytes === undefined
		? undefined
		: positiveInteger(options.maximumLineBytes, 'maximumLineBytes');
	const totalLimit = options.maximumBytes === undefined
		? undefined
		: positiveInteger(options.maximumBytes, 'maximumBytes');
	const reader = readers.open(source, options);
	let totalBytes = 0;
	let parts: Uint8Array[] = [];
	let lineBytes = 0;

	try {
		while (true) {
			throwIfAborted(options.signal);
			const next = await reader.read();
			throwIfAborted(options.signal);
			if (next.done) break;
			const chunk = next.value;
			totalBytes += chunk.byteLength;
			if (totalLimit !== undefined && totalBytes > totalLimit) {
				throw new StreamLimitError('bytes', totalLimit, totalBytes);
			}
			let start = 0;
			for (let index = 0; index < chunk.byteLength; index += 1) {
				if (chunk[index] !== 0x0a) continue;
				appendLinePart(parts, chunk.subarray(start, index), maximum, lineBytes);
				lineBytes += index - start;
				// Decode only after joining the complete line, so a UTF-8 character may span chunks.
				yield decodeLine(parts, lineBytes, options.fatal);
				throwIfAborted(options.signal);
				parts = [];
				lineBytes = 0;
				start = index + 1;
			}
			if (start < chunk.byteLength) {
				const part = chunk.subarray(start);
				appendLinePart(parts, part, maximum, lineBytes);
				lineBytes += part.byteLength;
			}
		}
		if (lineBytes > 0) yield decodeLine(parts, lineBytes, options.fatal);
	} finally {
		void reader.close('ReadableStream line iteration ended early.');
	}
}

/** Pipe iterable values into a Web WritableStream with native pressure and cancellation. */
export async function pipe<Value>(
	source: Iterable<Value | PromiseLike<Value>> | AsyncIterable<Value>,
	destination: WritableStream<Value>,
	options: StreamPipeOptions = {},
): Promise<void> {
	await readable(source).pipeTo(destination, options);
}

/** Materialize a finite iterable only within explicit optional item and byte limits. */
export async function collect<Value>(
	source: Iterable<Value> | AsyncIterable<Value>,
	options: LimitOptions<Value> = {},
): Promise<readonly Value[]> {
	throwIfAborted(options.signal);
	const limits = normalizeLimits(options, false);
	const values: Value[] = [];
	let bytes = 0;
	for await (const value of observed(source, options)) {
		throwIfAborted(options.signal);
		const nextItems = values.length + 1;
		if (limits.maximumItems !== undefined && nextItems > limits.maximumItems) {
			throw new StreamLimitError('items', limits.maximumItems, nextItems);
		}
		bytes += estimateSize(value, limits);
		if (limits.maximumBytes !== undefined && bytes > limits.maximumBytes) {
			throw new StreamLimitError('bytes', limits.maximumBytes, bytes);
		}
		values.push(value);
	}
	throwIfAborted(options.signal);
	return Object.freeze(values);
}

/** Group source values into bounded immutable batches without materializing the full source. */
export async function* batch<Value>(
	source: Iterable<Value> | AsyncIterable<Value>,
	options: BatchOptions<Value>,
): AsyncIterableIterator<readonly Value[]> {
	throwIfAborted(options.signal);
	const limits = normalizeLimits(options, true);
	if (options.maximumDelay !== undefined) {
		if (!Number.isFinite(options.maximumDelay) || options.maximumDelay <= 0 || options.clock === undefined) {
			throw new TypeError('Timed batching requires positive finite maximumDelay and a cancellable clock.');
		}
		yield* timedBatch(source, options, limits);
		return;
	}
	let values: Value[] = [];
	let bytes = 0;
	for await (const value of observed(source, options)) {
		throwIfAborted(options.signal);
		const size = estimateSize(value, limits);
		if (limits.maximumBytes !== undefined && size > limits.maximumBytes) {
			throw new StreamLimitError('bytes', limits.maximumBytes, size);
		}
		const reachesItemLimit = limits.maximumItems !== undefined && values.length >= limits.maximumItems;
		const reachesByteLimit = limits.maximumBytes !== undefined && values.length > 0 &&
			bytes + size > limits.maximumBytes;
		if (reachesItemLimit || reachesByteLimit) {
			yield Object.freeze(values);
			values = [];
			bytes = 0;
			throwIfAborted(options.signal);
		}
		values.push(value);
		bytes += size;
	}
	throwIfAborted(options.signal);
	if (values.length > 0) yield Object.freeze(values);
}

/**
 * Retain one pending read across deadline flushes. Consumer suspension starts no
 * additional reads. Cancellation observes late producer rejection and requests
 * owned cleanup without claiming that an uncooperative producer has stopped.
 */
async function* timedBatch<Value>(
	source: Iterable<Value> | AsyncIterable<Value>,
	options: BatchOptions<Value>,
	limits: NormalizedLimits<Value>,
): AsyncIterableIterator<readonly Value[]> {
	const lifetime = new AbortController();
	const signal = options.signal === undefined ? lifetime.signal : AbortSignal.any([options.signal, lifetime.signal]);
	const iterator = observed(source, { signal, onCleanup: options.onCleanup });
	let pending: Promise<IteratorResult<Value>> | undefined;
	let timer: AbortController | undefined;
	let deadline: Promise<{ readonly kind: 'deadline' }> | undefined;
	let values: Value[] = [];
	let bytes = 0;
	/** Abort removes the clock's owned timer; its rejection is already observed by each race. */
	const stopTimer = (): void => {
		timer?.abort();
		timer = undefined;
		deadline = undefined;
	};
	try {
		while (true) {
			throwIfAborted(signal);
			pending ??= iterator.next();
			const read = pending.then((next) => ({ kind: 'read' as const, next }));
			const result = deadline === undefined ? await read : await Promise.race([read, deadline]);
			throwIfAborted(signal);
			// Keep pending after a deadline flush: starting another read would overlap producer work.
			if (result.kind === 'deadline') {
				stopTimer();
				yield Object.freeze(values);
				values = [];
				bytes = 0;
				continue;
			}
			pending = undefined;
			if (result.next.done) break;
			const value = result.next.value;
			const size = estimateSize(value, limits);
			if (limits.maximumBytes !== undefined && size > limits.maximumBytes) {
				throw new StreamLimitError('bytes', limits.maximumBytes, size);
			}
			if (limits.maximumBytes !== undefined && values.length > 0 && bytes + size > limits.maximumBytes) {
				stopTimer();
				yield Object.freeze(values);
				values = [];
				bytes = 0;
				throwIfAborted(signal);
			}
			values.push(value);
			bytes += size;
			if (limits.maximumItems !== undefined && values.length >= limits.maximumItems) {
				stopTimer();
				yield Object.freeze(values);
				values = [];
				bytes = 0;
			} else if (deadline === undefined) {
				timer = new AbortController();
				deadline = options.clock!.sleep(options.maximumDelay!, AbortSignal.any([signal, timer.signal])).then(() => ({
					kind: 'deadline' as const,
				}));
				void deadline.catch(() => {});
			}
		}
		stopTimer();
		if (values.length > 0) yield Object.freeze(values);
	} finally {
		stopTimer();
		lifetime.abort();
		void pending?.catch(() => {});
		void iterator.return?.(undefined).catch(() => {});
	}
}

/** Append one byte segment after enforcing the per-line byte limit. */
function appendLinePart(
	parts: Uint8Array[],
	part: Uint8Array,
	maximum: number | undefined,
	current: number,
): void {
	const actual = current + part.byteLength;
	if (maximum !== undefined && actual > maximum) throw new StreamLineLimitError(maximum, actual);
	if (part.byteLength > 0) parts.push(part);
}

/** Decode one complete line and remove a CR immediately before LF or end-of-stream. */
function decodeLine(parts: readonly Uint8Array[], bytes: number, fatal = false): string {
	if (bytes === 0) return '';
	const joined = new Uint8Array(bytes);
	let offset = 0;
	for (const part of parts) {
		joined.set(part, offset);
		offset += part.byteLength;
	}
	const end = joined[joined.byteLength - 1] === 0x0d ? joined.byteLength - 1 : joined.byteLength;
	return new TextDecoder('utf-8', { fatal }).decode(joined.subarray(0, end));
}

/** Normalize an AbortSignal into the reason propagated by stream operations. */
function abortReason(signal: AbortSignal): unknown {
	return signal.reason;
}

/**
 * Preserve an existing async iterator, or adapt a synchronous iterator whose values may be Promises.
 * Only each yielded value is awaited; iteration remains pull-based and creates no background queue.
 */
function toAsyncIterator<Value>(
	source: Iterable<Value | PromiseLike<Value>> | AsyncIterable<Value>,
): AsyncIterator<Value> {
	if (Symbol.asyncIterator in Object(source)) return (source as AsyncIterable<Value>)[Symbol.asyncIterator]();
	const iterator = (source as Iterable<Value | PromiseLike<Value>>)[Symbol.iterator]();
	return {
		/** Await a yielded Promise like native for-await, without awaiting the iterator's completion value. */
		async next() {
			const result = iterator.next();
			return result.done ? { done: true, value: undefined } : { done: false, value: await result.value };
		},
		/** Request source cleanup once the consumer stops and await its returned value. */
		async return(value?: unknown) {
			const result = iterator.return?.(value as never) ?? { done: true, value: value as never };
			return { done: true, value: await result.value };
		},
	};
}

interface NormalizedLimits<Value> {
	readonly maximumItems?: number;
	readonly maximumBytes?: number;
	readonly size?: (value: Value) => number;
}

/**
 * Validate count/byte policy before acquiring the source. A batch requires at least one bound;
 * collect permits no bound because its caller may already own a known finite input.
 * Byte limits require an explicit estimator rather than guessing an object's heap size.
 */
function normalizeLimits<Value>(options: LimitOptions<Value>, required: boolean): NormalizedLimits<Value> {
	const maximumItems = options.maximumItems === undefined
		? undefined
		: positiveInteger(options.maximumItems, 'maximumItems');
	const maximumBytes = options.maximumBytes === undefined
		? undefined
		: positiveInteger(options.maximumBytes, 'maximumBytes');
	if (required && maximumItems === undefined && maximumBytes === undefined) {
		throw new TypeError('Batching requires maximumItems or maximumBytes.');
	}
	if (maximumBytes !== undefined && options.size === undefined) {
		throw new TypeError('A size estimator is required when maximumBytes is configured.');
	}
	return Object.freeze({
		...(maximumItems === undefined ? {} : { maximumItems }),
		...(maximumBytes === undefined ? {} : { maximumBytes }),
		...(options.size === undefined ? {} : { size: options.size }),
	});
}

/** Call the caller's byte estimator only for byte-bounded work and reject invalid accounting. */
function estimateSize<Value>(value: Value, limits: NormalizedLimits<Value>): number {
	if (limits.maximumBytes === undefined) return 0;
	const size = limits.size!(value);
	if (!Number.isSafeInteger(size) || size < 0) {
		throw new TypeError('Stream size estimates must be non-negative safe integers.');
	}
	return size;
}

/** Reject fractional, zero or unsafe capacities before counters or buffers depend on them. */
function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer.`);
	return value;
}

/** Propagate the caller's exact abort reason instead of converting cancellation into EOF. */
function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	throw signal.reason;
}

export type { BatchOptions, IterableOptions, LimitOptions, LineOptions } from './types.ts';

export { bytes } from './bytes.ts';

/**
 * Observe arbitrary iterator reads under cancellation without claiming to stop a
 * producer-owned Promise. Early exit requests return() once; onCleanup retains
 * its eventual outcome when the producer cannot finish promptly.
 */
async function* observed<Value>(
	source: Iterable<Value> | AsyncIterable<Value>,
	options: Pick<LimitOptions<Value>, 'signal' | 'onCleanup'>,
): AsyncIterableIterator<Value> {
	throwIfAborted(options.signal);
	const iterator = toAsyncIterator(source);
	let complete = false;
	let resolveCleanup!: (outcome: CleanupOutcome) => void;
	const cleanup = new Promise<CleanupOutcome>((resolve) => {
		resolveCleanup = resolve;
	});
	try {
		options.onCleanup?.(cleanup);
		while (true) {
			throwIfAborted(options.signal);
			const next = await observe(iterator.next(), options.signal);
			throwIfAborted(options.signal);
			if (next.done) {
				complete = true;
				return;
			}
			yield next.value;
		}
	} finally {
		if (complete || iterator.return === undefined) {
			resolveCleanup(Object.freeze({ status: complete ? 'completed' : 'released' }));
		} else {
			try {
				void Promise.resolve(iterator.return()).then(
					() => resolveCleanup(Object.freeze({ status: 'released' })),
					(error: unknown) => resolveCleanup(Object.freeze({ status: 'failed', error })),
				);
			} catch (error) {
				resolveCleanup(Object.freeze({ status: 'failed', error }));
			}
		}
	}
}

/** Consume late rejection while removing the observer's abort listener after either outcome. */
function observe<Value>(value: PromiseLike<Value>, signal?: AbortSignal): Promise<Value> {
	if (signal === undefined) return Promise.resolve(value);
	return new Promise<Value>((resolve, reject) => {
		const abort = (): void => {
			signal.removeEventListener('abort', abort);
			reject(abortReason(signal));
		};
		signal.addEventListener('abort', abort, { once: true });
		Promise.resolve(value).then((value) => {
			signal.removeEventListener('abort', abort);
			resolve(value);
		}, (error: unknown) => {
			signal.removeEventListener('abort', abort);
			reject(error);
		});
		if (signal.aborted) abort();
	});
}
