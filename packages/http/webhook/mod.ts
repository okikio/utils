/**
 * Framework-neutral webhook authentication over exact HTTP request bytes.
 *
 * Inbound application behavior remains an endpoint responsibility. Outbound delivery
 * policy (subscriptions, persistence, retry, replay, dead letters) belongs to a
 * higher-level capability if/when the repository owns those semantics.
 *
 * @module
 */
import { readBody, RequestTransportError } from '../request/mod.ts';
import type { VerifyRequestOptions, WebhookVerificationResult, WebhookVerifier } from './types.ts';

const defaultMaximumBodyBytes = 1024 * 1024;

/**
 * Authenticate a bounded clone of a Web Request without consuming the original.
 *
 * This is intended for `beforeValidation`-style middleware. Signature
 * verification observes exact bytes first; ordinary parsing and Standard Schema
 * validation can then consume a separate clone or the original request.
 */
export async function verifyRequest(
	request: Request,
	verifier: WebhookVerifier,
	options: VerifyRequestOptions = {},
): Promise<WebhookVerificationResult> {
	if (!(request instanceof Request)) throw new TypeError('Webhook verification requires a Web Request.');
	if (typeof verifier !== 'object' || verifier === null || typeof verifier.verify !== 'function') {
		throw new TypeError('Webhook verifier must expose verify(input).');
	}
	const maximumBodyBytes = options.maximumBodyBytes ?? defaultMaximumBodyBytes;
	if (!Number.isSafeInteger(maximumBodyBytes) || maximumBodyBytes < 1) {
		throw new TypeError('maximumBodyBytes must be a positive safe integer.');
	}
	const now = options.now ?? new Date();
	if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('Webhook verification now must be a valid Date.');
	let body: Uint8Array;
	try {
		body = await readBody(request.clone(), { maximumBodyBytes });
	} catch (error) {
		if (error instanceof RequestTransportError) {
			const code = error.issues[0]?.code;
			if (code === 'body-too-large' || code === 'invalid-content-length') return Object.freeze({ ok: false, code });
		}
		throw error;
	}
	// Keep verifier failures distinct from request-read failures. An implementation
	// exception is a programmer/runtime fault and must not be mislabeled as an
	// authentication rejection.
	return await verifier.verify(Object.freeze({ body, headers: request.headers, now }));
}

export * as standard from './standard.ts';
export type {
	VerifyRequestOptions,
	WebhookPayload,
	WebhookVerificationFailure,
	WebhookVerificationFailureCode,
	WebhookVerificationInput,
	WebhookVerificationResult,
	WebhookVerificationSuccess,
	WebhookVerifier,
} from './types.ts';
