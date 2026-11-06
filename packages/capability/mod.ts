/**
 * Give an operation explicit access to the resources and rules it needs.
 *
 * A resource supplies a value such as a storage client. A requirement checks a condition before work
 * proceeds. An effect reports a declared occurrence to an accepting receiver. Execution policies control
 * how local work runs.
 *
 * These parts share a context so cancellation and cleanup have a visible owner. Select the focused
 * resource, requirement, effect, or execution subpath when only that part is needed.
 *
 * @module
 */
export * as resource from './resource/mod.ts';
export * as requirement from './requirement/mod.ts';
export * as effect from './effect/mod.ts';
export * as resilience from './resilience/mod.ts';
export { scope } from './execution.ts';
export type { ExecutionContext, Scope, ScopeOptions } from './execution.ts';
export { attempt } from './resilience/attempt.ts';
export type { Attempt, AttemptOptions, RetryNotice } from './resilience/attempt.ts';
