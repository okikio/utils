/**
 * Keep one canonical set of imported definitions and select subsets without losing exact object identity. A map keyed only by strings can silently replace a permission or response with a different same-ID definition.
 *
 * Use a named catalog for public contracts, select a deployment subset, then compose compatible catalogs. get() resolves a stable ID while has() checks the exact imported object. Different objects with the same ID cause a conflict. The immutable catalog does not own a runtime connection or globally register its definitions.
 *
 * @example
 * ```ts
 * import * as catalog from '@okikio/collection/catalog';
 * const Read = Object.freeze({ id: 'asset.read', kind: 'permission' });
 * const Write = Object.freeze({ id: 'asset.write', kind: 'permission' });
 * const Assets = catalog.create('assets', { Read, Write });
 * const ReadOnly = catalog.select(Assets, ['Read']);
 * console.log(catalog.get(ReadOnly, 'asset.read') === Read);
 * console.log(catalog.has(ReadOnly, Write));
 * console.log(JSON.stringify(catalog.ids(ReadOnly)));
 * ```
 *
 * @module
 */

import * as record from '@okikio/collection/record';
import type {
	Catalog,
	CatalogDocument,
	CatalogEntryDocument,
	CatalogEntryIdentity,
	CatalogIds,
	CatalogLike,
	CatalogMetadata,
	CatalogSelection,
	CatalogSelectionMetadata,
	CatalogValidationIssue,
	CatalogValidationResult,
	DefinitionInput,
} from './types.ts';

const catalogMetadata = new WeakMap<object, CatalogMetadata>();
const selectionMetadata = new WeakMap<object, CatalogSelectionMetadata>();

/** Error raised when different definitions reuse one stable catalog identifier. */
export class CatalogConflictError extends Error {
	/** Stable identity used to correlate this contract or occurrence. */
	readonly id: string;
	/** First operand or observation retained in this ordered pair. */
	readonly first: CatalogEntryIdentity;
	/** Second operand or observation retained in this ordered pair. */
	readonly second: CatalogEntryIdentity;

	/** Retain both conflicting objects so a caller can identify the two sources of one reused ID. */
	constructor(id: string, first: CatalogEntryIdentity, second: CatalogEntryIdentity) {
		super(`Catalog identifier ${JSON.stringify(id)} is owned by different definition objects.`);
		this.name = 'CatalogConflictError';
		this.id = id;
		this.first = first;
		this.second = second;
	}
}

/** Error raised when a selection references a key that does not exist. */
export class CatalogSelectionError extends Error {
	/** Catalog namespace that groups these exact entries. */
	readonly namespace: string;
	/** Stable lookup or correlation key within the owning contract. */
	readonly key: PropertyKey;

	/** Identify the missing authored key and the catalog label used by the caller. */
	constructor(namespace: string, key: PropertyKey) {
		super(`Catalog ${JSON.stringify(namespace)} does not contain key ${String(key)}.`);
		this.name = 'CatalogSelectionError';
		this.namespace = namespace;
		this.key = key;
	}
}

/**
 * Create an immutable record-shaped catalog for a domain namespace.
 *
 * Domain packages normally wrap this helper behind APIs such as
 * `problem.catalog()` or `resource.catalog()`.
 */
export function create<
	const Namespace extends string,
	const Entries extends Readonly<Record<PropertyKey, CatalogEntryIdentity>>,
>(namespace: Namespace, entries: Entries): Catalog<Entries[keyof Entries], Entries> {
	assertNamespace(namespace);
	record.assert(entries, 'catalog entries');

	const target = Object.create(null) as Record<PropertyKey, CatalogEntryIdentity>;
	const keys = Object.keys(entries);
	const orderedEntries: CatalogEntryIdentity[] = [];
	const keyByEntry = new Map<CatalogEntryIdentity, string>();
	const idOwners = new Map<string, CatalogEntryIdentity>();

	for (const key of keys) {
		if (typeof key !== 'string') {
			throw new TypeError('Catalog entry keys must be strings.');
		}

		const entry = entries[key];
		assertEntry(entry, key);
		assertIdOwnership(idOwners, entry);
		const previousKey = keyByEntry.get(entry);
		if (previousKey !== undefined) {
			throw new TypeError(
				`Catalog ${JSON.stringify(namespace)} assigns definition ${JSON.stringify(entry.id)} to both ${
					JSON.stringify(previousKey)
				} and ${JSON.stringify(key)}.`,
			);
		}
		defineEntry(target, key, entry);
		orderedEntries.push(entry);
		keyByEntry.set(entry, key);
	}

	const metadata: CatalogMetadata = Object.freeze({
		type: 'catalog',
		namespace,
		keys: Object.freeze(keys as string[]),
		entries: Object.freeze(orderedEntries),
		keyByEntry: immutableMap(keyByEntry),
		entryById: immutableMap(idOwners),
	});

	catalogMetadata.set(target, metadata);
	return Object.freeze(target) as Catalog<Entries[keyof Entries], Entries>;
}

