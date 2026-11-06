/** Callback failure observation shared by listener adapters. @module */
import type { ErrorReporter } from './types.ts';

/** Report an asynchronous failure through the host if the caller did not supply a reporter. */
export function report(error: unknown, reporter?: ErrorReporter): void {
	try {
		if (reporter) reporter(error);
		else {queueMicrotask(() => {
				throw error;
			});}
	} catch (secondary) {
		queueMicrotask(() => {
			throw new AggregateError([error, secondary], 'Input callback and error reporter failed.');
		});
	}
}

/** Invoke now; a returned Promise remains caller-owned but its rejection is observed. */
export function call<Value>(callback: (value: Value) => unknown, value: Value, reporter?: ErrorReporter): void {
	try {
		const result = callback(value);
		if (result !== null && (typeof result === 'object' || typeof result === 'function') && 'then' in result) {
			void Promise.resolve(result).catch((error: unknown) => report(error, reporter));
		}
	} catch (error) {
		if (reporter) report(error, reporter);
		else throw error;
	}
}
