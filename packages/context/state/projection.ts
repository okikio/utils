/** Read-only derived cells own their subscriptions; upstream mutation stays with the original owners. @module */
import { DisposableStack } from '@okikio/dispose';
import { create } from './cell.ts';
import type { Options, Reader } from './cell.ts';

/** Owned read capability. Disposal disconnects upstream listeners and completes local observations. */
export interface Projection<Value> extends Reader<Value>, Disposable {
	/** Once closed, the projection no longer follows upstream changes. */
	readonly closed: boolean;
	/** Latest selector/equality/observer/reporting defect. A failed projection keeps its last accepted value. */
	readonly error: unknown;
}
/** Infer each borrowed reader's current payload without granting write authority. */
type ValuesType<Readers extends readonly Reader<unknown>[]> = {
	readonly [Key in keyof Readers]: Readers[Key] extends Reader<infer Value> ? Value : never;
};

/** Select a read-only value; equality suppresses notifications and callback defects retain the last accepted projection. */
export function select<Value, Next>(
	reader: Reader<Value>,
	selector: (value: Value) => Next,
	options: Options<Next> = {},
): Projection<Next> {
	return combine([reader] as const, ([value]) => selector(value), options);
}

/**
 * Combine borrowed readers without implying a transaction across their owners.
 * Read every source when any source announces a change. Independently owned
 * cells may therefore expose intermediate combinations; this is not a transaction.
 *
 * Initial projection failure throws before listeners are acquired. Later defects
 * retain the last accepted value and remain available through error, including
 * after a later successful update. Payloads remain borrowed; publish immutable values.
 */
export function combine<const Readers extends readonly Reader<unknown>[], Next>(
	readers: Readers,
	project: (values: ValuesType<Readers>) => Next,
	options: Options<Next> = {},
): Projection<Next> {
	const owned = Object.freeze([...readers]);
	const read = (): ValuesType<Readers> => owned.map((reader) => reader.get()) as ValuesType<Readers>;
	const cell = create(project(read()), options);
	const resources = new DisposableStack();
	resources.use(cell);
	let error: unknown;
	let failed = false;
	let closed = false;
	/** Preserve the projection result and contain reporting failure independently of source state publication. */
	const update = (): void => {
		if (closed) return;
		try {
			cell.set(project(read()));
		} catch (failure) {
			failed = true;
			error = failure;
			try {
				void Promise.resolve(options.onError?.(failure)).catch((failure: unknown) => {
					failed = true;
					error = failure;
				});
			} catch (failure) {
				failed = true;
				error = failure;
			}
		}
	};
	try {
		for (const reader of owned) resources.use(reader.subscribe(update));
	} catch (failure) {
		// Release subscriptions already acquired. Keep both faults if rollback also fails.
		try {
			resources.dispose();
		} catch (cleanup) {
			throw new AggregateError([failure, cleanup], 'Projection subscription and cleanup failed.');
		}
		throw failure;
	}
	return Object.freeze({
		get revision() {
			return cell.reader.revision;
		},
		get changes() {
			return cell.reader.changes;
		},
		get closed() {
			return closed;
		},
		get error() {
			return failed ? error : cell.observerError;
		},
		get: () => cell.reader.get(),
		subscribe: cell.reader.subscribe,
		[Symbol.dispose]() {
			if (closed) return;
			closed = true;
			resources.dispose();
		},
	});
}
