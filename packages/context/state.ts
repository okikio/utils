/**
 * Read and observe values while keeping mutation with one explicit owner.
 *
 * create() makes a synchronous process-local cell. open() loads a named stored
 * snapshot and returns an asynchronous owner whose writes publish only after
 * storage confirms them. Both expose the same read-only Reader, so consumers
 * can borrow state without receiving write, storage, or disposal authority.
 *
 * A Context can carry either reader through view(); it does not discover the
 * store or own it implicitly. Register the cell with the lifetime that created
 * it. Store adapters live in @okikio/storage/state and are borrowed by open().
 * @module
 */
export { create } from './state/cell.ts';
export type { Cell, Change, Options, Reader, SubscribeOptions, Subscription } from './state/cell.ts';
export { migration, open } from './state/persistent.ts';
export type { Migration, OpenOptions, StoredCell } from './state/persistent.ts';
export { CommitError, ConflictError, ReloadRequiredError, SnapshotSchema } from './state/store.ts';
export type { OperationOptions, SaveOptions, SnapshotType, Store } from './state/store.ts';

export { combine, select } from './state/projection.ts';
export type { Projection } from './state/projection.ts';
