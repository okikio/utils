/**
 * Authenticate the exact received bytes while keeping the original request available to its parser.
 *
 * The fixed test key and clock make this example reproducible. A real application supplies secrets and replay policy. Verify before parsing, then add key rotation and bounded raw-body admission; delivery retries and deduplication belong to the receiving service.
 *
 * @example
 * ```ts
 * import * as webhook from '@okikio/http/webhook';
 * import * as standard from '@okikio/http/webhook/standard';
 * const verifier = standard.create({ secret: 'whsec_' + btoa(String.fromCharCode(...new Uint8Array(32).fill(1))) });
 * const body = '{"ok":true}';
 * const headers = await verifier.sign({ id: 'event-1', timestamp: 1000, body });
 * const request = new Request('https://service.invalid/webhook', { method: 'POST', headers, body });
 * const verified = await webhook.verifyRequest(request, verifier, { now: new Date(1000_000) });
 * console.log(verified.ok, (await request.json()).ok);
 * ```
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
	if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
		throw new TypeError('Webhook verification now must be a valid Date.');
	}
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

/** Symmetric Standard Webhooks signing, verification, key rotation and bounded admission. */
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
