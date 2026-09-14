/**
 * Portable adapters for existing Okikio lifecycle event streams.
 *
 * These helpers translate authoritative queue/pool/Worker/process events into
 * telemetry records. They do not subscribe, mutate source state, or make
 * telemetry delivery part of the source lifecycle.
 *
 * @module
 */
import type { FaultValue } from '@okikio/fault';
import type { Event as PoolEvent } from '@okikio/pool';
import type { QueueEventType } from '@okikio/queue';
import type { ProcessEventType } from '@okikio/process';
import type { ProcessEventType as ProcessChannelEventType } from '@okikio/process/channel';
import type { WorkerEventType } from '@okikio/worker';
import type { EventInput, Fields, Level, Scope } from './types.ts';

/** Event callback that can be passed directly to an observable subscription. */
export type Handler<Event> = (event: Event) => void | Promise<void>;

/** Translate committed queue state changes into stable telemetry events. */
export function queue(scope: Scope, fields: Fields = {}): Handler<QueueEventType> {
	return handler(scope, fields, queueInput);
}

/** Translate process-local pool ownership changes into stable telemetry events. */
export function pool(scope: Scope, fields: Fields = {}): Handler<PoolEvent> {
	return handler(scope, fields, poolInput);
}

/** Translate Worker transport/request lifecycle changes into stable telemetry events. */
export function worker(scope: Scope, fields: Fields = {}): Handler<WorkerEventType> {
	return handler(scope, fields, workerInput);
}

/** Translate owned OS-process lifecycle changes into stable telemetry events. */
export function process(scope: Scope, fields: Fields = {}): Handler<ProcessEventType> {
	return handler(scope, fields, processInput);
}

/** Translate framed process-channel request lifecycle changes into stable telemetry events. */
export function channel(scope: Scope, fields: Fields = {}): Handler<ProcessChannelEventType> {
	return handler(scope, fields, channelInput);
}

/** Bind a translator to one explicit child scope without owning the source subscription. @internal */
function handler<Event>(
	scope: Scope,
	fields: Fields,
	translate: (event: Event) => EventInput,
): Handler<Event> {
	assertScope(scope);
	const target = scope.child(fields);
	return async (event: Event): Promise<void> => {
		await target.report(translate(event));
	};
}

/** Translate one queue event. @internal */
function queueInput(event: QueueEventType): EventInput {
	switch (event.type) {
		case 'added':
			return input('queue.item.added', 'debug', { item_id: event.itemId, key: event.key });
		case 'claimed':
			return input('queue.claim.acquired', 'debug', {
				item_id: event.itemId,
				claim_id: event.claimId,
				owner: event.owner,
				attempt: event.attempt,
			});
		case 'renewed':
			return input('queue.claim.renewed', 'trace', { item_id: event.itemId, claim_id: event.claimId, expires_at: event.expiresAt });
		case 'completed':
			return input('queue.item.completed', 'info', { item_id: event.itemId, claim_id: event.claimId });
		case 'failed':
			return input('queue.item.failed', 'warning', { item_id: event.itemId, claim_id: event.claimId, failure_id: event.failureId });
		case 'retried':
			return input('queue.item.retried', 'warning', { item_id: event.itemId, claim_id: event.claimId, available_at: event.availableAt });
		case 'cancelled':
			return input('queue.item.cancelled', 'info', { item_id: event.itemId });
		case 'claim-expired':
			return input('queue.claim.expired', 'warning', { item_id: event.itemId, claim_id: event.claimId });
		case 'closed':
			return input('queue.closed', 'info');
	}
}

/** Translate one pool event. @internal */
function poolInput(event: PoolEvent): EventInput {
	switch (event.type) {
		case 'creating': return input('pool.resource.creating', 'trace');
		case 'created': return input('pool.resource.created', 'debug');
		case 'acquired': return input('pool.lease.acquired', 'debug', { acquired_at: event.acquiredAt });
		case 'released': return input('pool.lease.released', 'trace', { reusable: event.reusable });
		case 'invalidated': return input('pool.lease.invalidated', 'warning', {}, event.reason);
		case 'closed-value': return input('pool.resource.closed', 'debug', {}, event.reason);
		case 'draining': return input('pool.draining', 'info', {}, event.reason);
		case 'disposed': return input('pool.disposed', 'info');
	}
}

