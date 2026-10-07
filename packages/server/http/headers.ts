import * as responseCore from '@okikio/http/response';
import * as recordCore from '@okikio/record';
import type { Middleware } from './types.ts';
import { withHeaders } from './response.ts';

/** Static security-header overrides. `false` removes one default header. */
export interface SecurityHeadersOptionsType {
	/** Override Cross-Origin-Opener-Policy; false removes that default header. */
	readonly crossOriginOpenerPolicy?: string | false;
	/** Override Cross-Origin-Resource-Policy; false removes that default header. */
	readonly crossOriginResourcePolicy?: string | false;
	/** Override Origin-Agent-Cluster; false removes that default header. */
	readonly originAgentCluster?: string | false;
	/** Override Referrer-Policy; false removes that default header. */
	readonly referrerPolicy?: string | false;
	/** Override Strict-Transport-Security; false removes that default header. */
	readonly strictTransportSecurity?: string | false;
	/** Override X-Content-Type-Options; false removes that default header. */
	readonly xContentTypeOptions?: string | false;
	/** Override X-DNS-Prefetch-Control; false removes that default header. */
	readonly xDnsPrefetchControl?: string | false;
	/** Override X-Download-Options; false removes that default header. */
	readonly xDownloadOptions?: string | false;
	/** Override X-Frame-Options; false removes that default header. */
	readonly xFrameOptions?: string | false;
	/** Override X-Permitted-Cross-Domain-Policies; false removes that default header. */
	readonly xPermittedCrossDomainPolicies?: string | false;
	/** Override X-XSS-Protection; false removes that default header. */
	readonly xXssProtection?: string | false;
	/** Additional static response headers selected by the application. */
	readonly additional?: Readonly<Record<string, string>>;
}

/** Add a conservative static security-header set without depending on a web framework. */
export function securityHeaders(options: SecurityHeadersOptionsType = {}): Middleware {
	const normalized = normalizeSecurityHeaders(options);
	const configured = Object.freeze({
		'Cross-Origin-Opener-Policy': option(normalized.crossOriginOpenerPolicy, 'same-origin'),
		'Cross-Origin-Resource-Policy': option(normalized.crossOriginResourcePolicy, 'same-origin'),
		'Origin-Agent-Cluster': option(normalized.originAgentCluster, '?1'),
		'Referrer-Policy': option(normalized.referrerPolicy, 'no-referrer'),
		'Strict-Transport-Security': option(normalized.strictTransportSecurity, 'max-age=15552000; includeSubDomains'),
		'X-Content-Type-Options': option(normalized.xContentTypeOptions, 'nosniff'),
		'X-DNS-Prefetch-Control': option(normalized.xDnsPrefetchControl, 'off'),
		'X-Download-Options': option(normalized.xDownloadOptions, 'noopen'),
		'X-Frame-Options': option(normalized.xFrameOptions, 'SAMEORIGIN'),
		'X-Permitted-Cross-Domain-Policies': option(normalized.xPermittedCrossDomainPolicies, 'none'),
		'X-XSS-Protection': option(normalized.xXssProtection, '0'),
		...(normalized.additional ?? {}),
	});
	const set: Record<string, string> = Object.create(null);
	const remove = ['X-Powered-By'];
	for (const [name, value] of Object.entries(configured)) {
		if (value === false) remove.push(name);
		else set[name] = value;
	}
	return async (request, next) => withHeaders(await next(request), set, remove);
}

/** Add or replace static response headers after downstream work completes. */
export function headers(values: responseCore.HeaderInput, remove: readonly string[] = []): Middleware {
	const configured = responseCore.toHeaders(values);
	const removals = stringList(remove, 'removed response header names');
	return async (request, next) => withHeaders(await next(request), configured, removals);
}

/** Resolve a default header value while allowing callers to disable it explicitly. */
function option(value: string | false | undefined, fallback: string): string | false {
	return value === undefined ? fallback : value;
}

/** Validate and snapshot static security-header configuration. @internal */
function normalizeSecurityHeaders(options: SecurityHeadersOptionsType): SecurityHeadersOptionsType {
	recordCore.assert(options, 'security header options');
	const keys = [
		'crossOriginOpenerPolicy',
		'crossOriginResourcePolicy',
		'originAgentCluster',
		'referrerPolicy',
		'strictTransportSecurity',
		'xContentTypeOptions',
		'xDnsPrefetchControl',
		'xDownloadOptions',
		'xFrameOptions',
		'xPermittedCrossDomainPolicies',
		'xXssProtection',
	] as const;
	for (const key of keys) {
		const value = options[key];
		if (value !== undefined && value !== false && typeof value !== 'string') {
			throw new TypeError(`${key} must be a string or false when provided.`);
		}
	}
	let additional: Readonly<Record<string, string>> | undefined;
	if (options.additional !== undefined) {
		recordCore.assert(options.additional, 'additional security headers');
		for (const [name, value] of recordCore.entries(options.additional, 'additional security headers')) {
			if (typeof value !== 'string') {
				throw new TypeError(`additional security header ${JSON.stringify(name)} must be a string.`);
			}
		}
		additional = recordCore.snapshot(options.additional, 'additional security headers');
	}
	return Object.freeze({
		...Object.fromEntries(keys.flatMap((key) => options[key] === undefined ? [] : [[key, options[key]]])),
		...(additional === undefined ? {} : { additional }),
	});
}

/** Snapshot one dense list of response header names without invoking accessors. @internal */
function stringList(values: readonly string[], name: string): readonly string[] {
	if (!Array.isArray(values)) throw new TypeError(`${name} must be an array of strings.`);
	const result: string[] = [];
	for (let index = 0; index < values.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
		if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string') {
			throw new TypeError(`${name} must contain dense string data elements.`);
		}
		result.push(descriptor.value);
	}
	return Object.freeze(result);
}
