/** Public owners and budgets for one dedicated-port stream. @module */
import type { Owned } from '@okikio/context';
import type { EventBus } from '@okikio/observables/events';

/** Native MessagePort capability. Calling open/serve explicitly transfers ownership of this dedicated port. */
export interface Port {
	/** Structured-clone a frame; an owned exact-sized chunk may transfer its buffer. */
	postMessage(value: unknown): void;
	/** Transfer only this protocol's owned ArrayBuffers; DOM and Node port overloads both accept them. */
	postMessage(value: unknown, transfer: ArrayBuffer[]): void;
	/** Preserve native event listeners; this protocol removes only its own registrations. */
	addEventListener(type: string, listener: (event: Event) => void): void;
	/** Remove the exact listener owned by this endpoint. */
	removeEventListener(type: string, listener: (event: Event) => void): void;
	/** Enable native MessagePort message dispatch. */
	start(): void;
	/** Close only this endpoint; never terminate the enclosing Worker. */
	close(): void;
}

/** Explicit receive/send bounds. Negotiation uses the lower value for each bound. */
export interface LimitsType {
	/** Positive maximum bytes in a single copied/transferred chunk. Full backing stores must fit too. */
	readonly maximumChunkBytes: number;
	/** Positive maximum data frames, including zero-length chunks. */
	readonly maximumChunks: number;
	/** Positive maximum total payload bytes. Protocol envelope/native queue overhead is not included. */
	readonly maximumBytes: number;
}
/** Receiver policy for one stream. */
export interface OpenOptionsType extends LimitsType {
	/** Bounded application correlation ID, 1–128 ASCII letters/digits/underscore/dot/colon/hyphen. */
	readonly id: string;
	/** Positive milliseconds on ctx.clock for each handshake, requested chunk or cancellation receipt. */
	readonly timeout: number;
}
/** Small notifications available through both native EventTarget and EventBus projections. */
export interface EventType {
	/** Notifications never replace ready/closed promises. */
	readonly type: 'ready' | 'chunk' | 'complete' | 'cancelled' | 'fault' | 'unconfirmed';
	/** Number of received/sent chunks, not the sequence of the last chunk. */
	readonly chunks: number;
	/** Total received/sent payload bytes; no native queue/heap claim. */
	readonly bytes: number;
}
/** Terminal evidence, including an explicit absence of remote cleanup confirmation. */
export interface OutcomeType {
	/** Unconfirmed means no valid terminal receipt arrived before local retirement; reconcile/terminate the host separately. */
	readonly status: 'complete' | 'cancelled' | 'fault' | 'unconfirmed';
	/** Total validated payload chunks before retirement. */
	readonly chunks: number;
	/** Total validated payload bytes before retirement. */
	readonly bytes: number;
	/** Exact local reason, even if remote cleanup later faults; otherwise remote faults use a redacted protocol error. */
	readonly reason: unknown;
}
/** Shared observations do not own cleanup or terminal completion. */
export interface Observation {
	/** Native CustomEvent<EventType> named 'state'; normal listeners and adapter subscriptions coexist. */
	readonly target: EventTarget;
	/** Existing Observable EventBus view; no retained history. */
	readonly events: EventBus<EventType>['events'];
	/** Joined terminal outcome, independent of subscribers. */
	readonly closed: Promise<OutcomeType>;
}
/** Receiver owns a zero-prefetch stream and the dedicated local port. */
export interface Receiver extends Observation, AsyncDisposable {
	/** Resolves only after exact version/ID and bounded limits agree. */
	readonly ready: Promise<void>;
	/** One upstream credit per downstream read; supports native piping. */
	readonly readable: ReadableStream<Uint8Array<ArrayBuffer>>;
	/** Stop reading and join the remote cleanup receipt, or report unconfirmed after timeout. */
	cancel(reason?: unknown): Promise<OutcomeType>;
}
/** Producer owns its iterator/child Context; source work must cooperate to make cleanup settle. */
export interface Producer extends Observation, AsyncDisposable {
	/** Cancel the source child and await its actual iterator/Context cleanup. A hung source can keep this pending. */
	stop(reason?: unknown): Promise<OutcomeType>;
}
/** Lazy producer starts only after negotiated downstream demand. Bytes must remain stable until next() settles. */
export type Source = (ctx: Owned) => AsyncIterable<Uint8Array>;
