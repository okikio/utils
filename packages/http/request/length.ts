import { RequestTransportError } from './types.ts';

/**
 * Parses one Content-Length field using the HTTP decimal-integer grammar.
 *
 * `undefined` means the field is absent. Malformed, negative, fractional,
 * exponential, or unsafe integer values are rejected instead of being treated
 * as an unknown length.
 */
export function parseContentLength(value: string | null): number | undefined {
	if (value === null) return undefined;
	if (!/^\d+$/.test(value)) throw invalidContentLength();
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) throw invalidContentLength();
	return parsed;
}

/** Creates the structured transport failure used for malformed Content-Length fields. */
function invalidContentLength(): RequestTransportError {
	return new RequestTransportError({
		code: 'invalid-content-length',
		message: 'Content-Length must be a non-negative decimal integer within the JavaScript safe-integer range.',
		path: ['header', 'content-length'],
	});
}
