/**
 * Bound active asynchronous work while choosing whether consumers need input order or completion order. Promise.all starts every operation immediately and gives cancellation no ownership over admitted siblings.
 *
 * Start with ordered mapping for reports; use unordered mapping for results that can be consumed as soon as they finish. Pass cancellation into the actual fetch or provider call. Breaking iteration cancels admitted transforms and joins their settlement. A concurrency bound limits active work, not the size of a result array; fold or batch large outputs instead of materializing them all.
 *
 * @example
 * ```ts
 * import { mapPooledOrdered } from '@okikio/concurrency';
 * const values = mapPooledOrdered({
 *   items: ['first', 'second', 'third'], concurrency: 2,
 *   async map(value, { signal }) {
 *     signal.throwIfAborted();
 *     return value.toUpperCase();
 *   },
 * });
 * console.log(JSON.stringify(await Array.fromAsync(values)));
 * ```
 *
 * @module
 */
export * from '#/channel.ts';
export * from '#/bounded.ts';
