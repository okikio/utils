/**
 * Control when local work may start and how claimed work is completed.
 *
 * A queue retains items and gives a consumer an attempt to complete. Capacity limits admission to scarce
 * resources. Execution utilities bound active work. Choose the part that owns the rule you need; an in-
 * memory queue does not become durable because its items are called jobs.
 *
 * @module
 */
export * as capacity from './capacity/mod.ts';
export * as queue from './queue/mod.ts';
export * as concurrency from './concurrency/mod.ts';
export { yieldTurn as yield } from './turn.ts';
