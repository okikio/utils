import * as contextCore from '@okikio/context';
import type { Context } from '@okikio/context';
import type { Encoded as EncodedFailure } from '@okikio/failure';

import type {
	QueueAddOptions,
	QueueClaim,
	QueueClaimOptions,
	FifoQueue,
	FifoQueueOptions,
	Queue,
	QueueRef,
	QueueRetryOptions,
	QueueClaimHandle,
	QueueTakeOptions,
} from './types.ts';

/**
 * Create a FIFO-friendly adapter over a claimed-work queue.
 *
 * The adapter keeps the same queue rules under the hood.
 * The public surface becomes smaller for callers that want one item at a time.
 * `take()` wraps `claim({ limit: 1 })`.
 * Each taken item wraps `complete()`, `fail()`, `retry()`, and `renew()`.
 *
 * The adapter owns one internal context.
 * Callers can use FIFO-style queue calls without passing `ctx` through each
 * step. Recovery, expiry, stale-claim rejection, and result waiting still come
 * from the underlying claimed-work queue.
 */
export function fifo<Input, Output>(queue: Queue<Input, Output>, options: FifoQueueOptions = {}): FifoQueue<Input, Output> {
	const owner = contextCore.create({
		id: options.id ?? 'fifo',
		...(options.signal === undefined ? {} : { signal: options.signal }),
		...(options.clock === undefined ? {} : { clock: options.clock }),
	});
	const claimOwner = options.owner ?? owner.id;

	return Object.freeze({
		events: queue.events,
		/** Add one item through the adapter-owned context. */
		add(input: Input, addOptions?: QueueAddOptions) {
			return queue.add(owner, input, addOptions);
		},
		/**
		 * Take at most one eligible item and wrap the resulting claim.
		 *
		 * `limit: 1` keeps the adapter aligned with ordinary one-at-a-time queue
		 * usage. Callers that need batch claiming can use the lower-level queue
		 * directly.
		 */
		async take(takeOptions: QueueTakeOptions = {}) {
			const [claim] = await queue.claim(owner, Object.freeze({ ...takeOptions, owner: claimOwner, limit: 1 }) satisfies QueueClaimOptions);
			return claim === undefined ? undefined : taken(queue, owner, claim);
		},
		/** Cancel one item through the adapter-owned context. */
		cancel(ref: QueueRef, reason?: unknown) {
			return queue.cancel(owner, ref, reason);
		},
		/** Wait for one result through the adapter-owned context. */
		result(ref: QueueRef) {
			return queue.result(owner, ref);
		},
		/** Reuse the underlying queue stats snapshot. */
		stats() {
			return queue.stats();
		},
		/** Close the underlying claimed-work queue. */
		close(reason?: unknown) {
			return queue.close(reason);
		},
		/** Async disposal closes the queue and then disposes the adapter-owned context. */
		async [Symbol.asyncDispose]() {
			try {
				await queue[Symbol.asyncDispose]();
			} finally {
				await owner[Symbol.asyncDispose]();
			}
		},
	});
}

/**
 * Wrap one claim in a FIFO-friendly taken-item handle.
 *
 * The handle keeps immutable claim fields visible for inspection while turning
 * later queue calls into item-local methods. `renew()` returns a fresh handle
 * because the renewed claim carries a new expiry time.
 */
function taken<Input, Output>(queue: Queue<Input, Output>, owner: Context, claim: QueueClaim<Input>): QueueClaimHandle<Input, Output> {
	const handle: QueueClaimHandle<Input, Output> = Object.freeze({
		id: claim.id,
		itemId: claim.itemId,
		owner: claim.owner,
		value: claim.value,
		attempt: claim.attempt,
		claimedAt: claim.claimedAt,
		expiresAt: claim.expiresAt,
		/** Complete the wrapped claim through the adapter-owned context. */
		complete(output: Output) {
			return queue.complete(owner, claim, output);
		},
		/** Fail the wrapped claim through the adapter-owned context. */
		fail(value: EncodedFailure) {
			return queue.fail(owner, claim, value);
		},
		/** Return the wrapped claim to the queue for another attempt. */
		retry(options?: QueueRetryOptions) {
			return queue.retry(owner, claim, options);
		},
		/** Renew the wrapped claim and return a new taken-item handle. */
		async renew(duration: Temporal.Duration | Temporal.DurationLike | string) {
			return taken(queue, owner, await queue.renew(owner, claim, duration));
		},
		async [Symbol.asyncDispose]() {
			// The FIFO adapter does not choose a terminal action implicitly.
		},
	});
	return handle;
}