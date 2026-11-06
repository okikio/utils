/**
 * Store one Context snapshot with an explicitly selected persistence owner.
 *
 * memory() is a shared process-local slot. Use the web or postgres subpath for
 * those hosts; this entrypoint neither imports a database driver nor discovers
 * browser globals. The contract comes from Context, which consumes it, rather
 * than introducing another general-purpose storage abstraction.
 * @module
 */
import { SnapshotSchema } from '@okikio/context/state';
import type { OperationOptions, SaveOptions, SnapshotType, Store } from '@okikio/context/state';

/**
 * Keep one encoded snapshot for repeated cell lifetimes in the same process.
 *
 * Reuse this object when opening several cells or reopening a disposed cell.
 * The version check and replacement run in one synchronous turn, so exactly
 * one competing writer using this slot can accept a given expected version.
 * A newly constructed memory store is empty; process restart loses its value.
 *
 * Loads return detached JSON snapshots. Saves capture a detached input and
 * return true after replacement or false on a version conflict. Disposing a cell
 * leaves the slot usable, and dropping the store releases its single retained snapshot.
 * No history, listener, timer, global registry, or external client is acquired.
 *
 * @example
 * ```ts
 * import * as stores from '@okikio/storage/state';
 * const slot = stores.memory();
 * console.log(await slot.load()); // undefined
 * ```
 */
export function memory(): Store {
	let current: SnapshotType | undefined;
	return Object.freeze(
		{
			concurrency: 'atomic',
			async load(options: OperationOptions = {}): Promise<SnapshotType | undefined> {
				options.signal?.throwIfAborted();
				return current === undefined ? undefined : SnapshotSchema.parse(current);
			},
			async save(input: SnapshotType, options: SaveOptions): Promise<boolean> {
				const { expectedVersion, signal } = options;
				signal?.throwIfAborted();
				const snapshot = SnapshotSchema.parse(input);
				if (snapshot.version === expectedVersion) {
					throw new TypeError(
						'A state replacement requires a fresh version.',
					);
				}
				if (current?.version !== expectedVersion) return false;
				current = snapshot;
				return true;
			},
		} satisfies Store,
	);
}

export { SnapshotSchema } from '@okikio/context/state';
export type { OperationOptions, SaveOptions, SnapshotType, Store } from '@okikio/context/state';
