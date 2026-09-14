import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import { active, type OpenTelemetryApi } from './otel.ts';

function api(spanContext?: Readonly<{
	traceId: string;
	spanId: string;
	traceFlags: number;
	traceState?: Readonly<{ serialize(): string }>;
}>): OpenTelemetryApi {
	return {
		context: { active: () => ({}) },
		trace: {
			getSpan: () => spanContext === undefined ? undefined : { spanContext: () => spanContext },
		},
	};
}

describe('@okikio/telemetry/otel', () => {
	it('returns an empty projection when the host has no active span', () => {
		expect(active(api())).toEqual({});
	});

	it('projects a valid active OpenTelemetry span without owning the SDK', () => {
		expect(active(api({
			traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
			spanId: '00f067aa0ba902b7',
			traceFlags: 1,
			traceState: { serialize: () => 'vendor=value' },
		}))).toEqual({
			trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
			span_id: '00f067aa0ba902b7',
			trace_flags: 1,
			trace_state: 'vendor=value',
		});
	});

	it('rejects invalid or all-zero trace identity', () => {
		expect(active(api({ traceId: '0'.repeat(32), spanId: '1'.repeat(16), traceFlags: 1 }))).toEqual({});
		expect(active(api({ traceId: '1'.repeat(32), spanId: '0'.repeat(16), traceFlags: 1 }))).toEqual({});
	});
});
