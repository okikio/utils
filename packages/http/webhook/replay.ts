/** Authenticate before atomic replay admission; the service owns the store's durability and namespace. @module */
import type { WebhookVerificationInput, WebhookVerificationResult, WebhookVerifier } from './types.ts';

/** Cross-request admission authority. A service must choose the required process/region consistency. */
export interface ReplayStore {
	/**
	 * Atomically admit identity only if it is absent or expired. Return true for exactly one contender.
	 * Retain successful admission until expiresAt (exclusive epoch milliseconds), without early eviction.
	 * Storage time must use the same clock policy as verification. A fault must throw, never return true.
	 */
	claim(identity: string, expiresAt: number): boolean | Promise<boolean>;
}
/** Additional replay validity window, applied after successful protocol authentication. */
export interface ReplayOptions {
	/** Borrowed atomic store. This wrapper never closes or clears it. */
	readonly store: ReplayStore;
	/** Stable receiver/protocol namespace; reuse across replicas receiving the same logical messages. */
	readonly namespace: string;
	/** Exact UTF-8 bound on the encoded [namespace, authenticated ID] store identity. */
	readonly maximumIdentityBytes: number;
	/** Maximum accepted age in whole seconds; the timestamp's final valid second is inclusive. */
	readonly maximumAgeSeconds: number;
	/** Maximum permitted future timestamp in whole seconds. */
	readonly maximumFutureSeconds: number;
}

/**
 * Authenticate a webhook, then atomically admit its message ID once.
 * Pass the original bytes and headers to the verifier first. Only an authenticated
 * message within the allowed time window reaches the replay store. A duplicate
 * returns code `duplicate`; a store failure rejects instead of admitting the message.
 *
 * Retain the ID through the last valid second, including that second's fractional
 * remainder. The wrapper borrows the store and does not close it or retry its writes.
 *
 * Admission is not proof that the application applied the event. A crash between
 * admission and the business write can lose a delivery. To close that gap, the
 * application must commit its inbox admission and business change together.
 */
export function protect(verifier: WebhookVerifier, options: ReplayOptions): WebhookVerifier {
	const { namespace, maximumIdentityBytes, maximumAgeSeconds, maximumFutureSeconds } = options;
	if (typeof verifier?.verify !== 'function' || typeof options.store?.claim !== 'function') {
		throw new TypeError('Replay protection requires verifier and atomic store capabilities.');
	}
	if (
		typeof namespace !== 'string' || !namespace ||
		!Number.isSafeInteger(maximumIdentityBytes) || maximumIdentityBytes < 1 ||
		!Number.isSafeInteger(maximumAgeSeconds) || maximumAgeSeconds < 0 ||
		!Number.isSafeInteger(maximumFutureSeconds) || maximumFutureSeconds < 0
	) throw new RangeError('Invalid replay namespace or validity bounds.');
	const encoder = new TextEncoder();
	if (
		namespace.length > maximumIdentityBytes ||
		encoder.encode(JSON.stringify([namespace, ''])).byteLength > maximumIdentityBytes
	) throw new RangeError('Replay namespace exceeds identity limit.');
	const verify = verifier.verify.bind(verifier);
	const claim = options.store.claim.bind(options.store);
	return Object.freeze({
		/** Authenticate before reserving identity so invalid messages cannot spend replay-store entries. */
		async verify(input: WebhookVerificationInput): Promise<WebhookVerificationResult> {
			const instant = input.now.getTime();
			if (!Number.isSafeInteger(instant)) throw new TypeError('Replay verification requires a valid millisecond Date.');
			const authenticated = await verify(input);
			if (!authenticated.ok) return authenticated;
			const { timestamp, id } = authenticated;
			if (!Number.isSafeInteger(timestamp) || timestamp < 0 || typeof id !== 'string' || !id) {
				throw new TypeError('Verifier returned invalid authenticated identity or timestamp.');
			}
			const seconds = Math.floor(instant / 1000);
			if (timestamp < seconds - maximumAgeSeconds) return Object.freeze({ ok: false, code: 'timestamp-too-old' });
			if (timestamp > seconds + maximumFutureSeconds) return Object.freeze({ ok: false, code: 'timestamp-too-new' });
			// The last accepted second is inclusive. Expire at the next second, not at the start of that last second.
			const expiresAt = (timestamp + maximumAgeSeconds + 1) * 1000;
			if (!Number.isSafeInteger(expiresAt)) throw new RangeError('Replay retention exceeds safe epoch milliseconds.');
			if (id.length > maximumIdentityBytes) {
				throw new RangeError('Authenticated replay identity exceeds its byte limit.');
			}
			const identity = JSON.stringify([namespace, id]);
			if (encoder.encode(identity).byteLength > maximumIdentityBytes) {
				throw new RangeError('Authenticated replay identity exceeds its byte limit.');
			}
			const admitted = await claim(identity, expiresAt);
			if (typeof admitted !== 'boolean') throw new TypeError('Replay store returned a non-boolean admission result.');
			return admitted ? authenticated : Object.freeze({ ok: false, code: 'duplicate' });
		},
	});
}
