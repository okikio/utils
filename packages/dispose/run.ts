/** Bounded cleanup around one operation while retaining every failure. @module */
import { SuppressedError } from './ponyfill.ts';

/**
 * Run work, then attempt cleanup callbacks in reverse registration order.
 * Each callback gets a finite wait budget. A timeout stops waiting, observes late
 * rejection and continues cleanup; it cannot force an uncooperative callback to
 * stop. SuppressedError retains the prior operation failure in .suppressed and
 * the next cleanup failure in .error, including when either is undefined.
 */
export async function run<Value>(
	work: () => Promise<Value>,
	cleanups: readonly (() => void | Promise<void>)[],
	timeoutMs = 5000,
): Promise<Value> {
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
		throw new RangeError('Cleanup deadline must be 1 through 60000 milliseconds.');
	}
	let value: Value | undefined;
	let failed = false;
	let failure: unknown;
	try {
		value = await work();
	} catch (error) {
		failed = true;
		failure = error;
	}
	for (const close of cleanups.toReversed()) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			// The race keeps observing late rejection after timeout; it cannot stop the cleanup itself.
			await Promise.race([
				Promise.resolve().then(close),
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => reject(new DOMException('Cleanup deadline exhausted.', 'TimeoutError')), timeoutMs);
				}),
			]);
		} catch (error) {
			failure = failed ? new SuppressedError(error, failure, 'Cleanup failed after an earlier failure.') : error;
			failed = true;
		} finally {
			clearTimeout(timer);
		}
	}
	if (failed) throw failure;
	return value as Value;
}
