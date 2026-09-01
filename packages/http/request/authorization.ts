import * as recordCore from '@okikio/record';
import type { ParsedAuthorization, SensitiveCredential } from './types.ts';
import { RequestTransportError } from './types.ts';

const schemePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Owns the internal credential state used by HTTP request normalization.
 *
 * Request internals normalize untrusted protocol metadata before endpoint and service composition consume it.
 *
 * @internal
 */
class Credential implements SensitiveCredential {
	readonly #value: string;
	constructor(value: string) { this.#value = value; Object.freeze(this); }
	/**
	 * Reveals a secret authorization credential only inside the parser operation that has explicit authority to inspect it.
	 *
	 * @internal
	 */
	reveal(): string { return this.#value; }
	/**
	 * Converts the source value to string expected by HTTP request normalization.
	 *
	 * @internal
	 */
	toString(): '[REDACTED]' { return '[REDACTED]'; }
	/**
	 * Converts the source value to json expected by HTTP request normalization.
	 *
	 * @internal
	 */
	toJSON(): '[REDACTED]' { return '[REDACTED]'; }
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
	if (/\0|\r|\n/.test(value)) throw new RequestTransportError({ code: 'invalid-authorization', message: 'Authorization contains a forbidden control character.', path: ['header', 'authorization'] });
	const match = /^([^\s]+)[ \t]+([^\s].*)$/.exec(value);
	if (!match || !schemePattern.test(match[1]!)) throw new RequestTransportError({ code: 'invalid-authorization', message: 'Authorization must contain a valid scheme and credential.', path: ['header', 'authorization'] });
	const scheme = match[1]!;
	const credential = match[2]!.trim();
	if (credential.length === 0 || /[\r\n]/.test(credential)) throw new RequestTransportError({ code: 'invalid-authorization', message: 'Authorization credential is empty or malformed.', path: ['header', 'authorization'] });
	const normalizedScheme = scheme.toLowerCase();
	if (allowedSchemes && !allowedSchemes.some((candidate) => candidate.toLowerCase() === normalizedScheme)) {
		throw new RequestTransportError({ code: 'unsupported-authorization', message: `Authorization scheme ${JSON.stringify(scheme)} is not supported.`, path: ['header', 'authorization'] });
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