/** Return whether a value is a catalog or catalog selection. */
export function is(value: unknown): value is CatalogLike {
	return isRoot(value) || isSelection(value);
}

/** Return whether a value is a named source catalog. */
export function isRoot(value: unknown): value is Catalog {
	return typeof value === 'object' && value !== null && catalogMetadata.has(value);
}

/** Return whether a value is a catalog selection. */
export function isSelection(value: unknown): value is CatalogSelection {
	return typeof value === 'object' && value !== null && selectionMetadata.has(value);
}

/** Return hidden metadata for a named source catalog. */
export function metadata<Entry extends CatalogEntryIdentity>(value: Catalog<Entry>): CatalogMetadata<Entry>;
/** Return hidden metadata for a catalog selection. */
export function metadata<Entry extends CatalogEntryIdentity>(
	value: CatalogSelection<Entry>,
): CatalogSelectionMetadata<Entry>;
/** Return hidden metadata when the precise catalog kind is not statically known. */
export function metadata<Entry extends CatalogEntryIdentity>(
	value: CatalogLike<Entry>,
): CatalogMetadata<Entry> | CatalogSelectionMetadata<Entry>;
/** Read hidden metadata after runtime narrowing of a catalog or selection. */
export function metadata(value: CatalogLike): CatalogMetadata | CatalogSelectionMetadata {
	if (isRoot(value)) return getCatalogMetadata(value);
	if (isSelection(value)) return getSelectionMetadata(value);
	throw new TypeError('Value is not a catalog or catalog selection.');
}

/**
 * Flatten direct values, nested arrays, catalogs, and selections.
 *
 * The exact same object is deduplicated. Different objects sharing an ID are
 * rejected because stable IDs represent identity rather than semantic equality.
 */
export function values<Entry extends CatalogEntryIdentity>(
	input: DefinitionInput<Entry>,
): readonly Entry[] {
	const result: Entry[] = [];
	const seenObjects = new Set<Entry>();
	const idOwners = new Map<string, Entry>();

	visit(input, (entry) => {
		assertEntry(entry);
		const owner = idOwners.get(entry.id);
		if (owner && owner !== entry) throw new CatalogConflictError(entry.id, owner, entry);
		idOwners.set(entry.id, entry);
		if (seenObjects.has(entry)) return;
		seenObjects.add(entry);
		result.push(entry);
	});

	return Object.freeze(result);
}

/** Return whether one exact definition object belongs to a catalog or selection. */
export function has<Entry extends CatalogEntryIdentity>(source: CatalogLike<Entry>, entry: unknown): entry is Entry {
	return typeof entry === 'object' && entry !== null && metadata(source).keyByEntry.has(entry as Entry);
}

/** Resolve one stable identifier back to its exact trusted definition object. */
export function get<Entry extends CatalogEntryIdentity>(
	input: DefinitionInput<Entry>,
	id: string,
): Entry | undefined {
	if (isRoot(input) || isSelection(input)) return metadata(input).entryById.get(id) as Entry | undefined;
	return values(input).find((entry) => entry.id === id);
}

/** Project stable definition identifiers while preserving the source catalog keys. */
export function ids<
	const Entries extends Readonly<Record<PropertyKey, CatalogEntryIdentity>>,
>(source: Catalog<Entries[keyof Entries], Entries>): CatalogIds<Entries>;
/** Project stable definition identifiers from a key-preserving catalog selection. */
export function ids<
	Entry extends CatalogEntryIdentity,
	const Entries extends Readonly<Record<PropertyKey, Entry>>,
>(source: CatalogSelection<Entry, Entries>): CatalogIds<Entries>;
/** Build the immutable identifier projection after catalog-kind narrowing. */
export function ids(source: CatalogLike): Readonly<Record<string, string>> {
	const sourceMetadata = metadata(source);
	const values = source as unknown as Readonly<Record<string, CatalogEntryIdentity>>;
	const output: Record<string, string> = {};
	for (const key of sourceMetadata.keys) {
		Object.defineProperty(output, key, {
			configurable: false,
			enumerable: true,
			writable: false,
			value: values[key]!.id,
		});
	}
	return Object.freeze(output);
}

