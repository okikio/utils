/**
 * Use Temporal in an application without installing a global.
 *
 * This ponyfill exports the complete temporal-polyfill implementation. It
 * works when the runtime has no Temporal and keeps globalThis unchanged. Import
 * the explicit polyfill subpath instead when other libraries use global Temporal.
 *
 * @example
 * ```ts
 * import { Temporal } from '@okikio/duration/temporal';
 * const departure = Temporal.Instant.from('2026-01-01T12:00:00Z');
 * console.log(departure.add({ minutes: 15 }).toString());
 * ```
 * @module
 */
export { Temporal } from 'temporal-polyfill/full/implementation';
