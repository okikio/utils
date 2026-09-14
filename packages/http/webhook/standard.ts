/** Standard Webhooks v1 symmetric signing and verification. @module */
import { decodeBase64, encodeBase64 } from '@std/encoding/base64';
import type {
	WebhookPayload,
	WebhookVerificationFailureCode,
	WebhookVerificationInput,
	WebhookVerificationResult,
	WebhookVerifier,
} from './types.ts';

const encoder = new TextEncoder();
const timestampPattern = /^\d+$/;
const whitespaceOrControlPattern = /[\u0000-\u0020\u007f]/;
const defaultToleranceSeconds = 300;
const defaultMaximumSignatures = 10;
const defaultMaximumSignatureHeaderBytes = 8192;
const defaultMaximumKeys = 10;
const defaultMaximumIdBytes = 256;
const minimumSecretBytes = 24;
const maximumSecretBytes = 64;
const signatureBytes = 32;

/**
 * Security and work bounds used by one Standard Webhooks signer/verifier.
 *
 * Supply either `secret` or `secrets`. Multiple secrets support key rotation.
 * The implementation caps configured keys and accepted signatures so one
 * request cannot increase HMAC work without a declared limit.
 */
export interface StandardWebhookOptions {
	readonly secret?: string;
	readonly secrets?: readonly string[];
	readonly toleranceSeconds?: number;
	readonly maximumSignatures?: number;
	readonly maximumSignatureHeaderBytes?: number;
	readonly maximumKeys?: number;
	readonly maximumIdBytes?: number;
}

/**
 * Exact message identity and payload used for one outbound signature.
 *
 * `body` must be the same bytes later transmitted. A `Date` or epoch-seconds
 * value controls the signed timestamp. If `timestamp` is absent, signing uses
 * the current time.
 */
export interface SignStandardWebhookOptions {
	readonly id: string;
	readonly body: WebhookPayload;
	readonly timestamp?: number | Date;
}

/** Headers emitted by Standard Webhooks v1 signing. */
export type StandardWebhookHeaders = Readonly<{
	readonly 'webhook-id': string;
	readonly 'webhook-timestamp': string;
	readonly 'webhook-signature': string;
}>;

/** Configured Standard Webhooks v1 verifier and signer. */
export interface StandardWebhook extends WebhookVerifier {
	sign(options: SignStandardWebhookOptions): Promise<StandardWebhookHeaders>;
}

/** Create one reusable Standard Webhooks v1 symmetric protocol instance. */
export function create(options: StandardWebhookOptions): StandardWebhook {
	if (typeof options !== 'object' || options === null || Array.isArray(options)) throw new TypeError('Standard Webhooks options must be an object.');
	const maximumKeys = positive(options.maximumKeys ?? defaultMaximumKeys, 'maximumKeys');
	if (maximumKeys > defaultMaximumKeys) throw new TypeError(`maximumKeys may not exceed ${defaultMaximumKeys}.`);
	const secretValues = normalizeSecrets(options, maximumKeys);
	const toleranceSeconds = nonNegative(options.toleranceSeconds ?? defaultToleranceSeconds, 'toleranceSeconds');
	const maximumSignatures = positive(options.maximumSignatures ?? defaultMaximumSignatures, 'maximumSignatures');
	if (maximumSignatures > defaultMaximumSignatures) throw new TypeError(`maximumSignatures may not exceed ${defaultMaximumSignatures}.`);
	const maximumSignatureHeaderBytes = positive(options.maximumSignatureHeaderBytes ?? defaultMaximumSignatureHeaderBytes, 'maximumSignatureHeaderBytes');
	const maximumIdBytes = positive(options.maximumIdBytes ?? defaultMaximumIdBytes, 'maximumIdBytes');
	const keys = secretValues.map((secret) => globalThis.crypto.subtle.importKey(
		'raw', buffer(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
	));

	return Object.freeze({
		async verify(input: WebhookVerificationInput): Promise<WebhookVerificationResult> {
			assertVerificationInput(input);
			const id = input.headers.get('webhook-id');
			const timestampValue = input.headers.get('webhook-timestamp');
			const signatureHeader = input.headers.get('webhook-signature');
			if (id === null || timestampValue === null || signatureHeader === null) return failure('missing-header');
			if (!validId(id, maximumIdBytes)) return failure('malformed-id');
			const timestamp = parseTimestamp(timestampValue);
			if (timestamp === undefined) return failure('malformed-timestamp');
			const nowSeconds = Math.floor(input.now.getTime() / 1000);
			if (timestamp < nowSeconds - toleranceSeconds) return failure('timestamp-too-old');
			if (timestamp > nowSeconds + toleranceSeconds) return failure('timestamp-too-new');
			if (encoder.encode(signatureHeader).byteLength > maximumSignatureHeaderBytes) return failure('signature-header-too-large');
			const rawSignatures = signatureHeader.split(' ').filter((value) => value.length > 0);
			if (rawSignatures.length > maximumSignatures) return failure('too-many-signatures');
			const signatures: Uint8Array[] = [];
			for (const raw of rawSignatures) {
				if (!raw.startsWith('v1,')) continue;
				const value = decodeSignature(raw.slice(3));
				if (value === undefined) return failure('malformed-signature');
				signatures.push(value);
			}
			if (signatures.length === 0) return failure('malformed-signature');
			const message = signedBytes(id, timestampValue, input.body);
			for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
				const key = await keys[keyIndex]!;
				for (const signature of signatures) {
					if (await globalThis.crypto.subtle.verify('HMAC', key, buffer(signature), buffer(message))) {
						return Object.freeze({ ok: true, id, timestamp, version: 'v1', keyIndex });
					}
				}
			}
			return failure('invalid-signature');
		},
		async sign(input: SignStandardWebhookOptions): Promise<StandardWebhookHeaders> {
			if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError('Standard Webhooks sign options must be an object.');
			if (!validId(input.id, maximumIdBytes)) throw new TypeError('Webhook id must be non-empty, bounded, and contain no whitespace, control characters, or full stop.');
			const timestamp = signTimestamp(input.timestamp);
			const timestampValue = String(timestamp);
			const body = payloadBytes(input.body);
			const message = signedBytes(input.id, timestampValue, body);
			const signatures = await Promise.all(keys.map(async (key) => {
				const value = await globalThis.crypto.subtle.sign('HMAC', await key, buffer(message));
				return `v1,${encodeBase64(new Uint8Array(value))}`;
			}));
			return Object.freeze({
				'webhook-id': input.id,
				'webhook-timestamp': timestampValue,
				'webhook-signature': signatures.join(' '),
			});
		},
	});
}

