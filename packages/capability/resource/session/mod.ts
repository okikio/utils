/**
 * Reuse a live object on the thread or process that created it.
 *
 * Callers pass a serializable reference, not the object. A host must route that
 * reference back to its owner before calling Owner.use(). The registry grants
 * time-limited permission (a lease); each use obtains a temporary borrow claim.
 * Cleanup finishes before that claim is released, so the next exclusive borrower
 * cannot use an object whose previous operation is still closing.
 *
 * This module does not open a network transport or move objects between hosts.
 * See docs/workflows/18-sessions.md for the cross-host flow and runnable example.
 * @module
 */
export * from './schema.ts';
export { memory, Registry, registry, SessionError } from './store.ts';
export type { Change, Store } from './store.ts';
export { Owner, owner } from './owner.ts';
export type { Borrow, Options, Resource } from './owner.ts';
