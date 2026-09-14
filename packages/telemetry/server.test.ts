import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as gateway from '@okikio/server/gateway/definition';
import * as service from '@okikio/server/service/definition';
import * as telemetry from './mod.ts';
import * as server from './server.ts';

const fixed = () => '2026-09-09T00:00:00.000Z';

describe('@okikio/telemetry/server', () => {
	it('projects service lifecycle metadata into stable telemetry records', async () => {
		const output = telemetry.memory();
		const scope = telemetry.create(output, { now: fixed });
		const Diagnostics = service.observer.define({ id: 'service.diagnostics', description: 'Test diagnostics.' });
		const handler = server.service(Diagnostics, scope);
		await handler.handle(Object.freeze({
			kind: 'completed',
			serviceId: 'accounts',
			requestId: 'request-1',
			traceId: 'trace-1',
			spanId: 'span-1',
			method: 'GET',
			path: '/accounts/:id',
			endpointId: 'accounts.read',
			operationId: 'accountsRead',
			status: 200,
			responseBytes: 128,
			completion: Object.freeze({ outcome: 'completed', bytes: 128 }),
		}));
		expect(output.records[0]).toMatchObject({
			name: 'service.request.completed',
			level: 'info',
			fields: {
				service_id: 'accounts',
				request_id: 'request-1',
				trace_id: 'trace-1',
				operation_id: 'accountsRead',
				status: 200,
				response_bytes: 128,
				completion_outcome: 'completed',
			},
		});
	});

	it('projects gateway failures without requiring a logging or tracing backend', async () => {
		const output = telemetry.memory();
		const scope = telemetry.create(output, { now: fixed });
		const Diagnostics = gateway.observer.define({ id: 'gateway.diagnostics', description: 'Test diagnostics.' });
		const handler = server.gateway(Diagnostics, scope);
		await handler.handle(Object.freeze({
			kind: 'failed',
			gatewayId: 'public',
			requestId: 'request-2',
			traceId: 'trace-2',
			spanId: 'span-2',
			method: 'POST',
			pathname: '/api/accounts',
			routeId: 'route-2',
			serviceId: 'accounts',
			endpointId: 'accounts.create',
			operationId: 'accountsCreate',
			error: Object.freeze({ name: 'TypeError', message: 'upstream failed' }),
		}));
		expect(output.records[0]).toMatchObject({
			name: 'gateway.request.failed',
			level: 'error',
			fields: {
				gateway_id: 'public',
				request_id: 'request-2',
				route_id: 'route-2',
				service_id: 'accounts',
			},
			fault: { name: 'TypeError', message: 'upstream failed' },
		});
	});
});