/**
 * Select a key-preserving subset from a catalog or an existing selection.
 *
 * A second selection can only narrow the current set. It keeps exact definition
 * identities and the original source catalog for provenance, without granting
 * access to a key omitted by the first selection.
 */
export function select<
	const Entries extends Readonly<Record<PropertyKey, CatalogEntryIdentity>>,
	const Keys extends readonly (keyof Entries & string)[],
>(
	source: Catalog<Entries[keyof Entries], Entries> | CatalogSelection<Entries[keyof Entries], Entries>,
	keys: Keys,
): CatalogSelection<Entries[Keys[number]], Pick<Entries, Keys[number]>> {
	type Entry = Entries[Keys[number]];
	const sourceMetadata = metadata(source);
	const original = isRoot(source) ? source : getSelectionMetadata(source).source;
	const target = Object.create(null) as Record<PropertyKey, Entry>;
	const selectedEntries: Entry[] = [];
	const keyByEntry = new Map<Entry, string>();
	const entryById = new Map<string, Entry>();
	const seenKeys = new Set<string>();

	for (const key of keys) {
		if (seenKeys.has(key)) continue;
		seenKeys.add(key);

		if (!Object.hasOwn(source, key)) throw new CatalogSelectionError(sourceMetadata.namespace, key);
		const entry = source[key];
		defineEntry(target, key, entry);
		selectedEntries.push(entry);
		keyByEntry.set(entry, key);
		entryById.set(entry.id, entry);
	}

	const selectedKeys = Object.freeze([...seenKeys]);
	const selectedMetadata: CatalogSelectionMetadata<Entry> = Object.freeze({
		type: 'selection',
		namespace: sourceMetadata.namespace,
		source: original,
		keys: selectedKeys,
		entries: Object.freeze(selectedEntries),
		keyByEntry: immutableMap(keyByEntry),
		entryById: immutableMap(entryById),
	});

	selectionMetadata.set(target, selectedMetadata);
	return Object.freeze(target) as CatalogSelection<Entries[Keys[number]], Pick<Entries, Keys[number]>>;
}

/** Compose definition inputs into a deterministic immutable entry list. */
export function compose<Entry extends CatalogEntryIdentity>(
	...inputs: readonly DefinitionInput<Entry>[]
): readonly Entry[] {
	return values(inputs);
}

/** Validate a definition input without throwing. */
export function validate(input: unknown): CatalogValidationResult {
	const issues: CatalogValidationIssue[] = [];
	const entries: CatalogEntryIdentity[] = [];
	const seenObjects = new Set<CatalogEntryIdentity>();
	const idOwners = new Map<string, CatalogEntryIdentity>();

	try {
		visitUnknown(input, (entry) => {
			if (!isEntry(entry)) {
				issues.push({ code: 'invalid-entry', message: 'Catalog input contains a value without string id and kind.' });
				return;
			}
			if (entry.id.length === 0) issues.push({ code: 'empty-id', message: 'Catalog entry id cannot be empty.' });
			if (entry.kind.length === 0) {
				issues.push({ code: 'empty-kind', message: 'Catalog entry kind cannot be empty.', id: entry.id });
			}
			const owner = idOwners.get(entry.id);
			if (owner && owner !== entry) {
				issues.push({
					code: 'duplicate-id',
					message: `Catalog identifier ${JSON.stringify(entry.id)} is owned by different objects.`,
					id: entry.id,
					first: owner,
					second: entry,
				});
			}
			idOwners.set(entry.id, entry);
			if (!seenObjects.has(entry)) {
				seenObjects.add(entry);
				entries.push(entry);
			}
		});
	} catch (error) {
		issues.push({
			code: 'invalid-entry',
			message: 'Catalog input could not be inspected as declared entries.',
			cause: error,
		});
	}

	return issues.length === 0
		? { valid: true, entries: Object.freeze(entries) }
		: { valid: false, issues: Object.freeze(issues) };
}

/** Create a JSON-safe deterministic projection for documentation and manifests. */
export function document(input: DefinitionInput<CatalogEntryIdentity>): CatalogDocument {
	if (isRoot(input)) return documentCatalog(getCatalogMetadata(input));
	if (isSelection(input)) return documentSelection(getSelectionMetadata(input));
	return Object.freeze({
		type: 'composition',
		entries: Object.freeze(values(input).map((entry, index) => documentEntry(String(index), entry))),
	});
}

