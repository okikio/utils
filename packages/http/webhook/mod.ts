/**
 * Check a signed provider message before reading its event fields.
 * A webhook is an HTTP request another service sends to announce an event. Its signature
 * covers the original bytes, so JSON parsing and reformatting must not happen first.
 *
 * verifyRequest() reads a bounded clone and leaves the original request available for parsing.
 * A successful signature check establishes message authenticity under the chosen verifier;
 * it does not prove that this delivery is new or that the business action completed.
 *
 * The fixed local key and clock make the example reproducible. A real host supplies secrets,
 * key rotation and a replay policy. The receiving application owns retries, duplicate event
 * handling and the persistent business write.
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
 * The clone is buffered within maximumBodyBytes; cloning tees the body and can
 * buffer bytes for the unread original. This helper does not authenticate the
 * destination, claim replay identity or commit an application effect.
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

/** Authenticate before caller-owned atomic replay admission. */
export { protect } from './replay.ts';
export type { ReplayOptions, ReplayStore } from './replay.ts';
