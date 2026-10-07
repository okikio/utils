/** LogTape-compatible adapter for portable telemetry records without owning logger configuration or dependency installation. @module */
import type { Event, Fields, Reporter } from './types.ts';

/** Minimal LogTape logger surface consumed by the telemetry reporter adapter. */
export interface LogTapeLogger {
	/** Emit one trace-level record through the supplied LogTape logger. */
	trace(message: string, properties?: Readonly<Record<string, unknown>>): void;
	/** Emit one debug-level event through the supplied LogTape logger. */
	debug(message: string, properties?: Readonly<Record<string, unknown>>): void;
	/** Emit one info-level record through the supplied LogTape logger. */
	info(message: string, properties?: Readonly<Record<string, unknown>>): void;
	/** Emit one warning-level event through the supplied LogTape logger. */
	warn(message: string, properties?: Readonly<Record<string, unknown>>): void;
	/** Emit one error-level record through the supplied LogTape logger. */
	error(message: string, properties?: Readonly<Record<string, unknown>>): void;
	/** Emit one fatal-level event through the supplied LogTape logger. */
	fatal(message: string, properties?: Readonly<Record<string, unknown>>): void;
}

/** Minimal LogTape context bridge supplied by a host that enabled implicit context propagation. */
export interface LogTapeContextApi {
	/** Run this callback under the caller-supplied LogTape correlation context. */
	withContext<Result>(properties: Readonly<Record<string, unknown>>, callback: () => Result): Result;
}

/** Adapt an already-configured LogTape-compatible logger to the telemetry Reporter contract. */
export function reporter(logger: LogTapeLogger): Reporter {
	assertLogger(logger);
	return Object.freeze({
		report(value: Event): void {
			const properties: Record<string, unknown> = {
				event: value.name,
				telemetry_at: value.at,
				...value.fields,
				...(value.fault === undefined ? {} : { fault: value.fault }),
				...(value.error === undefined ? {} : { error: value.error }),
			};
			switch (value.level) {
				case 'trace':
					logger.trace(value.message, properties);
					break;
				case 'debug':
					logger.debug(value.message, properties);
					break;
				case 'info':
					logger.info(value.message, properties);
					break;
				case 'warning':
					logger.warn(value.message, properties);
					break;
				case 'error':
					logger.error(value.message, properties);
					break;
				case 'fatal':
					logger.fatal(value.message, properties);
					break;
			}
		},
	});
}

/**
 * Run a callback inside a host-provided LogTape implicit context.
 *
 * Browser and other runtimes without context-local state should use explicit
 * telemetry scopes instead; every event still carries its fields directly.
 */
export function run<Result>(api: LogTapeContextApi, fields: Fields, callback: () => Result): Result {
	if (api === null || typeof api !== 'object' || typeof api.withContext !== 'function') {
		throw new TypeError('LogTape context adapter requires withContext().');
	}
	return api.withContext(fields as Readonly<Record<string, unknown>>, callback);
}

/** Reject malformed logger adapters before they receive telemetry records. @internal */
function assertLogger(logger: LogTapeLogger): void {
	if (logger === null || typeof logger !== 'object') {
		throw new TypeError('LogTape telemetry adapter requires a logger.');
	}
	for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
		if (typeof logger[level] !== 'function') {
			throw new TypeError(`LogTape telemetry adapter requires logger.${level}().`);
		}
	}
}
