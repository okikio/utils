import * as problem from '@okikio/http/problem';
import * as response from '@okikio/http/response';

/** Materialize one logical RFC 9457 problem tuple as a native Response. */
export function problemResponse(result: problem.ProblemResult): Response {
	return new Response(JSON.stringify(result[0]), {
		status: result[1],
		headers: response.toHeaders(result[2]),
	});
}

/** Copy a response while replacing selected header fields without consuming its body. */
export function withHeaders(
	value: Response,
	set: response.HeaderInput = Object.freeze({}),
	remove: readonly string[] = [],
): Response {
	if (!(value instanceof Response)) throw new TypeError('HTTP response must be a Response.');
	const headers = new Headers(value.headers);
	for (const name of headerNameList(remove, 'removed response header names')) headers.delete(name);

	const replaced = new Set<string>();
	for (const [name, headerValue] of response.headerEntries(set)) {
		const lower = name.toLowerCase();
		if (!replaced.has(lower)) {
			headers.set(name, headerValue);
			replaced.add(lower);
		} else headers.append(name, headerValue);
	}

	return new Response(value.body, {
		status: value.status,
		statusText: value.statusText,
		headers,
	});
}

const fieldNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Snapshot one dense list of valid HTTP field names without invoking array accessors. @internal */
function headerNameList(values: readonly string[], name: string): readonly string[] {
	if (!Array.isArray(values)) throw new TypeError(`${name} must be an array of strings.`);
	const result: string[] = [];
	for (let index = 0; index < values.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
		if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string') {
			throw new TypeError(`${name} must contain dense string data elements.`);
		}
		if (!fieldNamePattern.test(descriptor.value)) throw new TypeError(`${name} contains an invalid HTTP field name.`);
		result.push(descriptor.value);
	}
	return Object.freeze(result);
}
