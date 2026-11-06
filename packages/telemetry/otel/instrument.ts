/** Optional OpenTelemetry and LogTape implementation of the portable Instrument contract. @module */
import { context, isSpanContextValid, metrics, ROOT_CONTEXT, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Attributes as NativeAttributes, Span } from '@opentelemetry/api';
import { getConfig, getLogger, withContext } from '@logtape/logtape';
import { reporter } from '../logtape.ts';
import { create as portable, errorType, saved } from '../instrument.ts';
import type { Attributes, Instrument, Observation, Options, TraceType } from '../instrument.ts';

/** Create an explicitly selected backend. Applications retain ownership of providers and LogTape configuration. */
export function create(options: Options = {}): Instrument {
	const output = portable({ ...options, reporter: options.reporter ?? reporter(getLogger(['utils'])) });

	/** Snapshot an active trace only after an application has selected this adapter. */
	function capture(): TraceType | undefined {
		try {
			const value = trace.getSpanContext(context.active());
			if (value === undefined || !isSpanContextValid(value)) return undefined;
			return {
				version: 1,
				traceparent: `00-${value.traceId}-${value.spanId}-${value.traceFlags.toString(16).padStart(2, '0')}`,
			};
		} catch {
			return undefined;
		}
	}

	/** Omit arbitrary correlation fields from metric dimensions; applications must also keep event names bounded. */
	function notice(name: string, fields: Attributes = {}, level: 'debug' | 'info' | 'warning' = 'info'): void {
		output.notice(name, fields, level);
		try {
			if (level !== 'debug') {
				metrics.getMeter('@okikio/utils').createCounter('utils.event.count', { unit: '{event}' }).add(1, {
					event: name,
				});
			}
		} catch { /* Observation cannot decide the result of a state change. */ }
	}

	return Object.freeze({
		capture,
		notice,
		flush: () => output.flush(),
		/**
		 * Attach a timed trace step and log context to one application callback.
		 * Restored trace identity links observations across processes; it grants no
		 * execution authority. A broken backend must neither skip nor repeat work.
		 */
		async span<Value>(
			name: string,
			fields: Attributes,
			callback: (observation: Observation) => Promise<Value>,
			parent?: TraceType,
		): Promise<Value> {
			let active: Span | undefined;
			let scope = ROOT_CONTEXT;
			let started: number | undefined;
			let counted = false;
			let failed = false;
			try {
				started = performance.now();
				scope = context.active();
				const restored = saved(parent);
				if (restored !== undefined) {
					const [, traceId, spanId, flags] = restored.traceparent.split('-');
					scope = trace.setSpanContext(ROOT_CONTEXT, {
						traceId: traceId!,
						spanId: spanId!,
						traceFlags: parseInt(flags!, 16),
						isRemote: true,
					});
				}
				active = trace.getTracer('@okikio/utils').startSpan(name, { attributes: attributes(fields) }, scope);
				measure(name, 1);
				counted = true;
			} catch { /* Instrumentation cannot prevent entry into application work. */ }
			const observation: Observation = {
				fail(reason) {
					failed = true;
					const type = errorType(reason);
					try {
						active?.setStatus({ code: SpanStatusCode.ERROR });
						active?.setAttribute('error.type', type);
					} catch { /* A backend cannot change the operation outcome. */ }
					notice('operation.failed', { error_type: type }, 'warning');
				},
			};
			/** Keep callback completion authoritative while attempting metrics and span closure on every exit. */
			const work = async (): Promise<Value> => {
				try {
					notice(`${name}.started`, fields, 'debug');
					return await callback(observation);
				} catch (reason) {
					observation.fail(reason);
					throw reason;
				} finally {
					const outcome = failed ? 'error' : 'success';
					try {
						const meter = metrics.getMeter('@okikio/utils');
						const dimensions = { operation: name, outcome };
						meter.createCounter('utils.operation.count', { unit: '{operation}' }).add(1, dimensions);
						if (started !== undefined) {
							meter.createHistogram('utils.operation.duration', { unit: 's' }).record(
								(performance.now() - started) / 1000,
								dimensions,
							);
						}
					} catch { /* Completion remains the callback's result. */ }
					try {
						if (counted) measure(name, -1);
					} catch { /* Observation only. */ }
					try {
						notice(`${name}.finished`, { ...fields, outcome }, 'debug');
					} catch { /* Diagnostic fields cannot replace the callback result. */ }
					try {
						active?.end();
					} catch { /* Ending observation cannot change completion. */ }
				}
			};
			let pending: Promise<Value> | undefined;
			// A backend may throw before or after calling enter. Share work so fallback cannot execute a command twice.
			const invoke = (): Promise<Value> => pending ??= work();
			try {
				const identity = active?.spanContext();
				const props = {
					...fields,
					...(identity !== undefined && isSpanContextValid(identity)
						? { trace_id: identity.traceId, span_id: identity.spanId }
						: {}),
				};
				const enter = () => getConfig()?.contextLocalStorage === undefined ? invoke() : withContext(props, invoke);
				return await context.with(active === undefined ? scope : trace.setSpan(scope, active), enter);
			} catch {
				// If entry failed, start normally. If work started, join its exact promise without invoking it twice.
				return await invoke();
			}
		},
	});
}

/** OpenTelemetry attributes are flat; structured portable fields remain in Reporter events. */
function attributes(fields: Attributes): NativeAttributes {
	const result: NativeAttributes = {};
	for (const [key, value] of Object.entries(fields)) {
		if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
			Object.defineProperty(result, key, { value, enumerable: true });
		}
	}
	return result;
}

/** Active work describes this reporting process; it is not shared queue depth. */
function measure(operation: string, amount: number): void {
	metrics.getMeter('@okikio/utils').createUpDownCounter('utils.operation.active', { unit: '{operation}' }).add(
		amount,
		{ operation },
	);
}
