import * as recordCore from '@okikio/collection/record';
import type { Handler, ReadinessType } from './types.ts';

/** Options used by the liveness handler. */
export interface HealthOptions {
	/** Optional application service name included in the liveness result. */
	readonly service?: string;
	/** Service start time as epoch milliseconds, used for uptime reporting. */
	readonly startedAt?: number;
	/** A supplied Date clock controls timestamp and uptime together; the default host measures uptime monotonically. */
	readonly now?: () => Date;
}

/**
 * Create a process-liveness handler with no dependency checks. The default host
 * clock supplies wall timestamps and whole elapsed milliseconds independently.
 * Supplying now() keeps timestamp and uptime on that explicit Date clock.
 */
export function health(options: HealthOptions = {}): Handler {
	recordCore.assert(options, 'health options');
	const normalized = recordCore.snapshot(options, 'health options');
	if (normalized.service !== undefined && typeof normalized.service !== 'string') {
		throw new TypeError('health service must be a string when provided.');
	}
	if (normalized.startedAt !== undefined && !Number.isFinite(normalized.startedAt)) {
		throw new TypeError('health startedAt must be a finite number when provided.');
	}
	if (normalized.now !== undefined && typeof normalized.now !== 'function') {
		throw new TypeError('health now must be a function when provided.');
	}
	const service = normalized.service;
	const startedAt = normalized.startedAt ?? Date.now();
	const now = normalized.now ?? (() => new Date());
	// A supplied clock retains its epoch-based testing contract. The real host
	// converts an explicit historical start once, then measures only elapsed
	// monotonic time so clock corrections cannot move uptime backward or forward.
	const elapsedStart = normalized.now === undefined ? performance.now() : 0;
	const initialAge = normalized.now === undefined && normalized.startedAt !== undefined ? Date.now() - startedAt : 0;
	return () => {
		const current = now();
		if (!(current instanceof Date) || !Number.isFinite(current.getTime())) {
			throw new TypeError('health now must return a valid Date.');
		}
		return json({
			status: 'ok',
			...(service === undefined ? {} : { service }),
			timestamp: current.toISOString(),
			uptimeMs: normalized.now === undefined
				? Math.max(0, Math.floor(initialAge + performance.now() - elapsedStart))
				: Math.max(0, current.getTime() - startedAt),
		}, 200);
	};
}

/**
 * Return 200 or 503 from the caller's readiness result.
 * The probe must implement its own deadline and observe request.signal. This
 * wrapper does not add a timeout or block other routes when readiness is false.
 * Probe failures propagate to the application's error middleware.
 */
export function ready(
	probe: (request: Request) => boolean | ReadinessType | Promise<boolean | ReadinessType>,
	options: Readonly<{ readonly service?: string }> = {},
): Handler {
	if (typeof probe !== 'function') throw new TypeError('readiness probe must be a function.');
	recordCore.assert(options, 'readiness options');
	if (options.service !== undefined && typeof options.service !== 'string') {
		throw new TypeError('readiness service must be a string when provided.');
	}
	const service = options.service;
	return async (request) => {
		const result = await probe(request);
		const readiness = normalizeReadiness(result);
		return json({
			status: readiness.ready ? 'ready' : 'not-ready',
			...(service === undefined ? {} : { service }),
			...(readiness.detail === undefined ? {} : { detail: readiness.detail }),
			...(readiness.checks === undefined ? {} : { checks: readiness.checks }),
		}, readiness.ready ? 200 : 503);
	};
}

/** Validate one readiness result without executing accessor-backed diagnostic data. @internal */
function normalizeReadiness(value: boolean | ReadinessType): ReadinessType {
	if (typeof value === 'boolean') return Object.freeze({ ready: value });
	recordCore.assert(value, 'readiness result');
	if (typeof value.ready !== 'boolean') throw new TypeError('readiness result ready must be a boolean.');
	if (value.detail !== undefined && typeof value.detail !== 'string') {
		throw new TypeError('readiness result detail must be a string when provided.');
	}
	let checks: Readonly<Record<string, boolean>> | undefined;
	if (value.checks !== undefined) {
		recordCore.assert(value.checks, 'readiness checks');
		for (const [name, passed] of recordCore.entries(value.checks, 'readiness checks')) {
			if (typeof passed !== 'boolean') {
				throw new TypeError(`readiness check ${JSON.stringify(name)} must be a boolean.`);
			}
		}
		checks = recordCore.snapshot(value.checks, 'readiness checks');
	}
	return Object.freeze({
		ready: value.ready,
		...(value.detail === undefined ? {} : { detail: value.detail }),
		...(checks === undefined ? {} : { checks }),
	});
}

/** Materialize one small operational JSON response without cache retention. */
function json(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
	});
}
