import { limits } from './limits.ts';
import type { RequestParsingOptions, WireRecord } from './types.ts';
import { RequestTransportError } from './types.ts';

/** Raw query source accepted by {@link parseQuery}. */
export type QueryInput = string | URLSearchParams;

/**
 * Preserve repeated query values without applying endpoint-specific schema semantics.
 *
 * A raw query string keeps one useful distinction that `URLSearchParams` loses:
 * `?flag` means the flag is present, while `?flag=` is an explicitly empty value.
 * Bare parameters use the configured `bareQueryParameters` policy. The default
 * `empty` policy emits an empty string; `flag` emits the string `"true"`; and
 * `reject` rejects bare syntax. Explicit values remain unchanged and repeated
 * occurrences preserve wire order.
 *
 * Pass the raw `URL.search` string when that distinction matters. Supplying an
 * already-created `URLSearchParams` keeps its native semantics, where `?flag`
 * and `?flag=` are both represented as an empty string.
 */
export function parseQuery(input: QueryInput, options: RequestParsingOptions = {}): WireRecord {
	const policy = limits(options);
	const barePolicy = options.bareQueryParameters ?? 'empty';
	if (barePolicy !== 'empty' && barePolicy !== 'flag' && barePolicy !== 'reject') {
		throw new TypeError('bareQueryParameters must be empty, flag, or reject.');
	}
	const values: Record<string, string[]> = Object.create(null);
	let count = 0;
	for (const [name, value] of queryEntries(input, barePolicy)) {
		count += 1;
		if (count > policy.maximumQueryParameters) throw new RequestTransportError({
			code: 'too-many-query-parameters', message: `At most ${policy.maximumQueryParameters} query parameters are allowed.`, path: ['query'],
		});
		if (name.length > policy.maximumParameterLength) throw new RequestTransportError({
			code: 'query-name-too-large', message: `Query parameter name exceeds ${policy.maximumParameterLength} characters.`, path: ['query', name],
		});
		if (value.length > policy.maximumQueryValueLength) throw new RequestTransportError({
			code: 'query-value-too-large', message: `Query parameter ${JSON.stringify(name)} exceeds ${policy.maximumQueryValueLength} characters.`, path: ['query', name],
		});
		(values[name] ??= []).push(value);
	}
	const result: Record<string, string | readonly string[]> = Object.create(null);
	for (const [name, fieldValues] of Object.entries(values)) result[name] = fieldValues.length === 1 ? fieldValues[0]! : Object.freeze(fieldValues);
	return Object.freeze(result);
}

/**
 * Decode query entries while retaining whether the caller authored an equals sign.
 *
 * WHATWG `URLSearchParams` remains the decoder so `+`, percent escapes, empty
 * names, and repeated values match the platform URL implementation. The raw
 * segment is used only to retain the bare-parameter signal that the parsed API
 * intentionally discards.
 *
 * @internal
 */
function* queryEntries(
	input: QueryInput,
	barePolicy: NonNullable<RequestParsingOptions['bareQueryParameters']>,
): Generator<readonly [string, string], void, undefined> {
	if (input instanceof URLSearchParams) {
		for (const entry of input.entries()) yield entry;
		return;
	}
	const source = input.startsWith('?') ? input.slice(1) : input;
	let start = 0;
	while (start <= source.length) {
		const separator = source.indexOf('&', start);
		const end = separator < 0 ? source.length : separator;
		const segment = source.slice(start, end);
		if (segment.length > 0) {
			const parsed = new URLSearchParams(segment);
			const first = parsed.entries().next();
			if (!first.done) {
				const [name, value] = first.value;
				const explicitValue = segment.includes('=');
				if (!explicitValue && barePolicy === 'reject') {
					throw new RequestTransportError({
						code: 'invalid-parameter',
						message: `Query parameter ${JSON.stringify(name)} requires an explicit value.`,
						path: ['query', name],
					});
				}
				let parsedValue = '';
				if (explicitValue) parsedValue = value;
				else if (barePolicy === 'flag') parsedValue = 'true';
				yield [name, parsedValue] as const;
			}
		}
		if (separator < 0) return;
		start = separator + 1;
	}
}