/**
 * Expose read-only lookup and iteration without leaking a mutable Map.
 * Freezing a native Map does not prevent set/delete; this facade copies the map
 * and exposes only ReadonlyMap operations. Definition values remain borrowed.
 *
 * @internal
 */
class ImmutableMap<Key, Value> implements ReadonlyMap<Key, Value> {
	readonly #source: ReadonlyMap<Key, Value>;

	constructor(source: ReadonlyMap<Key, Value>) {
		this.#source = new Map(source);
		Object.freeze(this);
	}

	get size(): number {
		return this.#source.size;
	}

	/**
	 * Look up a key without copying its borrowed value.
	 *
	 * @internal
	 */
	get(key: Key): Value | undefined {
		return this.#source.get(key);
	}

	/**
	 * Check membership without exposing the backing map.
	 *
	 * @internal
	 */
	has(key: Key): boolean {
		return this.#source.has(key);
	}

	/**
	 * Visits catalog entries in deterministic insertion order so derived artifacts remain stable.
	 *
	 * @internal
	 */
	forEach(callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void, thisArgument?: unknown): void {
		for (const [key, value] of this.#source) callback.call(thisArgument, value, key, this);
	}

	/**
	 * Iterate key/value pairs in the source map's insertion order.
	 *
	 * @internal
	 */
	entries(): MapIterator<[Key, Value]> {
		return this.#source.entries();
	}

	/**
	 * Iterate keys in the source map's insertion order.
	 *
	 * @internal
	 */
	keys(): MapIterator<Key> {
		return this.#source.keys();
	}

	/**
	 * Returns definition values in deterministic insertion order.
	 *
	 * @internal
	 */
	values(): MapIterator<Value> {
		return this.#source.values();
	}

	/**
	 * Returns the native iterator view used by synchronous iteration protocols.
	 *
	 * @internal
	 */
	[Symbol.iterator](): MapIterator<[Key, Value]> {
		return this.entries();
	}
}

/**
 * Copy a map into a facade whose runtime API offers no mutation methods.
 *
 * @internal
 */
function immutableMap<Key, Value>(source: ReadonlyMap<Key, Value>): ReadonlyMap<Key, Value> {
	return new ImmutableMap(source);
}

/**
 * Describe source entries in authored order, retaining their catalog namespace.
 *
 * @internal
 */
function documentCatalog(metadata: CatalogMetadata): CatalogDocument {
	return Object.freeze({
		type: 'catalog',
		namespace: metadata.namespace,
		entries: Object.freeze(metadata.entries.map((entry) => documentEntry(metadata.keyByEntry.get(entry)!, entry))),
	});
}

/**
 * Describe only the selected entries; omitted source keys remain omitted.
 *
 * @internal
 */
function documentSelection(metadata: CatalogSelectionMetadata): CatalogDocument {
	return Object.freeze({
		type: 'selection',
		namespace: metadata.namespace,
		entries: Object.freeze(metadata.entries.map((entry) => documentEntry(metadata.keyByEntry.get(entry)!, entry))),
	});
}

/**
 * Project the authored key and public identity fields without serializing the runtime definition.
 *
 * @internal
 */
function documentEntry(key: string, entry: CatalogEntryIdentity): CatalogEntryDocument {
	return Object.freeze({
		key,
		id: entry.id,
		kind: entry.kind,
		...(entry.description !== undefined ? { description: entry.description } : {}),
	});
}

/**
 * Validate each flattened candidate before passing its trusted identity to the consumer.
 *
 * @internal
 */
function visit<Entry extends CatalogEntryIdentity>(
	input: DefinitionInput<Entry>,
	accept: (entry: Entry) => void,
): void {
	visitUnknown(input, (entry) => {
		assertEntry(entry);
		accept(entry as Entry);
	});
}

/**
 * Flatten arrays with an explicit stack to avoid recursion depth limits.
 * Exit frames remove an array from the current ancestry after its children are
 * visited. This rejects cycles while allowing the same array in separate branches.
 * Reverse pushes preserve the caller's left-to-right order; holes and accessors reject.
 *
 * @internal
 */
function visitUnknown(input: unknown, accept: (entry: unknown) => void): void {
	const pending: Array<{ value: unknown; exit?: boolean }> = [{ value: input }];
	const ancestors = new WeakSet<object>();
	while (pending.length > 0) {
		const frame = pending.pop()!;
		const current = frame.value;
		if (Array.isArray(current)) {
			if (frame.exit) {
				ancestors.delete(current);
				continue;
			}
			if (ancestors.has(current)) throw new TypeError('Catalog composition cannot contain a cyclic array.');
			ancestors.add(current);
			pending.push({ value: current, exit: true });
			for (let index = current.length - 1; index >= 0; index--) {
				const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
				if (descriptor === undefined || !('value' in descriptor)) {
					throw new TypeError('Catalog composition arrays require own data entries without holes.');
				}
				pending.push({ value: descriptor.value });
			}
			continue;
		}
		if (isRoot(current)) {
			for (const entry of getCatalogMetadata(current).entries) accept(entry);
			continue;
		}
		if (isSelection(current)) {
			for (const entry of getSelectionMetadata(current).entries) accept(entry);
			continue;
		}
		accept(current);
	}
}

/**
 * Publish an enumerable definition key that cannot be reassigned or deleted.
 *
 * @internal
 */
function defineEntry(
	target: Record<PropertyKey, CatalogEntryIdentity>,
	key: string,
	entry: CatalogEntryIdentity,
): void {
	Object.defineProperty(target, key, {
		value: entry,
		enumerable: true,
		writable: false,
		configurable: false,
	});
}

/**
 * Require a non-empty catalog label for lookup and selection diagnostics.
 *
 * @internal
 */
function assertNamespace(namespace: string): void {
	if (namespace.trim().length === 0) throw new TypeError('Catalog namespace cannot be empty.');
}

/**
 * Read only own data fields and require the identity fields used by catalog indexes.
 *
 * @internal
 */
function assertEntry(value: unknown, key?: string): asserts value is CatalogEntryIdentity {
	if (!isEntry(value)) {
		throw new TypeError(
			`${key ? `Catalog entry ${JSON.stringify(key)}` : 'Catalog entry'} must have string id and kind.`,
		);
	}
	if (value.id.length === 0) throw new TypeError('Catalog entry id cannot be empty.');
	if (value.kind.length === 0) throw new TypeError(`Catalog entry ${JSON.stringify(value.id)} kind cannot be empty.`);
}

/**
 * Classify identity from own data descriptors without invoking id/kind getters.
 *
 * @internal
 */
function isEntry(value: unknown): value is CatalogEntryIdentity {
	if (typeof value !== 'object' || value === null) return false;
	const id = Object.getOwnPropertyDescriptor(value, 'id');
	const kind = Object.getOwnPropertyDescriptor(value, 'kind');
	return id !== undefined && 'value' in id && typeof id.value === 'string' &&
		kind !== undefined && 'value' in kind && typeof kind.value === 'string';
}

/**
 * Keep one exact imported object as the owner of each stable ID.
 *
 * @internal
 */
function assertIdOwnership(
	owners: Map<string, CatalogEntryIdentity>,
	entry: CatalogEntryIdentity,
): void {
	const owner = owners.get(entry.id);
	if (owner && owner !== entry) throw new CatalogConflictError(entry.id, owner, entry);
	owners.set(entry.id, entry);
}

/**
 * Read metadata registered by this module instance; foreign lookalikes are not catalogs.
 *
 * @internal
 */
function getCatalogMetadata<Entry extends CatalogEntryIdentity>(value: Catalog<Entry>): CatalogMetadata<Entry> {
	const metadata = catalogMetadata.get(value);
	if (metadata === undefined) throw new TypeError('Value is not a catalog.');
	return metadata as CatalogMetadata<Entry>;
}

/**
 * Read the registered subset metadata rather than trusting public record fields.
 *
 * @internal
 */
function getSelectionMetadata<Entry extends CatalogEntryIdentity>(
	value: CatalogSelection<Entry>,
): CatalogSelectionMetadata<Entry> {
	const metadata = selectionMetadata.get(value);
	if (metadata === undefined) throw new TypeError('Value is not a catalog selection.');
	return metadata as CatalogSelectionMetadata<Entry>;
}

export type {
	Catalog,
	CatalogDocument,
	CatalogEntryDocument,
	CatalogEntryIdentity,
	CatalogEntryValue,
	CatalogIds,
	CatalogLike,
	CatalogMetadata,
	CatalogSelection,
	CatalogSelectionMetadata,
	CatalogValidationIssue,
	CatalogValidationResult,
	DefinitionEntry,
	DefinitionInput,
	ValuedCatalogEntry,
} from './types.ts';
