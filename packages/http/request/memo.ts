import * as recordCore from '@okikio/collection/record';
import { AsyncDisposableStack } from '@okikio/dispose';

const requestCaches = new WeakMap<object, Map<unknown, unknown>>();

/**
 * Share one pending load under an exact request object and key.
 *
 * Concurrent consumers receive the same resolved value. Rejected loads are
 * removed by default so a later call can retry; cacheRejected retains rejection.
 * The caller owns the request lifetime and must join its consumers before dispose().
 */
export async function memoize<Value>(
	request: object,
	key: unknown,
	load: () => Value | Promise<Value>,
	options: { readonly cacheRejected?: boolean } = {},
): Promise<Value> {
	recordCore.assert(options, 'memoize options');
	if (options.cacheRejected !== undefined && typeof options.cacheRejected !== 'boolean') {
		throw new TypeError('cacheRejected must be a boolean when provided.');
	}
	const cacheRejected = options.cacheRejected ?? false;
	let cache = requestCaches.get(request);
	if (!cache) {
		cache = new Map();
		requestCaches.set(request, cache);
	}
	if (cache.has(key)) return await cache.get(key) as Value;
	// Publish the promise before invoking user code, so a synchronous second
	// consumer can join the load rather than start a duplicate resource.
	const pending = Promise.resolve().then(load);
	cache.set(key, pending);
	try {
		const value = await pending;
		cache.set(key, value);
		return value;
	} catch (error) {
		if (!cacheRejected) cache.delete(key);
		throw error;
	}
}

/**
 * Remove cached entries without closing their values or waiting for loaders.
 * Use only when another owner is responsible for those removed resources.
 * This does not cancel an in-flight load.
 */
export function invalidate(request: object, key?: unknown): void {
	if (key === undefined) requestCaches.delete(request);
	else requestCaches.get(request)?.delete(key);
}

/**
 * Remove this cache and dispose each distinct resolved resource once.
 *
 * Entries are visited in reverse cache-entry order. Pending loads are awaited
 * as their entries are visited; this is not concurrent-load completion order.
 * Every disposer is attempted, and failures retain the shared disposal stack's
 * aggregation semantics. Join normal request consumers before calling this.
 */
export async function dispose(request: object): Promise<void> {
	const cache = requestCaches.get(request);
	requestCaches.delete(request);
	if (!cache) return;
	const values = new Set(cache.values());
	const disposed = new Set<object>();
	// Each deferred entry gets a cleanup attempt even if an earlier loader or
	// disposer rejects. Aliases to the same object must not close it twice.
	const owner = new AsyncDisposableStack();
	for (const value of values) {
		owner.defer(async () => {
			const resolved: unknown = await value;
			if (
				resolved === null || typeof resolved !== 'object' && typeof resolved !== 'function' || disposed.has(resolved)
			) return;
			disposed.add(resolved);
			const asyncDispose = (resolved as { [Symbol.asyncDispose]?: () => PromiseLike<void> })[Symbol.asyncDispose];
			if (asyncDispose !== undefined) await asyncDispose.call(resolved);
			else (resolved as { [Symbol.dispose]?: () => void })[Symbol.dispose]?.call(resolved);
		});
	}
	await owner.disposeAsync();
}
