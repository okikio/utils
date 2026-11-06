/**
 * Lifecycle values shared by event producers and telemetry translators.
 *
 * These declarations contain no live resources. Keeping the event vocabulary
 * below its producers lets an observer understand an event without importing
 * the pool, scheduler, worker, or server that emitted it. Producers retain their
 * original public type exports; only the declaration owner changes.
 * @module
 */
import type { CatalogEntryIdentity } from '@okikio/collection/catalog/types';

/** Pool resource and lease transitions, emitted after their state changes. */
export type PoolEventType =
	| Readonly<{ readonly type: 'creating' }>
	| Readonly<{ readonly type: 'created' }>
	| Readonly<{ readonly type: 'acquired'; readonly acquiredAt: string }>
	| Readonly<{ readonly type: 'released'; readonly reusable: boolean }>
	| Readonly<{ readonly type: 'invalidated'; readonly reason?: unknown }>
	| Readonly<{ readonly type: 'closed-value'; readonly reason?: unknown }>
	| Readonly<{ readonly type: 'draining'; readonly reason?: unknown }>
	| Readonly<{ readonly type: 'disposed' }>;

/** Queue admission, claim, renewal, and terminal transitions. Claim IDs fence late attempts. */
export type QueueEventType =
	| Readonly<{ readonly type: 'added'; readonly itemId: string; readonly key?: string }>
	| Readonly<
		{
			readonly type: 'claimed';
			readonly itemId: string;
			readonly claimId: string;
			readonly owner: string;
			readonly attempt: number;
		}
	>
	| Readonly<
		{ readonly type: 'renewed'; readonly itemId: string; readonly claimId: string; readonly expiresAt: string }
	>
	| Readonly<{ readonly type: 'completed'; readonly itemId: string; readonly claimId: string }>
	| Readonly<{ readonly type: 'failed'; readonly itemId: string; readonly claimId: string; readonly failureId: string }>
	| Readonly<
		{ readonly type: 'retried'; readonly itemId: string; readonly claimId: string; readonly availableAt: string }
	>
	| Readonly<{ readonly type: 'cancelled'; readonly itemId: string }>
	| Readonly<{ readonly type: 'claim-expired'; readonly itemId: string; readonly claimId: string }>
	| Readonly<{ readonly type: 'pruned'; readonly itemId: string }>
	| Readonly<{ readonly type: 'closed' }>;

/** Named or numeric operating-system signal accepted by process adapters. */
export type SignalType =
	| 'SIGABRT'
	| 'SIGALRM'
	| 'SIGHUP'
	| 'SIGINFO'
	| 'SIGINT'
	| 'SIGKILL'
	| 'SIGPIPE'
	| 'SIGQUIT'
	| 'SIGSTOP'
	| 'SIGTERM'
	| 'SIGUSR1'
	| 'SIGUSR2'
	| 'SIGWINCH'
	// deno-lint-ignore ban-types -- Preserve known signal suggestions while accepting platform-specific signal names.
	| (string & {})
	| number;

/** Process startup and shutdown observations. The process owner still decides its terminal result. */
export type ProcessEventType =
	| Readonly<{ readonly type: 'started'; readonly pid: number }>
	| Readonly<{ readonly type: 'signal'; readonly signal: SignalType }>
	| Readonly<{ readonly type: 'stopping'; readonly reason?: unknown }>
	| Readonly<{ readonly type: 'forced' }>
	| Readonly<{ readonly type: 'exited'; readonly code: number; readonly success: boolean; readonly signal?: string }>
	| Readonly<{ readonly type: 'output-limit'; readonly stream: 'stdout' | 'stderr'; readonly maximumBytes: number }>;

/** Worker messages and lifecycle transitions, correlated by worker and call IDs. */
export type WorkerEventType =
	| Readonly<{ readonly type: 'opened'; readonly id: string }>
	| Readonly<{ readonly type: 'request'; readonly id: string }>
	| Readonly<{ readonly type: 'notice'; readonly id: string }>
	| Readonly<{ readonly type: 'call'; readonly id: string; readonly callId: string }>
	| Readonly<{ readonly type: 'paused'; readonly id: string }>
	| Readonly<{ readonly type: 'resumed'; readonly id: string }>
	| Readonly<{ readonly type: 'result'; readonly id: string }>
	| Readonly<{ readonly type: 'failure'; readonly id: string; readonly failureId: string }>
	| Readonly<{ readonly type: 'fault'; readonly id?: string; readonly reason: unknown }>
	| Readonly<{ readonly type: 'cancelled'; readonly id: string }>
	| Readonly<{ readonly type: 'stopping'; readonly reason?: unknown }>
	| Readonly<{ readonly type: 'stopped'; readonly forced: boolean }>;

/** Subprocess channel observations, including messages, exit, and communication failures. */
export type ProcessChannelEventType =
	| Readonly<{ readonly type: 'opened'; readonly pid: number }>
	| Readonly<{ readonly type: 'request'; readonly id: string }>
	| Readonly<{ readonly type: 'notice'; readonly id: string }>
	| Readonly<{ readonly type: 'call'; readonly id: string; readonly callId: string }>
	| Readonly<{ readonly type: 'paused'; readonly id: string }>
	| Readonly<{ readonly type: 'resumed'; readonly id: string }>
	| Readonly<{ readonly type: 'result'; readonly id: string }>
	| Readonly<{ readonly type: 'failure'; readonly id: string; readonly failureId: string }>
	| Readonly<{ readonly type: 'fault'; readonly id?: string; readonly reason: unknown }>
	| Readonly<{ readonly type: 'cancelled'; readonly id: string }>
	| Readonly<{ readonly type: 'closing'; readonly reason?: unknown }>
	| Readonly<{ readonly type: 'closed' }>;

