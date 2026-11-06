/**
 * Persist Context snapshots in supplied Web Storage without reading browser globals.
 * The application chooses one writer or supplies Web Locks for cooperating writers.
 * @module
 */
import { SnapshotSchema } from '@okikio/context/state';
import type { OperationOptions, SaveOptions, SnapshotType, Store } from '@okikio/context/state';
import * as schema from '@okikio/schema';

/** Match the largest stored-cell value budget and allow escaped contract/version metadata around it. */
const MaximumTextCodeUnits = 16_777_216 + 4096;

/** The synchronous host operations this adapter borrows; native Storage and small mocks both satisfy them. */
export interface WebStorage {
	/** Return exact stored text, or null when the chosen key is absent. */
	getItem(key: string): string | null;
	/** Replace one text value synchronously, throwing when the host cannot accept it. */
	setItem(key: string, value: string): void;
}

/**
 * The Web Locks operation needed to coordinate this storage key.
 *
 * Native navigator.locks satisfies this structural interface. A supplied mock
 * must keep an exclusive lock until the callback settles and reject an aborted
 * waiting request without invoking its callback. It must not steal held locks.
 */
export interface Locks {
	/** Execute the callback under one exclusive resource name shared by all cooperating writers. */
	request<Value>(
		name: string,
		options: { readonly mode: 'exclusive'; readonly signal?: AbortSignal },
		callback: () => Value | PromiseLike<Value>,
	): Promise<Value>;
}

/**
 * Select the actual coordination guarantee instead of inferring one from Web Storage.
 *
 * single-writer requires external exclusion across tabs and other agents. In
 * locked mode every writer must use the same LockManager scope and lockName;
 * direct setItem calls and writers using different lock names bypass that
 * coordination. The default lock name is derived from key. Reopening saved state
 * requires the same borrowed storage area and exact key.
 */
export type Options =
	& {
		/** Borrowed native localStorage, sessionStorage, or a synchronous structural implementation. */
		readonly storage: WebStorage;
		/** One nonblank application-chosen key, from 1 through 512 Unicode code points. */
		readonly key: string;
	}
	& (
		| {
			/** The application guarantees that no two writers overlap. */
			readonly mode: 'single-writer';
		}
		| {
			/** Coordinate reads and replacements using the supplied Web Locks service. */
			readonly mode: 'locked';
			/**
			 * Borrowed lock service; acquisition is cancellable, while a granted synchronous callback runs to
			 * completion.
			 */
			readonly locks: Locks;
			/** Shared resource name. Defaults to @okikio/context/state/ followed by the storage key. */
			readonly lockName?: string;
		}
	);

/**
 * Construct one browser storage slot without loading data or installing listeners.
 *
 * localStorage can retain a value across page restart, while sessionStorage
 * follows the browser session's storage scope. Neither guarantees retention
 * against user deletion, browser eviction, or device failure. Host quota and
 * access errors propagate. Storage events are hints in other documents; this
 * adapter does not pretend they are committed local state. Call cell.reload()
 * when the application chooses to observe a change from another writer.
 *
 * @example
 * ```ts
 * import * as web from '@okikio/storage/state/web';
 * const store = web.open({ storage: localStorage, key: 'draft', mode: 'locked', locks: navigator.locks });
 * ```
 */
export function open(options: Options): Store {
	const storage = options.storage;
	const key = text(options.key, 'Storage key', 512);
	if (options.mode !== 'single-writer' && options.mode !== 'locked') {
		throw new TypeError('Choose an explicit Web Storage writer mode.');
	}
	const locks = options.mode === 'locked' ? options.locks : undefined;
	if (options.mode === 'locked' && (locks === undefined || locks === null || typeof locks.request !== 'function')) {
		throw new TypeError('Locked Web Storage requires a supplied lock service.');
	}
	const lockName = options.mode === 'locked'
		? text(options.lockName ?? '@okikio/context/state/' + key, 'Lock name', 1024)
		: '';
	if (lockName.startsWith('-')) throw new TypeError('Web Locks names must not start with a hyphen.');

	/**
	 * Hold the chosen lock from reading the current version through writing its replacement.
	 * Without that shared lock, two tabs could both read version A and overwrite each other.
	 * The action stays synchronous: an await between checking and setItem would split this rule.
	 * Single-writer mode instead relies on the application's promise to exclude other writers.
	 */
	async function access<Value>(action: () => Value, signal: AbortSignal | undefined): Promise<Value> {
		signal?.throwIfAborted();
		if (locks === undefined) return action();
		return await locks.request(lockName, { mode: 'exclusive', ...(signal === undefined ? {} : { signal }) }, () => {
			signal?.throwIfAborted();
			return action();
		});
	}

	/** Bound the serialized input before parsing and reject malformed or future envelopes. */
	function load(): SnapshotType | undefined {
		const encoded = storage.getItem(key);
		if (encoded === null) return undefined;
		if (typeof encoded !== 'string') throw new TypeError('Web Storage getItem must return text or null synchronously.');
		checkText(encoded);
		return SnapshotSchema.parse(JSON.parse(encoded));
	}

	return Object.freeze(
		{
			concurrency: locks === undefined ? 'single-writer' : 'atomic',
			load(options: OperationOptions = {}): Promise<SnapshotType | undefined> {
				return access(load, options.signal);
			},
			/**
			 * Check and replace within the selected single-writer or Web Locks scope. The caller must respond
			 * to a false version match rather than overwrite another owner.
			 */
			async save(input: SnapshotType, options: SaveOptions): Promise<boolean> {
				const { expectedVersion, signal } = options;
				signal?.throwIfAborted();
				const snapshot = SnapshotSchema.parse(input);
				if (snapshot.version === expectedVersion) {
					throw new TypeError('A state replacement requires a fresh version.');
				}
				const encoded = JSON.stringify(snapshot);
				checkText(encoded);
				return await access(() => {
					// A changed version means another save won. Let the caller reload
					// rather than silently replacing a value it has never seen.
					if (load()?.version !== expectedVersion) return false;
					const result: unknown = storage.setItem(key, encoded);
					if (thenable(result)) {
						// An asynchronous mock can already have started a write. Reject its unsupported
						// protocol and observe its rejection without announcing a successful save.
						void Promise.resolve(result).catch(() => undefined);
						throw new TypeError('Web Storage setItem must complete synchronously.');
					}
					return true;
				}, signal);
			},
		} satisfies Store,
	);
}

/** Apply the same serialized bound before writing and reading, so every acknowledged value can be reopened. */
function checkText(encoded: string): void {
	if (encoded.length > MaximumTextCodeUnits) {
		throw new RangeError('Stored snapshot text exceeds 16 MiB plus 4 KiB of envelope metadata in UTF-16 code units.');
	}
}

/** Empty or oversized identity text should fail before a host lock or storage call is attempted. */
function text(value: string, name: string, maximum: number): string {
	try {
		return schema.string({ minLength: 1, maxLength: maximum, pattern: /\S/u }).parse(value);
	} catch (cause) {
		throw new TypeError(`${name} must contain 1 through ${maximum} Unicode code points and not be blank.`, { cause });
	}
}

/** Native Web Storage is synchronous; a Promise from a structural mock cannot acknowledge persistence. */
function thenable(value: unknown): value is PromiseLike<unknown> {
	return (typeof value === 'object' && value !== null || typeof value === 'function') &&
		typeof (value as { readonly then?: unknown }).then === 'function';
}
