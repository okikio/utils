/** Request contracts and final cleanup receipts shared by thread and process transports. @module */
import * as codec from '@okikio/schema/codec';
import { descriptor } from './_session.ts';
import type { Contract } from '@okikio/schema/codec';
import * as context from '@okikio/context';
import type { Context, Owned, Snapshot } from '@okikio/context';
import * as failure from '@okikio/result/failure';
import type { Encoded as EncodedFailure } from '@okikio/result/failure';
import * as fault from '@okikio/result/fault';
import * as schema from '@okikio/schema';
import { AsyncDisposableStack, SuppressedError } from '@okikio/dispose';

/** One reverse request made from active remote work back to its host. */
export interface Call<Request, Response> {
	/** Validate the request at each receiving transport. */
	readonly request: Contract<unknown, Request>;
	/** Validate the reply at each receiving transport. */
	readonly response: Contract<unknown, Response>;
}

/** Shared schemas retain all five payload types across either transport. */
export interface Protocol<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
	extends Call<Request, Response> {
	/** Opt in to exact contract/version and mutual required-feature negotiation before payload encoding. Omission selects the legacy unnegotiated wire contract. */
	readonly compatibility?: CompatibilityType;
	/** Optional expected failure contract. Unexpected failures use bounded fault diagnostics. */
	readonly failure?: Contract<unknown, EncodedFailure>;
	/** Optional observations. Their delivery never supplies final completion authority. */
	readonly notice?: Contract<unknown, Notice>;
	/** Optional reverse request/reply pair, owned by the enclosing request. */
	readonly call?: Call<CallRequest, CallResponse>;
}

/** Parent request identity and a portable execution-context snapshot. */
export interface Request<Value> {
	readonly type: 'request';
	readonly id: string;
	readonly context: Snapshot;
	readonly request: Value;
}

/** Cancellation and cooperative placement controls common to both transports. */
export type Control<Response = unknown> =
	| Readonly<{ readonly type: 'cancel'; readonly id: string; readonly reason?: unknown }>
	| Readonly<{ readonly type: 'pause' | 'resume'; readonly id: string }>
	| Readonly<
		{ readonly type: 'call-result'; readonly id: string; readonly callId: string; readonly response: Response }
	>
	| Readonly<{ readonly type: 'call-fault'; readonly id: string; readonly callId: string; readonly fault: unknown }>;

/** A terminal receipt is emitted only after the request's owned cleanup has settled. */
export type Completion<Value> =
	| Readonly<{ readonly type: 'result'; readonly value: Value }>
	| Readonly<{ readonly type: 'failure'; readonly failure: unknown }>
	| Readonly<{ readonly type: 'fault'; readonly fault: unknown }>
	| Readonly<{ readonly type: 'cancelled' }>;

/** Shared response messages. A result, failure, fault or cancelled frame is also the release receipt. */
export type Response<Value, Notice = unknown, CallRequest = unknown> =
	| Readonly<{ readonly type: 'result'; readonly id: string; readonly response: Value }>
	| Readonly<{ readonly type: 'failure'; readonly id: string; readonly failure: unknown }>
	| Readonly<{ readonly type: 'fault'; readonly id?: string; readonly fault: unknown }>
	| Readonly<{ readonly type: 'cancelled'; readonly id: string }>
	| Readonly<{ readonly type: 'notice'; readonly id: string; readonly notice: Notice }>
	| Readonly<{ readonly type: 'call'; readonly id: string; readonly callId: string; readonly request: CallRequest }>;

/** Check all schema capabilities before either transport starts accepting work. */
export function define<Request, Response, Notice = never, CallRequest = never, CallResponse = never>(
	input: Protocol<Request, Response, Notice, CallRequest, CallResponse>,
): Protocol<Request, Response, Notice, CallRequest, CallResponse> {
	schema.assert(codec.input(input.request), 'request schema');
	schema.assert(codec.input(input.response), 'response schema');
	if (input.failure !== undefined) schema.assert(codec.input(input.failure), 'failure schema');
	if (input.notice !== undefined) schema.assert(codec.input(input.notice), 'notice schema');
	if (input.call !== undefined) {
		schema.assert(codec.input(input.call.request), 'reverse-call request schema');
		schema.assert(codec.input(input.call.response), 'reverse-call response schema');
	}
	return Object.freeze({
		...input,
		...(input.compatibility === undefined ? {} : { compatibility: descriptor(input.compatibility) }),
		...(input.call === undefined ? {} : { call: Object.freeze({ ...input.call }) }),
	});
}