/** Service milestones that an observer can subscribe to during a request. */
export type ServiceObserverEventKind = 'started' | 'response' | 'completed' | 'failed' | 'aborted';

/** Catalog declaration that selects the service milestones an observer receives. */
export interface ServiceObserverDefinition extends CatalogEntryIdentity {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'service-observer';
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description: string;
	/** Service lifecycle event kinds selected for observation; receiving headers and completing a body are separate events. */
	readonly events: readonly ServiceObserverEventKind[];
}

/** Redacted request observation. It reports service progress without giving the observer authority to settle the request. */
export interface ServiceObserverEvent {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: ServiceObserverEventKind;
	/** Identity of the service selected for this route or observation. */
	readonly serviceId: string;
	/** Request correlation identity; it is diagnostic data rather than authorization. */
	readonly requestId?: string;
	/** Trace correlation identity retained for diagnostic propagation. */
	readonly traceId?: string;
	/** Span correlation identity for the current operation. */
	readonly spanId?: string;
	/** HTTP method selected for this operation or route. */
	readonly method: string;
	/** Declared route pathname or prefix; path parameters retain the endpoint grammar. */
	readonly path: string;
	/** Identity of the selected endpoint path contract. */
	readonly endpointId: string;
	/** Stable operation identity used by generated clients, routing and diagnostics. */
	readonly operationId: string;
	/** HTTP status selected by this response or reported by this lifecycle observation. */
	readonly status?: number;
	/** Observed response-body bytes; response headers alone do not prove body completion. */
	readonly responseBytes?: number;
	/** Response-body terminal outcome and delivered byte count, distinct from receiving headers. */
	readonly completion?: Readonly<{ readonly outcome: 'completed' | 'cancelled' | 'errored'; readonly bytes: number }>;
	/** Diagnostic failure retained for this observation; it does not replace the authoritative operation result. */
	readonly error?: Readonly<{ readonly name: string; readonly message: string }>;
}

/** Bind a service observer declaration to its notification callback. */
export interface ServiceObserverHandler<Definition extends ServiceObserverDefinition = ServiceObserverDefinition> {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'service-observer-handler';
	/** Exact declaration involved in this binding, result or validation issue. */
	readonly definition: Definition;
	/** Observe a redacted service lifecycle event; this callback cannot settle the request. */
	readonly handle: (event: ServiceObserverEvent) => void | Promise<void>;
}

/** Gateway milestones. A response reports headers; completion reports the end of its body. */
export type GatewayObserverEventKind = 'denied' | 'forwarding' | 'response' | 'completed' | 'failed' | 'aborted';

/** Catalog declaration that selects which gateway milestones to observe. */
export interface GatewayObserverDefinition extends CatalogEntryIdentity {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'gateway-observer';
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description: string;
	/** Gateway lifecycle event kinds selected for observation; response means headers, and completed means body EOF. */
	readonly events: readonly GatewayObserverEventKind[];
}

/** Redacted forwarding observation, with request identity and any available response or failure details. */
export interface GatewayObserverEvent {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: GatewayObserverEventKind;
	/** Gateway identity retained for route and lifecycle correlation. */
	readonly gatewayId: string;
	/** Request correlation identity; it is diagnostic data rather than authorization. */
	readonly requestId: string;
	/** Trace correlation identity retained for diagnostic propagation. */
	readonly traceId: string;
	/** Span correlation identity for the current operation. */
	readonly spanId: string;
	/** HTTP method selected for this operation or route. */
	readonly method: string;
	/** Request pathname retained for redacted lifecycle observation. */
	readonly pathname: string;
	/** Identity of the selected compiled route, when routing has completed. */
	readonly routeId?: string;
	/** Identity of the service selected for this route or observation. */
	readonly serviceId?: string;
	/** Identity of the selected endpoint path contract. */
	readonly endpointId?: string;
	/** Stable operation identity used by generated clients, routing and diagnostics. */
	readonly operationId?: string;
	/** HTTP status selected by this response or reported by this lifecycle observation. */
	readonly status?: number;
	/** Observed request-body bytes at this transport boundary. */
	readonly requestBytes?: number;
	/** Observed response-body bytes; response headers alone do not prove body completion. */
	readonly responseBytes?: number;
	/** Response-body terminal outcome and delivered byte count, distinct from receiving headers. */
	readonly completion?: Readonly<{ readonly outcome: 'completed' | 'cancelled' | 'errored'; readonly bytes: number }>;
	/** Diagnostic failure retained for this observation; it does not replace the authoritative operation result. */
	readonly error?: Readonly<{ readonly name: string; readonly message: string }>;
}

/** Bind a gateway observer declaration to a callback that cannot change the forwarding result. */
export interface GatewayObserverHandler<Definition extends GatewayObserverDefinition = GatewayObserverDefinition> {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'gateway-observer-handler';
	/** Exact declaration involved in this binding, result or validation issue. */
	readonly definition: Definition;
	/** Observe a redacted gateway lifecycle event; this callback cannot settle the request. */
	readonly handle: (event: GatewayObserverEvent) => void | Promise<void>;
}
