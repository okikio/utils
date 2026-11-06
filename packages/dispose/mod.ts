/**
 * Release owned resources in reverse registration order, even when cleanup fails. For example, remove a
 * temporary file before closing the connection acquired before it.
 *
 * Import the local stack constructors to avoid changing globals. Use using or await using to release a
 * stack when its scope exits. Applications can explicitly import the polyfill when they need global
 * constructors.
 *
 * Register cleanup as soon as a resource is acquired. A stack continues after a cleanup error and
 * preserves the failures. It does not decide when business data commits.
 *
 * @example
 * ```ts
 * import { AsyncDisposableStack } from '@okikio/dispose';
 * const closed: string[] = [];
 * const stack = new AsyncDisposableStack();
 * stack.defer(() => {
 * 	closed.push('connection');
 * });
 * stack.defer(() => {
 * 	closed.push('temporary file');
 * });
 * await stack.disposeAsync();
 * console.log(closed.join(', '));
 * ```
 *
 * @module
 */
export { AsyncDisposableStack, asyncDispose, DisposableStack, dispose, SuppressedError } from './ponyfill.ts';

export { run } from './run.ts';
export { once } from './once.ts';
export type { JoinedDisposer } from './once.ts';
