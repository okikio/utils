import * as recordCore from '@okikio/record';
import type { Middleware } from './types.ts';
import { withHeaders } from './response.ts';

/** Framework-neutral CORS policy. */
export interface CorsOptionsType {
	readonly origin?: string | readonly string[] | ((origin: string, request: Request) => string | undefined);
	readonly allowMethods?: readonly string[];
	readonly allowHeaders?: readonly string[];
	readonly exposeHeaders?: readonly string[];
	readonly credentials?: boolean;
	readonly maxAge?: number;
}

/** Apply CORS response policy and complete valid preflight requests before application routing. */
export function cors(options: CorsOptionsType = {}): Middleware {
	const normalized = normalizeCorsOptions(options);
	if (normalized.origin === '*' && normalized.credentials) {
		throw new TypeError('Credentialed CORS cannot use a wildcard origin.');
	}
	return async (request, next) => {
		const origin = request.headers.get('origin');
		if (origin === null) return await next(request);
		const allowedOrigin = resolveOrigin(normalized.origin, origin, request);
		if (allowedOrigin === undefined) return await next(request);
		if (allowedOrigin === '*' && normalized.credentials) {
			throw new TypeError('Credentialed CORS origin resolver returned a wildcard origin.');
		}
		validateOriginValue(allowedOrigin, 'CORS origin resolver');
		const fields = corsHeaders(allowedOrigin, normalized.allowMethods, normalized, request);
		const varyOrigin = allowedOrigin !== '*';
		if (request.method.toUpperCase() === 'OPTIONS' && request.headers.has('access-control-request-method')) {
			if (varyOrigin) fields.set('Vary', mergeVary(fields.get('vary'), 'Origin'));
			if (normalized.allowHeaders === undefined && request.headers.has('access-control-request-headers')) {
				fields.set('Vary', mergeVary(fields.get('vary'), 'Access-Control-Request-Headers'));
			}
			return new Response(null, { status: 204, headers: fields });
		}
		return addCorsHeaders(await next(request), fields, varyOrigin);
	};
}

interface NormalizedCorsOptions {
	readonly origin: NonNullable<CorsOptionsType['origin']>;
	readonly allowMethods: readonly string[];
	readonly allowHeaders?: readonly string[];
	readonly exposeHeaders?: readonly string[];
	readonly credentials: boolean;
	readonly maxAge?: number;
}

/** Validate and snapshot CORS policy before a long-lived middleware closure observes it. @internal */
function normalizeCorsOptions(options: CorsOptionsType): NormalizedCorsOptions {
	recordCore.assert(options, 'CORS options');
	if (options.credentials !== undefined && typeof options.credentials !== 'boolean') {
		throw new TypeError('CORS credentials must be a boolean when provided.');
	}
	if (options.maxAge !== undefined && (!Number.isSafeInteger(options.maxAge) || options.maxAge < 0)) {
		throw new TypeError('CORS maxAge must be a non-negative safe integer.');
	}
	const origin = normalizeOriginPolicy(options.origin ?? '*');
	const allowMethods = stringList(options.allowMethods ?? ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH', 'OPTIONS'], 'CORS allowMethods', methodPattern);
	const allowHeaders = options.allowHeaders === undefined ? undefined : stringList(options.allowHeaders, 'CORS allowHeaders', fieldNamePattern);
	const exposeHeaders = options.exposeHeaders === undefined ? undefined : stringList(options.exposeHeaders, 'CORS exposeHeaders', fieldNamePattern);
	return Object.freeze({
		origin,
		allowMethods,
		...(allowHeaders === undefined ? {} : { allowHeaders }),
		...(exposeHeaders === undefined ? {} : { exposeHeaders }),
		credentials: options.credentials ?? false,
		...(options.maxAge === undefined ? {} : { maxAge: options.maxAge }),
	});
}

const methodPattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const fieldNamePattern = methodPattern;

/** Snapshot one CORS string-list without invoking accessor-backed array elements. @internal */
function stringList(values: readonly string[], name: string, pattern?: RegExp): readonly string[] {
	if (!Array.isArray(values)) throw new TypeError(`${name} must be an array of strings.`);
	const result: string[] = [];
	for (let index = 0; index < values.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
		if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string') {
			throw new TypeError(`${name} must contain dense string data elements.`);
		}
		if (pattern !== undefined && !pattern.test(descriptor.value)) throw new TypeError(`${name} contains an invalid HTTP token.`);
		result.push(descriptor.value);
	}
	return Object.freeze(result);
}

/** Validate and snapshot a static or dynamic origin policy. @internal */
function normalizeOriginPolicy(value: NonNullable<CorsOptionsType['origin']>): NonNullable<CorsOptionsType['origin']> {
	if (typeof value === 'function') return value;
	if (typeof value === 'string') {
		validateOriginValue(value, 'CORS origin');
		return value;
	}
	return Object.freeze(stringList(value, 'CORS origin list').map((origin) => {
		validateOriginValue(origin, 'CORS origin');
		return origin;
	}));
}

/** Reject control characters and empty origin values before they become response fields. @internal */
function validateOriginValue(value: string, name: string): void {
	if (value.length === 0 || /[\0\r\n]/.test(value)) throw new TypeError(`${name} must be a non-empty value without control characters.`);
}

/** Resolve one incoming origin against static or dynamic policy. */
function resolveOrigin(
	policy: NonNullable<CorsOptionsType['origin']>,
	origin: string,
	request: Request,
): string | undefined {
	if (typeof policy === 'function') return policy(origin, request);
	if (Array.isArray(policy)) return policy.includes(origin) ? origin : undefined;
	return policy === '*' || policy === origin ? policy : undefined;
}

/** Build CORS fields for one request without discarding caller-selected values. */
function corsHeaders(
	origin: string,
	methods: readonly string[],
	options: NormalizedCorsOptions,
	request: Request,
): Headers {
	const headers = new Headers({
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Methods': methods.map((method) => method.toUpperCase()).join(', '),
	});
	const requestedHeaders = request.headers.get('access-control-request-headers');
	const allowHeaders = options.allowHeaders?.length ? options.allowHeaders.join(', ') : requestedHeaders;
	if (allowHeaders) headers.set('Access-Control-Allow-Headers', allowHeaders);
	if (options.exposeHeaders?.length) headers.set('Access-Control-Expose-Headers', options.exposeHeaders.join(', '));
	if (options.credentials) headers.set('Access-Control-Allow-Credentials', 'true');
	if (options.maxAge !== undefined) headers.set('Access-Control-Max-Age', String(options.maxAge));
	return headers;
}

/** Add CORS fields while merging, rather than replacing, an existing `Vary` field. */
function addCorsHeaders(value: Response, fields: Headers, varyOrigin: boolean): Response {
	const headers = new Headers(fields);
	if (varyOrigin) headers.set('Vary', mergeVary(value.headers.get('vary'), 'Origin'));
	return withHeaders(value, headers);
}

/** Merge one case-insensitive field name into an HTTP `Vary` value exactly once. */
function mergeVary(current: string | null, name: string): string {
	const values = (current ?? '').split(',').map((value) => value.trim()).filter(Boolean);
	if (!values.some((value) => value.toLowerCase() === name.toLowerCase())) values.push(name);
	return values.join(', ');
}