function normalizeSecrets(options: StandardWebhookOptions, maximumKeys: number): readonly Uint8Array[] {
	if (options.secret !== undefined && options.secrets !== undefined) throw new TypeError('Provide secret or secrets, not both.');
	const values = options.secrets ?? (options.secret === undefined ? [] : [options.secret]);
	if (!Array.isArray(values) || values.length === 0) throw new TypeError('At least one Standard Webhooks secret is required.');
	if (values.length > maximumKeys) throw new TypeError(`At most ${maximumKeys} Standard Webhooks keys are allowed.`);
	return Object.freeze(values.map((secret) => decodeSecret(secret)));
}

function decodeSecret(secret: string): Uint8Array {
	if (typeof secret !== 'string') throw new TypeError('Standard Webhooks secrets must be strings.');
	const encoded = secret.startsWith('whsec_') ? secret.slice(6) : secret;
	let value: Uint8Array;
	try { value = decodeBase64(encoded); } catch { throw new TypeError('Standard Webhooks secret must be valid base64.'); }
	if (value.byteLength < minimumSecretBytes || value.byteLength > maximumSecretBytes) {
		throw new TypeError(`Standard Webhooks secret must decode to ${minimumSecretBytes}-${maximumSecretBytes} bytes.`);
	}
	return value;
}

function validId(id: string, maximumBytes: number): boolean {
	return id.length > 0 && !id.includes('.') && !whitespaceOrControlPattern.test(id) && encoder.encode(id).byteLength <= maximumBytes;
}

function parseTimestamp(value: string): number | undefined {
	if (!timestampPattern.test(value)) return undefined;
	const timestamp = Number(value);
	return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : undefined;
}

function signTimestamp(value: number | Date | undefined): number {
	const timestamp = value instanceof Date ? Math.floor(value.getTime() / 1000) : value ?? Math.floor(Date.now() / 1000);
	if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new TypeError('Webhook timestamp must be a positive safe integer number of seconds.');
	return timestamp;
}

function payloadBytes(payload: WebhookPayload): Uint8Array {
	if (typeof payload === 'string') return encoder.encode(payload);
	if (!(payload instanceof Uint8Array)) throw new TypeError('Webhook body must be a string or Uint8Array.');
	return payload;
}

function signedBytes(id: string, timestamp: string, body: Uint8Array): Uint8Array {
	const prefix = encoder.encode(`${id}.${timestamp}.`);
	const value = new Uint8Array(prefix.byteLength + body.byteLength);
	value.set(prefix, 0); value.set(body, prefix.byteLength);
	return value;
}

/** Copy bytes into an owned ArrayBuffer accepted by current Web Crypto definitions. */
function buffer(value: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(value.byteLength);
	copy.set(value);
	return copy.buffer;
}

function decodeSignature(value: string): Uint8Array | undefined {
	try {
		const decoded = decodeBase64(value);
		return decoded.byteLength === signatureBytes ? decoded : undefined;
	} catch { return undefined; }
}

function assertVerificationInput(input: WebhookVerificationInput): void {
	if (typeof input !== 'object' || input === null || !(input.body instanceof Uint8Array) || !(input.headers instanceof Headers) || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
		throw new TypeError('Webhook verification input must contain Uint8Array body, Headers, and a valid Date.');
	}
}

function failure(code: WebhookVerificationFailureCode): WebhookVerificationResult {
	return Object.freeze({ ok: false, code });
}
function positive(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer.`); return value;
}
function nonNegative(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer.`); return value;
}
