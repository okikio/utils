import * as recordCore from '@okikio/record';
import type { Middleware } from './types.ts';

/** Canonicalize one HTTP route path without applying filesystem semantics. */
export function normalizePath(path: string): string {
	if (typeof path !== 'string') throw new TypeError('HTTP path must be a string.');
	if (/[?#\\\0\r\n]/.test(path)) throw new TypeError('HTTP route paths must not contain a query, fragment, backslash, or control character.');
	if (path.length === 0 || path === '/') return '/';
	const trailingSlash = path.endsWith('/');
	const parts = path.split('/').filter(Boolean);
	for (const part of parts) validateRoutePart(part);
	const normalized = `/${parts.join('/')}`;
	if (normalized === '/') return '/';
	return trailingSlash ? `${normalized}/` : normalized;
}

/** Reject authored route segments that URL parsing would rewrite before matching. @internal */
function validateRoutePart(part: string): void {
	const dotNormalized = part.replaceAll(/%2e/gi, '.');
	if (dotNormalized === '.' || dotNormalized === '..') throw new TypeError('HTTP route paths must not contain dot segments.');
	if (part.startsWith(':') && !/^:[A-Za-z_][A-Za-z0-9_]*$/.test(part)) {
		throw new TypeError(`Invalid HTTP route parameter segment ${JSON.stringify(part)}.`);
	}
}

/** Match one concrete request path against a `:parameter` route template without normalizing request shape. */
export function matchPath(template: string, pathname: string): boolean {
	const expected = splitRoutePath(normalizePath(template));
	const actual = splitRequestPath(pathname);
	if (expected.length !== actual.length) return false;
	return expected.every((part, index) => {
		const value = actual[index]!;
		return part.startsWith(':') ? value.length > 0 : part === value;
	});
}

/** Compare route templates by deterministic matching specificity.
 *
 * A positive result means `left` is more specific. Earlier static segments beat
 * parameter segments. Longer paths win only after every shared segment ties.
 */
export function compareRouteSpecificity(left: string, right: string): number {
	const leftParts = splitRoutePath(normalizePath(left));
	const rightParts = splitRoutePath(normalizePath(right));
	const length = Math.min(leftParts.length, rightParts.length);
	for (let index = 0; index < length; index += 1) {
		const leftStatic = leftParts[index]!.startsWith(':') ? 0 : 1;
		const rightStatic = rightParts[index]!.startsWith(':') ? 0 : 1;
		if (leftStatic !== rightStatic) return leftStatic - rightStatic;
	}
	return leftParts.length - rightParts.length;
}

/** Split an authored canonical route template. @internal */
function splitRoutePath(path: string): readonly string[] {
	return path === '/' ? [] : path.slice(1).split('/');
}

/** Split a concrete request pathname while preserving duplicate and trailing slashes. @internal */
function splitRequestPath(pathname: string): readonly string[] {
	if (pathname === '/') return [];
	if (!pathname.startsWith('/')) return [`!invalid:${pathname}`];
	return pathname.slice(1).split('/');
}

/** Options used by trailing-slash normalization middleware. */
export interface TrailingSlashOptions {
	readonly alwaysRedirect?: boolean;
	readonly status?: 301 | 302 | 307 | 308;
	readonly skip?: (pathname: string) => boolean;
}

/** Redirect GET requests to one canonical trailing-slash form. */
export function trailingSlash(
	mode: 'trim' | 'append',
	options: TrailingSlashOptions = {},
): Middleware {
	if (mode !== 'trim' && mode !== 'append') throw new TypeError('Trailing-slash mode must be trim or append.');
	recordCore.assert(options, 'trailing-slash options');
	const normalized = recordCore.snapshot(options, 'trailing-slash options');
	if (normalized.alwaysRedirect !== undefined && typeof normalized.alwaysRedirect !== 'boolean') throw new TypeError('alwaysRedirect must be a boolean when provided.');
	if (normalized.skip !== undefined && typeof normalized.skip !== 'function') throw new TypeError('trailing-slash skip must be a function when provided.');
	const status = normalized.status ?? 301;
	if (status !== 301 && status !== 302 && status !== 307 && status !== 308) throw new TypeError('Trailing-slash status must be 301, 302, 307, or 308.');
	const alwaysRedirect = normalized.alwaysRedirect ?? false;
	const skip = normalized.skip;
	return async (request, next) => {
		if (request.method.toUpperCase() !== 'GET') return await next(request);

		const url = new URL(request.url);
		if (skip?.(url.pathname)) return await next(request);

		const target = trailingTarget(url, mode);
		if (target === undefined) return await next(request);
		if (alwaysRedirect) return Response.redirect(target, status);

		const response = await next(request);
		return response.status === 404 ? Response.redirect(target, status) : response;
	};
}

/** Build the alternate URL only when the current path violates the requested form. */
function trailingTarget(url: URL, mode: 'trim' | 'append'): URL | undefined {
	if (url.pathname === '/') return undefined;
	const hasSlash = url.pathname.endsWith('/');
	if (mode === 'trim' && hasSlash) {
		const target = new URL(url);
		target.pathname = target.pathname.slice(0, -1);
		return target;
	}
	if (mode === 'append' && !hasSlash) {
		const target = new URL(url);
		target.pathname = `${target.pathname}/`;
		return target;
	}
	return undefined;
}
