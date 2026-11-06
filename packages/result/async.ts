/** Compose asynchronous success branches without converting defects into expected failures. @module */
import { ok } from './mod.ts';
import type { Result } from './mod.ts';

/**
 * Await one success transformation. A failure skips the callback and keeps its
 * exact wrapper. Throws and rejections propagate, including rejected undefined;
 * use captureAsync explicitly when rejection should become result data.
 * No tasks, retries, cancellation owners or concurrency are created.
 */
export async function map<Value, Reason, Next>(
	value: Result<Value, Reason>,
	transform: (value: Value) => Next | PromiseLike<Next>,
): Promise<Result<Awaited<Next>, Reason>> {
	return value.ok ? ok(await transform(value.value)) : value;
}

/** Await a result-producing success callback, preserving both declared failure types and returned wrapper identity. */
export async function flatMap<Value, Reason, Next, NextReason>(
	value: Result<Value, Reason>,
	transform: (value: Value) => Result<Next, NextReason> | PromiseLike<Result<Next, NextReason>>,
): Promise<Result<Next, Reason | NextReason>> {
	return value.ok ? await transform(value.value) : value;
}
