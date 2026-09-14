/**
 * Adapters from `@okikio/server` lifecycle observers to portable telemetry scopes.
 *
 * The adapters depend only on import-safe observer types. They do not create a
 * server runtime, start a listener, configure logging, or install tracing.
 *
 * @module
 */
import type { FaultValue } from '@okikio/fault';
import type {
	GatewayObserverDefinition,
	GatewayObserverEvent,
	GatewayObserverEventKind,
	GatewayObserverHandler,
} from '@okikio/server/gateway/types';
import type {
	ServiceObserverDefinition,
	ServiceObserverEvent,
	ServiceObserverEventKind,
	ServiceObserverHandler,
} from '@okikio/server/service/types';
import type { EventInput, Fields, Level, Scope } from './types.ts';

const SERVICE_LEVEL = Object.freeze({
	started: 'debug',
	response: 'debug',
	completed: 'info',
	failed: 'error',
	aborted: 'warning',
} satisfies Record<ServiceObserverEventKind, Level>);

const GATEWAY_LEVEL = Object.freeze({
	denied: 'info',
	forwarding: 'debug',
	response: 'debug',
	completed: 'info',
	failed: 'error',
	aborted: 'warning',
} satisfies Record<GatewayObserverEventKind, Level>);

/** Bind an exact service observer definition to one portable telemetry scope. */
export function service<Definition extends ServiceObserverDefinition>(
	definition: Definition,
	scope: Scope,
): ServiceObserverHandler<Definition> {
	assertScope(scope);
	return Object.freeze({
		kind: 'service-observer-handler',
		definition,
		async handle(value: ServiceObserverEvent): Promise<void> {
			await scope.report(serviceInput(value));
		},
	});
}

/** Bind an exact gateway observer definition to one portable telemetry scope. */
export function gateway<Definition extends GatewayObserverDefinition>(
	definition: Definition,
	scope: Scope,
): GatewayObserverHandler<Definition> {
	assertScope(scope);
	return Object.freeze({
		kind: 'gateway-observer-handler',
		definition,
		async handle(value: GatewayObserverEvent): Promise<void> {
			await scope.report(gatewayInput(value));
		},
	});
}

/** Translate a service lifecycle event without copying request credentials or bodies. @internal */
function serviceInput(value: ServiceObserverEvent): EventInput {
	return Object.freeze({
		name: `service.request.${value.kind}`,
		level: SERVICE_LEVEL[value.kind],
		message: serviceMessage(value.kind),
		fields: compact({
			service_id: value.serviceId,
			request_id: value.requestId,
			trace_id: value.traceId,
			span_id: value.spanId,
			method: value.method,
			path: value.path,
			endpoint_id: value.endpointId,
			operation_id: value.operationId,
			status: value.status,
			response_bytes: value.responseBytes,
			completion_outcome: value.completion?.outcome,
		}),
		...(value.error === undefined ? {} : { fault: value.error as FaultValue }),
	});
}

/** Translate a gateway lifecycle event without copying request credentials or bodies. @internal */
function gatewayInput(value: GatewayObserverEvent): EventInput {
	return Object.freeze({
		name: `gateway.request.${value.kind}`,
		level: GATEWAY_LEVEL[value.kind],
		message: gatewayMessage(value.kind),
		fields: compact({
			gateway_id: value.gatewayId,
			request_id: value.requestId,
			trace_id: value.traceId,
			span_id: value.spanId,
			method: value.method,
			pathname: value.pathname,
			route_id: value.routeId,
			service_id: value.serviceId,
			endpoint_id: value.endpointId,
			operation_id: value.operationId,
			status: value.status,
			request_bytes: value.requestBytes,
			response_bytes: value.responseBytes,
			completion_outcome: value.completion?.outcome,
		}),
		...(value.error === undefined ? {} : { fault: value.error as FaultValue }),
	});
}

/** Remove absent optional fields before they enter the strict telemetry value contract. @internal */
function compact(fields: Readonly<Record<string, FaultValue | undefined>>): Fields {
	const output: Record<string, FaultValue> = Object.create(null);
	for (const [key, value] of Object.entries(fields)) {
		if (value !== undefined) output[key] = value;
	}
	return Object.freeze(output);
}

/** Human-readable service lifecycle descriptions remain separate from stable event names. @internal */
function serviceMessage(kind: ServiceObserverEventKind): string {
	switch (kind) {
		case 'started': return 'Service request started.';
		case 'response': return 'Service response headers are ready.';
		case 'completed': return 'Service response completed.';
		case 'failed': return 'Service request failed.';
		case 'aborted': return 'Service request was aborted.';
	}
}

/** Human-readable gateway lifecycle descriptions remain separate from stable event names. @internal */
function gatewayMessage(kind: GatewayObserverEventKind): string {
	switch (kind) {
		case 'denied': return 'Gateway request was denied.';
		case 'forwarding': return 'Gateway request is forwarding upstream.';
		case 'response': return 'Gateway upstream response headers arrived.';
		case 'completed': return 'Gateway response completed.';
		case 'failed': return 'Gateway request failed.';
		case 'aborted': return 'Gateway request was aborted.';
	}
}

/** Reject malformed scopes before creating a server observer handler. @internal */
function assertScope(scope: Scope): void {
	if (scope === null || typeof scope !== 'object' || typeof scope.report !== 'function') {
		throw new TypeError('Server telemetry adapter requires a telemetry scope.');
	}
}
