/**
 * Dispose owned values in a predictable order while preserving both the operation failure and any cleanup failure. Hand-written finally blocks often skip later cleanup when one callback throws.
 *
 * Import the local constructors for library-owned lifetimes without changing globals. Use language-level using and await using when the engine supports the standard protocol. Import @okikio/dispose/polyfill explicitly if an application chooses global compatibility. Cleanup runs in reverse registration order even after failure, including thrown undefined. Register only owned resources.
 *
 * @example
 * ```ts
 * import { AsyncDisposableStack } from '@okikio/dispose';
 * const closed: string[] = [];
 * const stack = new AsyncDisposableStack();
 * stack.defer(() => { closed.push('connection'); });
 * stack.defer(() => { closed.push('temporary file'); });
 * await stack.disposeAsync();
 * console.log(closed.join(', '));
 * ```
 *
 * @module
 */
export { AsyncDisposableStack, asyncDispose, DisposableStack, dispose, SuppressedError } from './ponyfill.ts';
