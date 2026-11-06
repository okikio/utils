/** Bounded mapping composes existing scheduling owners instead of retaining another queue. @module */
import { mapPooledOrdered, mapPooledUnordered } from './bounded.ts';
import type { PooledOperationContext } from './bounded.ts';
import type { Result } from '@okikio/result';

/** Admission and result-retention budget for one consumer-owned map iteration. */
export interface MapOptionsType {
	/** Maximum admitted transformations, including completed results not yet acknowledged. */
	readonly concurrency: number;
	/** Input order can wait behind a slow item; completion order yields whichever finishes first. */
	readonly ordering: 'input' | 'completion';
	/** Result budget must cover concurrency. This adapter conservatively retains at most concurrency items. */
	readonly maximumBuffered: number;
	/** Cancels admission and cooperative mapper work. Uncooperative work is still joined. */
	readonly signal?: AbortSignal;
}

/** Map ordinary values. Thrown or rejected mapper defects stop admission and join admitted work. */
export function map<Item, Value>(
	source: Iterable<Item> | AsyncIterable<Item>,
	transform: (item: Item, context: PooledOperationContext) => Value | PromiseLike<Value>,
	options: MapOptionsType & { readonly mode?: 'values' },
): AsyncIterable<Value>;
/**
 * Preserve declared per-item Result failures as data and continue mapping.
 * A thrown defect is still terminal; settled mode never reclassifies arbitrary exceptions as expected failures.
 */
export function map<Item, Value, Failure>(
	source: Iterable<Item> | AsyncIterable<Item>,
	transform: (
		item: Item,
		context: PooledOperationContext,
	) => Result<Value, Failure> | PromiseLike<Result<Value, Failure>>,
	options: MapOptionsType & { readonly mode: 'settled' },
): AsyncIterable<Result<Value, Failure>>;
export function map<Item, Value>(
	source: Iterable<Item> | AsyncIterable<Item>,
	transform: (item: Item, context: PooledOperationContext) => Value | PromiseLike<Value>,
	options: MapOptionsType & { readonly mode?: 'values' | 'settled' },
): AsyncIterable<Value> {
	if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1) {
		throw new RangeError('Map concurrency must be a positive safe integer.');
	}
	if (!Number.isSafeInteger(options.maximumBuffered) || options.maximumBuffered < options.concurrency) {
		throw new RangeError('Map maximumBuffered must cover concurrency.');
	}
	if (options.ordering !== 'input' && options.ordering !== 'completion') throw new TypeError('Invalid map ordering.');
	if (options.mode !== undefined && options.mode !== 'values' && options.mode !== 'settled') {
		throw new TypeError('Invalid map mode.');
	}
	// Settled mode changes only the result type: user-thrown defects still reach
	// the same cancellation/join path instead of being converted into Result data.
	const input = {
		items: source,
		concurrency: options.concurrency,
		signal: options.signal,
		map: async (item: Item, context: PooledOperationContext): Promise<Value> => await transform(item, context),
	};
	return options.ordering === 'input'
		? mapPooledOrdered(input)
		: mapPooledUnordered({ ...input, acknowledgeCompletions: true });
}
