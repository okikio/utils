import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as fc from 'fast-check';
import { planRetryAfter } from './retry.ts';
import { notModified, preconditions } from './response/http.ts';
import * as cookie from './cookie/mod.ts';
import * as schema from '@okikio/schema';
const now = Date.parse('1994-11-06T08:49:35Z');
const date = 'Sun, 06 Nov 1994 08:49:37 GMT';
const representation = { exists: true, etag: '"a,b"', lastModified: date, now } as const;
function request(headers: HeadersInit, method = 'GET') {
	return new Request('https://test.invalid', { method, headers });
}

describe('HTTP condition and delay plans', () => {
	it('uses strong If-Match, weak If-None-Match and exact opaque tags with embedded commas', () => {
		expect(preconditions(request({ 'if-match': 'W/"a,b"' }), representation)).toEqual({ kind: 'failed', status: 412 });
		expect(
			preconditions(
				request({ 'if-match': '"a,b"', 'if-unmodified-since': 'Sun, 06 Nov 1994 08:49:00 GMT' }),
				representation,
			).kind,
		).toBe('continue');
		expect(preconditions(request({ 'if-none-match': 'W/"a,b"' }), representation)).toEqual({
			kind: 'not-modified',
			status: 304,
		});
		expect(preconditions(request({ 'if-none-match': 'W/"a,b"' }, 'PUT'), representation)).toEqual({
			kind: 'failed',
			status: 412,
		});
		expect(notModified(request({ 'if-none-match': 'W/"a,b"' }), { etag: '"a,b"' })).toBe(true);
		expect(preconditions(request({ 'if-none-match': 'garbage' }), representation)).toEqual({
			kind: 'invalid',
			status: 400,
			field: 'if-none-match',
		});
	});
	it('preserves existence and date/entity precedence and leaves unsatisfied ranges to the range owner', () => {
		expect(preconditions(request({ 'if-match': '*' }), { ...representation, exists: false }).kind).toBe('failed');
		expect(preconditions(request({ 'if-none-match': '*' }), { exists: true, now }).kind).toBe('not-modified');
		expect(preconditions(request({ 'if-none-match': '"other"', 'if-modified-since': date }), representation).kind).toBe(
			'continue',
		);
		expect(preconditions(request({ 'if-modified-since': date }, 'HEAD'), representation).kind).toBe('not-modified');
		expect(
			preconditions(request({ 'if-unmodified-since': 'Sun, 06 Nov 1994 08:49:00 GMT' }, 'PATCH'), representation).kind,
		).toBe('failed');
		expect(preconditions(request({ range: 'bytes=999-1000', 'if-range': '"a,b"' }), representation)).toEqual({
			kind: 'continue',
			range: true,
		});
		expect(preconditions(request({ range: 'bytes=0-1', 'if-range': 'W/"a,b"' }), representation)).toEqual({
			kind: 'continue',
			range: false,
		});
		expect(preconditions(request({ range: 'bytes=0-1', 'if-range': date }), representation)).toEqual({
			kind: 'continue',
			range: false,
		});
		expect(preconditions(request({ range: 'bytes=0-1', 'if-range': date }), { ...representation, strongDate: true }))
			.toEqual({ kind: 'continue', range: true });
		expect(preconditions(request({ 'if-match': '"other"' }, 'OPTIONS'), representation)).toEqual({
			kind: 'continue',
			range: false,
		});
	});
	it('accepts every HTTP-date grammar, caps huge seconds, and rejects native-only date syntax', () => {
		const options = { now, maximumDelay: 5000, maximumCodeUnits: 256 };
		for (const value of [date, 'Sunday, 06-Nov-94 08:49:37 GMT', 'Sun Nov  6 08:49:37 1994']) {
			expect(planRetryAfter(value, options)).toEqual({
				kind: 'delay',
				milliseconds: 2000,
				capped: false,
				source: 'date',
			});
		}
		expect(planRetryAfter('9'.repeat(100), options)).toEqual({
			kind: 'delay',
			milliseconds: 5000,
			capped: true,
			source: 'seconds',
		});
		expect(planRetryAfter(null, options)).toEqual({ kind: 'missing' });
		for (
			const value of [
				'-1',
				'1.5',
				'1e2',
				'2026-01-01',
				'Mon, 06 Nov 1994 08:49:37 GMT',
				'Sun, 31 Feb 1994 08:49:37 GMT',
			]
		) {
			expect(planRetryAfter(value, options)).toEqual({ kind: 'invalid' });
		}
		fc.assert(
			fc.property(fc.nat(1_000_000), (seconds) => {
				const plan = planRetryAfter(String(seconds), options);
				if (plan.kind !== 'delay' || plan.milliseconds !== Math.min(seconds * 1000, 5000)) {
					throw new Error('Delay oracle failed.');
				}
			}),
			{ seed: 718, numRuns: 100 },
		);
	});
	it('expires prefix/SameSite cookies using the original path/domain while retaining repeated fields', () => {
		const headers = new Headers();
		for (
			const [name, attributes] of [
				['__Host-session', { path: '/', secure: true, sameSite: 'none' }],
				['__Secure-session', { path: '/app', domain: 'example.com', secure: true, sameSite: 'strict' }],
			] as const
		) {
			const definition = cookie.define({
				id: `cookie${name}`,
				description: 'Deletion fixture.',
				name,
				value: schema.string({ minLength: 1 }),
				attributes,
			});
			cookie.set(headers, definition, 'value');
			cookie.remove(headers, definition);
		}
		const values = headers.getSetCookie();
		expect(values.length).toBe(4);
		expect(values[1]).toContain('Max-Age=0');
		expect(values[1]).toContain('Path=/');
		expect(values[1]).toContain('SameSite=None');
		expect(values[3]).toContain('Domain=example.com');
		expect(values[3]).toContain('Path=/app');
	});
});
