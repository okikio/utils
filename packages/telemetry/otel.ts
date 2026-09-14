/** OpenTelemetry adapter for extracting active trace correlation without configuring or importing an SDK. @module */
import type { TraceFields } from './types.ts';

/** Minimal active-context surface used from an OpenTelemetry API implementation. */
export interface OpenTelemetryContextApi {
	active(): unknown;
}

/** Minimal span context consumed by telemetry correlation projection. */
export interface OpenTelemetrySpanContext {
	readonly traceId: string;
	readonly spanId: string;
	readonly traceFlags: number;
	readonly traceState?: Readonly<{ serialize(): string }>;
}

/** Minimal active span surface consumed by telemetry correlation projection. */
export interface OpenTelemetrySpan {
	spanContext(): OpenTelemetrySpanContext;
}

/** Minimal tracing surface used from an OpenTelemetry API implementation. */
export interface OpenTelemetryTraceApi {
	getSpan(ctx: unknown): OpenTelemetrySpan | undefined;
}

/** Structural OpenTelemetry API accepted from a host-owned instrumentation setup. */
export interface OpenTelemetryApi {
	readonly context: OpenTelemetryContextApi;
	readonly trace: OpenTelemetryTraceApi;
}

const TRACE_ID = /^[0-9a-f]{32}$/i;
const SPAN_ID = /^[0-9a-f]{16}$/i;
const ZERO_TRACE_ID = '00000000000000000000000000000000';
const ZERO_SPAN_ID = '0000000000000000';

/** Return active OpenTelemetry trace/span identity when the supplied host API exposes a valid active span. */
export function active(api: OpenTelemetryApi): TraceFields {
	assertApi(api);
	const span = api.trace.getSpan(api.context.active());
	if (span === undefined) return Object.freeze({});
	const value = span.spanContext();
	if (!valid(value)) return Object.freeze({});
	const traceState = value.traceState?.serialize();
	return Object.freeze({
		trace_id: value.traceId,
		span_id: value.spanId,
		trace_flags: value.traceFlags,
		...(traceState === undefined || traceState.length === 0 ? {} : { trace_state: traceState }),
	});
}

/** Validate W3C/OpenTelemetry trace identity without depending on one SDK implementation. @internal */
function valid(value: OpenTelemetrySpanContext): boolean {
	return TRACE_ID.test(value.traceId) && value.traceId !== ZERO_TRACE_ID &&
		SPAN_ID.test(value.spanId) && value.spanId !== ZERO_SPAN_ID &&
		Number.isSafeInteger(value.traceFlags) && value.traceFlags >= 0;
}

/** Reject malformed host adapters at the optional adapter seam. @internal */
function assertApi(api: OpenTelemetryApi): void {
	if (api === null || typeof api !== 'object' || api.context === null || typeof api.context !== 'object' ||
		typeof api.context.active !== 'function' || api.trace === null || typeof api.trace !== 'object' ||
		typeof api.trace.getSpan !== 'function') {
		throw new TypeError('OpenTelemetry adapter requires context.active() and trace.getSpan().');
	}
}
