import * as recordCore from '@okikio/record';

/** One HTTP field occurrence. Repeated fields are represented by repeated entries. */
export type HeaderField = readonly [name: string, value: string];

/** Ergonomic value accepted in record-shaped header input. */
export type HeaderValue = string | readonly string[];

/** Immutable header record used in response/problem tuples. */
export type ResponseHeaders = Readonly<Record<string, HeaderValue>>;

/** Header input accepted by response and problem occurrence APIs. */
export type HeaderInput = ResponseHeaders | readonly HeaderField[] | Headers;

const fieldNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Validate and normalize one header input without flattening repeated fields. */
export function headers(input: HeaderInput = Object.freeze({})): ResponseHeaders {
	return fieldsToRecord(normalizeSource(input));
}

/** Return every HTTP field occurrence in deterministic order. */
export function headerEntries(input: HeaderInput): readonly HeaderField[] {
	return Object.freeze(normalizeSource(input));
}

/** Merge header sources with later sources replacing earlier fields by name. */
export function mergeHeaders(...sources: readonly (HeaderInput | undefined)[]): ResponseHeaders {
	const byName = new Map<string, { readonly name: string; readonly values: readonly string[] }>();
	for (const source of sources) {
		if (source === undefined) continue;
		const grouped = group(normalizeSource(source));
		for (const [lower, entry] of grouped) byName.set(lower, entry);
	}
	const fields: HeaderField[] = [];
	for (const entry of byName.values()) {
		for (const value of entry.values) fields.push(Object.freeze([entry.name, value]));
	}
	return fieldsToRecord(fields);
}

/** Append additional field occurrences rather than replacing existing values. */
export function appendHeaders(base: HeaderInput, additional: HeaderInput): ResponseHeaders {
	return fieldsToRecord([...normalizeSource(base), ...normalizeSource(additional)]);
}

/** Return a standard Headers instance while preserving repeatable values where the runtime permits it. */
export function toHeaders(input: HeaderInput): Headers {
	const result = new Headers();
	for (const [name, value] of normalizeSource(input)) result.append(name, value);
	return result;
}

/** Read every value for a field without comma-splitting values such as Set-Cookie. */
export function headerValues(input: HeaderInput, name: string): readonly string[] {
	const lower = name.toLowerCase();
	return Object.freeze(normalizeSource(input).filter(([candidate]) => candidate.toLowerCase() === lower).map(([, value]) => value));
}

/** Return whether header input uses the explicit readonly tuple-list form. @internal */
function isHeaderFieldList(input: HeaderInput): input is readonly HeaderField[] {
	return Array.isArray(input);
}

/** Read one dense tuple-list without invoking accessor-backed array entries. @internal */
function normalizeFieldList(input: readonly HeaderField[]): HeaderField[] {
	const fields: HeaderField[] = [];
	for (let index = 0; index < input.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
		if (descriptor === undefined || !('value' in descriptor) || !Array.isArray(descriptor.value)) {
			throw new TypeError('Header field input must be a dense array of [name, value] tuples.');
		}
		const tuple = descriptor.value;
		if (tuple.length !== 2) throw new TypeError('Header field entries must be [name, value] tuples.');
		const name = Object.getOwnPropertyDescriptor(tuple, '0');
		const value = Object.getOwnPropertyDescriptor(tuple, '1');
		if (name === undefined || !('value' in name) || value === undefined || !('value' in value)) {
			throw new TypeError('Header field tuple values must be ordinary data elements.');
		}
		fields.push(normalizeField(name.value, value.value));
	}
	return fields;
}

/** Read one dense string-list header value without invoking array accessors. @internal */
function normalizeHeaderValues(name: string, values: readonly string[]): HeaderField[] {
	const fields: HeaderField[] = [];
	for (let index = 0; index < values.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
		if (descriptor === undefined || !('value' in descriptor)) {
			throw new TypeError(`HTTP header ${JSON.stringify(name)} must contain dense string data elements.`);
		}
		fields.push(normalizeField(name, descriptor.value));
	}
	return fields;
}

/**
 * Normalizes source into the canonical internal form used by later phases.
 *
 * It builds deterministic logical HTTP representations before a framework creates the native Response.
 *
 * @internal
 */
function normalizeSource(input: HeaderInput): HeaderField[] {
	const fields: HeaderField[] = [];
	if (input instanceof Headers) {
		const getSetCookie = (input as Headers & { getSetCookie?: () => string[] }).getSetCookie;
		const cookies = typeof getSetCookie === 'function' ? getSetCookie.call(input) : [];
		for (const [name, value] of input.entries()) {
			if (name.toLowerCase() === 'set-cookie' && cookies.length > 0) continue;
			fields.push(normalizeField(name, value));
		}
		for (const value of cookies) fields.push(normalizeField('Set-Cookie', value));
		return fields;
	}
	if (isHeaderFieldList(input)) return normalizeFieldList(input);
	for (const [name, value] of recordCore.entries(input, 'HTTP header record')) {
		if (Array.isArray(value)) fields.push(...normalizeHeaderValues(name, value));
		else fields.push(normalizeField(name, value));
	}
	return fields;
}

/**
 * Normalizes field into the canonical internal form used by later phases.
 *
 * @internal
 */
function normalizeField(name: unknown, value: unknown): HeaderField {
	if (typeof name !== 'string' || !fieldNamePattern.test(name)) throw new TypeError(`Invalid HTTP header name ${JSON.stringify(name)}.`);
	if (typeof value !== 'string') throw new TypeError(`HTTP header ${JSON.stringify(name)} must contain string values.`);
	if (/\0|\r|\n/.test(value)) throw new TypeError(`HTTP header ${JSON.stringify(name)} contains a forbidden control character.`);
	return Object.freeze([canonicalHeaderName(name), value.trim()]);
}

/**
 * Groups values into the structure consumed by logical HTTP response construction.
 *
 * Response internals build framework-neutral response data before a server adapter creates the native Response.
 *
 * @internal
 */
function group(fields: readonly HeaderField[]): Map<string, { readonly name: string; readonly values: readonly string[] }> {
	const result = new Map<string, { readonly name: string; readonly values: readonly string[] }>();
	for (const [name, value] of fields) {
		const lower = name.toLowerCase();
		const current = result.get(lower);
		result.set(lower, Object.freeze({
			name: current?.name ?? name,
			values: Object.freeze([...(current?.values ?? []), value]),
		}));
	}
	return result;
}

/**
 * Converts a `Headers` collection into the immutable record representation used by logical response definitions.
 *
 * @internal
 */
function fieldsToRecord(fields: readonly HeaderField[]): ResponseHeaders {
	const grouped = group(fields);
	const result: Record<string, HeaderValue> = Object.create(null);
	for (const { name, values } of grouped.values()) result[name] = values.length === 1 ? values[0]! : values;
	return Object.freeze(result);
}

/**
 * Canonicalize a header name for deterministic response-header comparison and output.
 *
 * @internal
 */
function canonicalHeaderName(name: string): string {
	return name.toLowerCase().split('-').map((part) => part.length === 0 ? part : `${part[0]!.toUpperCase()}${part.slice(1)}`).join('-');
}
