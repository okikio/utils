import * as recordCore from '@okikio/collection/record';
import type { ParsedAuthorization, SensitiveCredential } from './types.ts';
import { RequestTransportError } from './types.ts';

const schemePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Keep an authorization secret out of ordinary string and JSON rendering.
 * Only reveal() returns the original text. Parsing this wrapper does not verify
 * the secret, and an explicit reveal transfers logging responsibility to its caller.
 *
 * @internal
 */
class Credential implements SensitiveCredential {
	readonly #value: string;
	/** Retain the secret privately; freezing the wrapper does not authenticate it. */
	constructor(value: string) {
		this.#value = value;
		Object.freeze(this);
	}
	/**
	 * Return the original credential to a caller that explicitly asks for it. Never log this return value.
	 *
	 * @internal
	 */
	reveal(): string {
		return this.#value;
	}
	/**
	 * Return a fixed redaction marker during string interpolation; never include the credential.
	 *
	 * @internal
	 */
	toString(): '[REDACTED]' {
		return '[REDACTED]';
	}
	/**
	 * Return a fixed redaction marker during JSON serialization; never include the credential.
	 *
	 * @internal
	 */
	toJSON(): '[REDACTED]' {
		return '[REDACTED]';
	}
}

/** Parse Authorization syntax without verifying the credential or establishing identity. */
export function parseAuthorization(
	value: string | null,
	options: { readonly allowedSchemes?: readonly string[] } = {},
): ParsedAuthorization | undefined {
	recordCore.assert(options, 'authorization options');
	const allowedSchemes = options.allowedSchemes;
	if (allowedSchemes !== undefined) assertStringList(allowedSchemes, 'allowed authorization schemes');
	if (value === null || value.trim() === '') return undefined;
	if (/\0|\r|\n/.test(value)) {
		throw new RequestTransportError({
			code: 'invalid-authorization',
			message: 'Authorization contains a forbidden control character.',
			path: ['header', 'authorization'],
		});
	}
	const match = /^([^\s]+)[ \t]+([^\s].*)$/.exec(value);
	if (!match || !schemePattern.test(match[1]!)) {
		throw new RequestTransportError({
			code: 'invalid-authorization',
			message: 'Authorization must contain a valid scheme and credential.',
			path: ['header', 'authorization'],
		});
	}
	const scheme = match[1]!;
	const credential = match[2]!.trim();
	if (credential.length === 0 || /[\r\n]/.test(credential)) {
		throw new RequestTransportError({
			code: 'invalid-authorization',
			message: 'Authorization credential is empty or malformed.',
			path: ['header', 'authorization'],
		});
	}
	// Scheme spelling is case-insensitive. Preserve the original spelling for
	// inspection while applying the allowlist to a normalized value.
	const normalizedScheme = scheme.toLowerCase();
	if (allowedSchemes && !allowedSchemes.some((candidate) => candidate.toLowerCase() === normalizedScheme)) {
		throw new RequestTransportError({
			code: 'unsupported-authorization',
			message: `Authorization scheme ${JSON.stringify(scheme)} is not supported.`,
			path: ['header', 'authorization'],
		});
	}
	return Object.freeze({ scheme, normalizedScheme, credential: new Credential(credential) });
}

/** Validate a dense string list without invoking accessor-backed array elements. @internal */
function assertStringList(value: unknown, name: string): asserts value is readonly string[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array of strings.`);
	for (let index = 0; index < value.length; index++) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string') {
			throw new TypeError(`${name} must contain dense string data elements.`);
		}
		if (!schemePattern.test(descriptor.value)) throw new TypeError(`${name} contains an invalid HTTP auth scheme.`);
	}
}