/** Translate one Worker event. @internal */
function workerInput(event: WorkerEventType): EventInput {
	switch (event.type) {
		case 'opened': return input('worker.opened', 'info', { worker_id: event.id });
		case 'request': return input('worker.request.started', 'debug', { request_id: event.id });
		case 'notice': return input('worker.request.notice', 'trace', { request_id: event.id });
		case 'call': return input('worker.request.call', 'trace', { request_id: event.id, call_id: event.callId });
		case 'paused': return input('worker.request.paused', 'debug', { request_id: event.id });
		case 'resumed': return input('worker.request.resumed', 'debug', { request_id: event.id });
		case 'result': return input('worker.request.completed', 'info', { request_id: event.id });
		case 'failure': return input('worker.request.failed', 'warning', { request_id: event.id, failure_id: event.failureId });
		case 'fault': return input('worker.request.faulted', 'error', { request_id: event.id }, event.reason);
		case 'cancelled': return input('worker.request.cancelled', 'info', { request_id: event.id });
		case 'stopping': return input('worker.stopping', 'info', {}, event.reason);
		case 'stopped': return input('worker.stopped', event.forced ? 'warning' : 'info', { forced: event.forced });
	}
}

/** Translate one owned process event. @internal */
function processInput(event: ProcessEventType): EventInput {
	switch (event.type) {
		case 'started': return input('process.started', 'info', { process_id: event.pid });
		case 'signal': return input('process.signal.sent', 'debug', { signal: event.signal });
		case 'stopping': return input('process.stopping', 'info', {}, event.reason);
		case 'forced': return input('process.forced', 'warning');
		case 'exited': return input('process.exited', event.success ? 'info' : 'error', {
			exit_code: event.code,
			success: event.success,
			signal: event.signal,
		});
		case 'output-limit': return input('process.output.limit', 'warning', {
			stream: event.stream,
			maximum_bytes: event.maximumBytes,
		});
	}
}

/** Translate one framed process-channel event. @internal */
function channelInput(event: ProcessChannelEventType): EventInput {
	switch (event.type) {
		case 'opened': return input('process.channel.opened', 'info', { process_id: event.pid });
		case 'request': return input('process.channel.request.started', 'debug', { request_id: event.id });
		case 'notice': return input('process.channel.request.notice', 'trace', { request_id: event.id });
		case 'call': return input('process.channel.request.call', 'trace', { request_id: event.id, call_id: event.callId });
		case 'paused': return input('process.channel.request.paused', 'debug', { request_id: event.id });
		case 'resumed': return input('process.channel.request.resumed', 'debug', { request_id: event.id });
		case 'result': return input('process.channel.request.completed', 'info', { request_id: event.id });
		case 'failure': return input('process.channel.request.failed', 'warning', { request_id: event.id, failure_id: event.failureId });
		case 'fault': return input('process.channel.request.faulted', 'error', { request_id: event.id }, event.reason);
		case 'cancelled': return input('process.channel.request.cancelled', 'info', { request_id: event.id });
		case 'closing': return input('process.channel.closing', 'info', {}, event.reason);
		case 'closed': return input('process.channel.closed', 'info');
	}
}

/** Build one lifecycle telemetry input while omitting absent fields. @internal */
function input(
	name: string,
	level: Level,
	fields: Readonly<Record<string, FaultValue | undefined>> = Object.freeze({}),
	error?: unknown,
): EventInput {
	return Object.freeze({
		name,
		level,
		fields: compact(fields),
		...(error === undefined ? {} : { error }),
	});
}

/** Remove absent optional fields before strict telemetry field validation. @internal */
function compact(fields: Readonly<Record<string, FaultValue | undefined>>): Fields {
	const output: Record<string, FaultValue> = Object.create(null);
	for (const [key, value] of Object.entries(fields)) {
		if (value !== undefined) output[key] = value;
	}
	return Object.freeze(output);
}

/** Reject malformed scopes before binding a lifecycle translator. @internal */
function assertScope(scope: Scope): void {
	if (scope === null || typeof scope !== 'object' || typeof scope.report !== 'function') {
		throw new TypeError('Lifecycle telemetry adapter requires a telemetry scope.');
	}
}
