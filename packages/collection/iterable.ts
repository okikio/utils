/** Lazy chunks and explicitly bounded retention for synchronous sources. @module */

/** Bounds include all scanned items, including duplicate keys. */
export interface RetentionOptionsType {
	/** Maximum source items inspected; exceeding this closes the iterator and throws. */
	readonly maximumItems: number;
	/** Maximum distinct SameValueZero keys retained, including undefined and NaN keys. */
	readonly maximumKeys: number;
}

/**
 * Yield owned frozen chunks before exhausting the source. The returned iterable
 * is single-pass; early return forwards source cleanup. Only one chunk is
 * retained, so an infinite source is usable by a bounded consumer. Size must be
 * a positive safe integer; validation occurs when iteration starts.
 */
export function* chunk<Value>(source: Iterable<Value>, size: number): IterableIterator<readonly Value[]> {
	limit(size, 'chunk size');
	if (size === 0) throw new RangeError('Chunk size must be positive.');
	let values: Value[] = [];
	for (const value of source) {
		values.push(value);
		if (values.length === size) {
			yield Object.freeze(values);
			values = [];
		}
	}
	if (values.length !== 0) yield Object.freeze(values);
}

/** Yield the first item for each key, with explicit scanned-item and distinct-key bounds. */
export function* unique<Value, Key>(
	source: Iterable<Value>,
	key: (value: Value, index: number) => Key,
	options: RetentionOptionsType,
): IterableIterator<Value> {
	const seen = new Set<Key>();
	for (const [identity, value] of keyed(source, key, options)) {
		if (seen.has(identity)) continue;
		if (seen.size >= options.maximumKeys) throw new RangeError('Iterable exceeds maximumKeys.');
		seen.add(identity);
		yield value;
	}
}

/**
 * Collect bounded groups in first-key order and source order within each group.
 * The returned Map is owned by the caller; each group's array is frozen. Values
 * and keys are borrowed, not cloned. This deliberately materializes the input.
 */
export function group<Value, Key>(
	source: Iterable<Value>,
	key: (value: Value, index: number) => Key,
	options: RetentionOptionsType,
): Map<Key, readonly Value[]> {
	const groups = new Map<Key, Value[]>();
	for (const [identity, value] of keyed(source, key, options)) {
		let values = groups.get(identity);
		if (values === undefined) {
			if (groups.size >= options.maximumKeys) throw new RangeError('Iterable exceeds maximumKeys.');
			values = [];
			groups.set(identity, values);
		}
		values.push(value);
	}
	for (const values of groups.values()) Object.freeze(values);
	return groups;
}

/**
 * Collect one value per key with required first/last/reject duplicate behavior.
 * Last replaces the value without moving the key's original insertion position.
 * A rejection returns no partial Map. No property-name or prototype coercion is
 * performed; Map key semantics apply. The returned Map belongs to the caller.
 */
export function index<Value, Key>(
	source: Iterable<Value>,
	key: (value: Value, index: number) => Key,
	options: RetentionOptionsType & Readonly<{ readonly duplicates: 'first' | 'last' | 'reject' }>,
): Map<Key, Value> {
	if (!['first', 'last', 'reject'].includes(options.duplicates)) {
		throw new TypeError('Invalid iterable duplicate policy.');
	}
	const values = new Map<Key, Value>();
	for (const [identity, value] of keyed(source, key, options)) {
		if (values.has(identity)) {
			if (options.duplicates === 'reject') throw new TypeError('Iterable contains a duplicate key.');
			if (options.duplicates === 'first') continue;
		} else if (values.size >= options.maximumKeys) throw new RangeError('Iterable exceeds maximumKeys.');
		values.set(identity, value);
	}
	return values;
}

/** Validate before opening the source and close it on a callback defect or item overflow. */
function* keyed<Value, Key>(
	source: Iterable<Value>,
	key: (value: Value, index: number) => Key,
	options: RetentionOptionsType,
): IterableIterator<readonly [Key, Value]> {
	limit(options.maximumItems, 'maximumItems');
	limit(options.maximumKeys, 'maximumKeys');
	let count = 0;
	for (const value of source) {
		if (count >= options.maximumItems) throw new RangeError('Iterable exceeds maximumItems.');
		yield [key(value, count++), value] as const;
	}
}

/** Counts are finite non-negative safe integers, not approximate allocation estimates. */
function limit(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Iterable ${name} must be a non-negative safe integer.`);
	}
}
