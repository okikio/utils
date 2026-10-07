/** OpenTelemetry adapter for extracting active trace correlation without configuring or importing an SDK. @module */
import type { TraceFields } from './types.ts';

/** Minimal active-context surface used from an OpenTelemetry API implementation. */
export interface OpenTelemetryContextApi {
	/** Return the caller-supplied OpenTelemetry API current context. */
	active(): unknown;
}

/** Minimal span context consumed by telemetry correlation projection. */
export interface OpenTelemetrySpanContext {
	/** Trace correlation identity retained for diagnostic propagation. */
	readonly traceId: string;
	/** Span correlation identity for the current operation. */
	readonly spanId: string;
	/** Trace flags retained in the representation required by this adapter. */
	readonly traceFlags: number;
	/** Optional vendor trace-state object supplied by the host OpenTelemetry API. */
	readonly traceState?: Readonly<{ serialize(): string }>;
}

/** Minimal active span surface consumed by telemetry correlation projection. */
export interface OpenTelemetrySpan {
	/** Read the active span correlation identifiers without starting a span. */
	spanContext(): OpenTelemetrySpanContext;
}

/** Minimal tracing surface used from an OpenTelemetry API implementation. */
export interface OpenTelemetryTraceApi {
	/** Find a span in the supplied OpenTelemetry context, if one is active. */
	getSpan(ctx: unknown): OpenTelemetrySpan | undefined;
}

/** Structural OpenTelemetry API accepted from a host-owned instrumentation setup. */
export interface OpenTelemetryApi {
	/** Explicit OpenTelemetry context API; the utility does not configure a global tracing runtime. */
	readonly context: OpenTelemetryContextApi;
	/** Explicit OpenTelemetry trace lookup API; the utility does not start spans. */
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
	if (
		api === null || typeof api !== 'object' || api.context === null || typeof api.context !== 'object' ||
		typeof api.context.active !== 'function' || api.trace === null || typeof api.trace !== 'object' ||
		typeof api.trace.getSpan !== 'function'
	) {
		throw new TypeError('OpenTelemetry adapter requires context.active() and trace.getSpan().');
	}
}
