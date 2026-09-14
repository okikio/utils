/** Raw payload accepted by webhook signing operations. */
export type WebhookPayload = string | Uint8Array;

/** Stable failures produced while authenticating a webhook request. */
export type WebhookVerificationFailureCode =
	| 'body-too-large'
	| 'invalid-content-length'
	| 'missing-header'
	| 'malformed-id'
	| 'malformed-timestamp'
	| 'timestamp-too-old'
	| 'timestamp-too-new'
	| 'signature-header-too-large'
	| 'too-many-signatures'
	| 'malformed-signature'
	| 'invalid-signature';

/** Successful webhook authentication result. */
export interface WebhookVerificationSuccess {
	readonly ok: true;
	readonly id: string;
	readonly timestamp: number;
	readonly version: string;
	/** Index of the configured verification key that authenticated the message. */
	readonly keyIndex: number;
}

/** Authentication failure safe to branch on without exposing signed material. */
export interface WebhookVerificationFailure {
	readonly ok: false;
	readonly code: WebhookVerificationFailureCode;
}

/** Result returned by a webhook verifier. */
export type WebhookVerificationResult = WebhookVerificationSuccess | WebhookVerificationFailure;

/** Exact request material supplied to a protocol-specific webhook verifier. */
export interface WebhookVerificationInput {
	readonly body: Uint8Array;
	readonly headers: Headers;
	readonly now: Date;
}

/** Framework-neutral webhook authenticator. */
export interface WebhookVerifier {
	verify(input: WebhookVerificationInput): WebhookVerificationResult | Promise<WebhookVerificationResult>;
}

/** Bounded raw-request policy used before application parsing or validation. */
export interface VerifyRequestOptions {
	/** Maximum signed request body accepted in bytes. Defaults to 1 MiB. */
	readonly maximumBodyBytes?: number;
	/** Clock supplied for deterministic verification and testing. */
	readonly now?: Date;
}