/**
 * Join owned work and cleanup before returning a transport receipt. Cancellation
 * alone never makes a host reusable. A noncooperative operation must be retired
 * by the transport owner under its bounded shutdown policy.
 */
export async function settle<Value>(
	ctx: Owned,
	operation: () => Value | Promise<Value>,
	release: () => void,
	failureSchema?: Contract<unknown, EncodedFailure>,
): Promise<Completion<Value>> {
	// Register the context first so correlation release runs before its cleanup.
	// A release failure cannot skip deferred work, and this receipt joins all of it.
	const resources = new AsyncDisposableStack();
	resources.use(ctx);
	resources.defer(release);
	let completion: Completion<Value>;
	let failed = false;
	let operationError: unknown;
	try {
		context.check(ctx);
		const value = await operation();
		context.check(ctx);
		completion = { type: 'result', value };
	} catch (error) {
		failed = true;
		operationError = error;
		if (ctx.signal.aborted) completion = { type: 'cancelled' };
		else if (failure.isOccurrence(error)) {
			try {
				const encoded = await failure.encode(error);
				completion = {
					type: 'failure',
					failure: failureSchema === undefined ? encoded : await codec.write(failureSchema, encoded),
				};
			} catch (encodingError) {
				completion = { type: 'fault', fault: fault.encode(encodingError) };
			}
		} else completion = { type: 'fault', fault: fault.encode(error) };
	}
	try {
		await resources.disposeAsync();
	} catch (error) {
		completion = {
			type: 'fault',
			fault: fault.encode(
				failed ? new SuppressedError(error, operationError, 'Request work and cleanup failed.') : error,
			),
		};
	}
	return completion;
}

/** Cooperative checkpoints retain one bounded set of waiting continuations per request. */
export interface Pause {
	paused: boolean;
	readonly waiters: Set<() => void>;
}

/** Release one pause generation on resume, cancellation or final cleanup. */
export function resume(state: Pause): void {
	state.paused = false;
	for (const release of state.waiters) release();
	state.waiters.clear();
}

/** Await a cooperative checkpoint without claiming to preempt running JavaScript. */
export function wait(ctx: Context, state: Pause): Promise<void> {
	if (!state.paused) return Promise.resolve();
	return context.waitFor(ctx, (release) => {
		if (!state.paused) {
			release();
			return () => {};
		}
		state.waiters.add(release);
		return () => {
			state.waiters.delete(release);
		};
	});
}

/** Bounded public protocol identity. This proves compatibility, never peer authentication or authorization. */
export interface CompatibilityType {
	/** Stable application protocol identity, 1–128 ASCII identifier characters. */
	readonly contract: string;
	/** Positive safe integer wire revision; both peers must match exactly. */
	readonly version: number;
	/** Features this peer can perform, at most 32 unique bounded identifiers. */
	readonly features: readonly string[];
	/** Features this peer requires from the other side, at most 32 unique bounded identifiers. */
	readonly required: readonly string[];
}

/** Opt-in logical payload budget. The native transport's queue, allocation overhead and serialized context overhead beyond this model are not a heap quota. */
export interface PayloadBudgetType {
	/** Maximum logical bytes in one input/encoded/control/returned message. */
	readonly maximumMessageBytes: number;
	/** Maximum sum of retained RPC request liabilities and currently decoding/writing messages. */
	readonly maximumInFlightBytes: number;
	/** Maximum graph values visited per size measurement; repeated backing stores charge once per message. */
	readonly maximumNodes: number;
	/** Maximum nested container depth in the measuring traversal. Defaults to 128; no unbounded recursive walk. */
	readonly maximumDepth?: number;
}
