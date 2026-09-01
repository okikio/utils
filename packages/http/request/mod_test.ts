import { describe, it } from 'node:test';
import { expect } from '@std/expect';

import * as request from './mod.ts';

describe('request wire parsing', () => {
	it('normalizes bounded headers and redacts credentials', () => {
		const headers = new Headers({ Authorization: 'Bearer secret', 'X-Test': 'value' });
		expect(request.parseHeaders(headers)).toEqual({ authorization: 'Bearer secret', 'x-test': 'value' });
		expect(request.redactHeaders(headers)).toEqual({ authorization: '[REDACTED]', 'x-test': 'value' });
		expect(() => request.parseHeaders(new Headers({ 'X-Large': '12345' }), { maximumHeaderValueBytes: 4 }))
			.toThrow(request.RequestTransportError);
	});

	it('rejects exotic parsing-option records without invoking accessors', () => {
		let reads = 0;
		const options = Object.create(null) as request.RequestParsingOptions;
		Object.defineProperty(options, 'maximumHeaders', {
			enumerable: true,
			get() { reads += 1; return 1; },
		});
		expect(() => request.parseHeaders(new Headers(), options)).toThrow('enumerable data property');
		expect(reads).toBe(0);

		const inherited = Object.create({ maximumHeaders: 1 }) as request.RequestParsingOptions;
		expect(() => request.parseHeaders(new Headers(), inherited)).toThrow('plain object or null-prototype record');
	});

	it('preserves repeated query values and enforces count/value bounds', () => {
		const query = new URLSearchParams();
		query.append('tag', 'one');
		query.append('tag', 'two');
		expect(request.parseQuery(query)).toEqual({ tag: ['one', 'two'] });
		expect(() => request.parseQuery(query, { maximumQueryParameters: 1 })).toThrow('At most 1 query parameters');
		expect(() => request.parseQuery(new URLSearchParams({ q: 'abc' }), { maximumQueryValueLength: 2 }))
			.toThrow('exceeds 2 characters');
	});

	it('distinguishes bare query flags from explicit empty values', () => {
		expect(request.parseQuery('?loud')).toEqual({ loud: '' });
		expect(request.parseQuery('?loud=true')).toEqual({ loud: 'true' });
		expect(request.parseQuery('?loud=false')).toEqual({ loud: 'false' });
		expect(request.parseQuery('?loud=')).toEqual({ loud: '' });
		expect(request.parseQuery('?loud', { bareQueryParameters: 'flag' })).toEqual({ loud: 'true' });
		expect(() => request.parseQuery('?loud', { bareQueryParameters: 'reject' }))
			.toThrow('requires an explicit value');
		expect(request.parseQuery('?flag&flag=false&tag=one%20two', { bareQueryParameters: 'flag' })).toEqual({
			flag: ['true', 'false'],
			tag: 'one two',
		});
	});

	it('keeps WHATWG query decoding while preserving raw flag syntax', () => {
		expect(request.parseQuery('?name=example+service&token=a%3Db%26c')).toEqual({
			name: 'example service',
			token: 'a=b&c',
		});
		expect(request.parseQuery('?a%3Db&encoded%26name=value', { bareQueryParameters: 'flag' })).toEqual({
			'a=b': 'true',
			'encoded&name': 'value',
		});
		const unusual = request.parseQuery('?=value&__proto__=safe&constructor=safe');
		expect(unusual['']).toBe('value');
		expect(unusual.__proto__).toBe('safe');
		expect(unusual.constructor).toBe('safe');
		expect(request.parseQuery('?flag&flag=&flag=true', { bareQueryParameters: 'flag' })).toEqual({ flag: ['true', '', 'true'] });
		expect(() => request.parseQuery(`?${'n'.repeat(5)}=value`, { maximumParameterLength: 4 }))
			.toThrow('name exceeds 4 characters');
	});

	it('rejects invalid request policies instead of silently normalizing them', () => {
		expect(() => Reflect.apply(request.parseQuery, undefined, ['?flag', { bareQueryParameters: 'maybe' }]))
			.toThrow('bareQueryParameters must be empty, flag, or reject');
		expect(() => Reflect.apply(request.parseCookies, undefined, ['session=one', { duplicates: 'merge' }]))
			.toThrow('duplicates must be reject, first, last, or array');
		expect(() => Reflect.apply(request.parseCookies, undefined, ['session=one', { percentDecode: 'yes' }]))
			.toThrow('percentDecode must be a boolean');
		expect(() => request.parseTraceState('vendor=value', -1)).toThrow('non-negative safe integer');
	});

	it('rejects exotic authorization and forwarding policies without invoking accessors', () => {
		let reads = 0;
		const authorization = Object.create(null) as { allowedSchemes?: readonly string[] };
		Object.defineProperty(authorization, 'allowedSchemes', {
			enumerable: true,
			get() { reads += 1; return ['Bearer']; },
		});
		expect(() => request.parseAuthorization('Bearer secret', authorization)).toThrow('enumerable data property');

		const forwarded = Object.create(null) as request.ForwardedHeaderPolicy;
		Object.defineProperty(forwarded, 'trust', {
			enumerable: true,
			get() { reads += 1; return true; },
		});
		expect(() => request.externalUrl(new Request('https://service.invalid'), forwarded)).toThrow('enumerable data property');
		expect(reads).toBe(0);

		const inherited = Object.create({ trust: true }) as request.ForwardedHeaderPolicy;
		expect(() => request.externalUrl(new Request('https://service.invalid'), inherited))
			.toThrow('plain object or null-prototype record');
	});

	it('rejects accessor-backed authorization and forwarding allowlists without invoking elements', () => {
		let reads = 0;
		const schemes: string[] = [];
		Object.defineProperty(schemes, '0', {
			configurable: true,
			enumerable: true,
			get() { reads += 1; return 'Bearer'; },
		});
		schemes.length = 1;
		expect(() => request.parseAuthorization('Bearer secret', { allowedSchemes: schemes }))
			.toThrow('dense string data elements');

		const hosts: string[] = [];
		Object.defineProperty(hosts, '0', {
			configurable: true,
			enumerable: true,
			get() { reads += 1; return 'service.invalid'; },
		});
		hosts.length = 1;
		expect(() => request.externalUrl(new Request('https://service.invalid'), { trust: true, allowedHosts: hosts }))
			.toThrow('dense string data elements');
		expect(reads).toBe(0);
	});

	it('decodes canonical path parameters and rejects malformed encodings', () => {
		expect(request.parseParameters('/widgets/:widgetId', '/widgets/widget%201')).toEqual({ widgetId: 'widget 1' });
		expect(() => request.parseParameters('/widgets/:widgetId', '/widgets/%E0%A4%A')).toThrow('percent-encoding');
	});

	it('parses cookies with explicit duplicate and percent-decoding policy', () => {
		expect(request.parseCookies('session=opaque; preference=compact; session=rotated')).toEqual({
			session: ['opaque', 'rotated'],
			preference: 'compact',
		});
		expect(request.parseCookies('name=example%20service', { percentDecode: true })).toEqual({ name: 'example service' });
		expect(() => request.parseCookies('session=one; session=two', { duplicates: 'reject' })).toThrow('occurs more than once');
	});

	it('parses authorization syntax without exposing the credential through logging or JSON', () => {
		const parsed = request.parseAuthorization('Bearer very-secret', { allowedSchemes: ['Bearer'] })!;
		expect(parsed.scheme).toBe('Bearer');
		expect(parsed.normalizedScheme).toBe('bearer');
		expect(parsed.credential.reveal()).toBe('very-secret');
		expect(String(parsed.credential)).toBe('[REDACTED]');
		expect(JSON.stringify(parsed.credential)).toBe('"[REDACTED]"');
		expect(() => request.parseAuthorization('Digest value', { allowedSchemes: ['Bearer'] })).toThrow('not supported');
	});

	it('reads and parses bounded JSON and repeated form values', async () => {
		const json = await request.parseJson(new Request('https://service.invalid', {
			method: 'POST',
			headers: { 'Content-Type': 'application/problem+json' },
			body: JSON.stringify({ ok: true }),
		}));
		expect(json).toEqual({ ok: true });
		await expect(request.parseJson(new Request('https://service.invalid', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '12345',
		}), { maximumBodyBytes: 4 })).rejects.toThrow('exceeds 4 bytes');

		const form = await request.parseForm(new Request('https://service.invalid', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: 'tag=one&tag=two&name=example',
		}));
		expect(form).toEqual({ tag: ['one', 'two'], name: 'example' });
	});

	it('accepts browser-scale request input with the default limits', async () => {
		const largeHeaderValue = 'h'.repeat(12 * 1024);
		expect(request.parseHeaders(new Headers({ Authorization: 'Bearer secret', 'X-Large': largeHeaderValue }))).toEqual({
			authorization: 'Bearer secret',
			'x-large': largeHeaderValue,
		});

		const queryValue = 'q'.repeat(6 * 1024);
		expect(request.parseQuery(new URLSearchParams({ search: queryValue }))).toEqual({ search: queryValue });

		const cookieValue = 'c'.repeat(10 * 1024);
		expect(request.parseCookies(`session=${cookieValue}; preference=compact`)).toEqual({
			session: cookieValue,
			preference: 'compact',
		});

		const jsonBody = JSON.stringify({ payload: 'b'.repeat(2 * 1024 * 1024) });
		const parsedJson = await request.parseJson(new Request('https://service.invalid', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: jsonBody,
		}));
		expect(parsedJson).toEqual({ payload: 'b'.repeat(2 * 1024 * 1024) });

		const manyFields = new URLSearchParams();
		for (let index = 0; index < 300; index += 1) manyFields.append(`field${index}`, `${index}`);
		const parsedForm = await request.parseForm(new Request('https://service.invalid', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: manyFields,
		}));
		expect(parsedForm.field0).toBe('0');
		expect(parsedForm.field299).toBe('299');
	});

	it('negotiates media types by quality and specificity', () => {
		expect(request.negotiateContent('text/html;q=0.8, application/json;q=1', ['text/html', 'application/json']))
			.toBe('application/json');
		expect(request.negotiateContent('application/*;q=0.5, text/html;q=0.5', ['application/json', 'text/html']))
			.toBe('text/html');
		expect(() => request.negotiateContent('application/xml', ['application/json'])).toThrow('None of the requested media types');
	});

	it('uses forwarded origin data only under an explicit trust policy', () => {
		const incoming = new Request('http://internal:8000/widgets', {
			headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'api.example.invalid' },
		});
		expect(request.externalUrl(incoming, { trust: false }).href).toBe('http://internal:8000/widgets');
		expect(request.externalUrl(incoming, {
			trust: true,
			allowedProtocols: ['https:'],
			allowedHosts: ['api.example.invalid'],
		}).href).toBe('https://api.example.invalid/widgets');
		expect(() => request.externalUrl(incoming, { trust: true, allowedHosts: ['other.example'] })).toThrow('not allowed');
	});
});

describe('request validation diagnostics', () => {
	it('normalizes transport and schema issues without copying rejected values', () => {
		const details = request.validationDetails('query', [
			{ code: 'query-value-too-large', message: 'The query value is too large.', path: ['filter', 'email'] },
			{ message: 'Expected a number.', path: [{ key: 'limit' }] },
		]);
		expect(details).toEqual([
			{
				source: 'query',
				code: 'query-value-too-large',
				message: 'The query value is too large.',
				path: ['filter', 'email'],
				location: 'query.filter.email',
				field: 'email',
			},
			{
				source: 'query',
				code: 'invalid-value',
				message: 'Expected a number.',
				path: ['limit'],
				location: 'query.limit',
				field: 'limit',
			},
		]);
		expect(JSON.stringify(details)).not.toContain('someone@example.com');
	});
});

describe('request correlation and memo ownership', () => {
	it('continues valid W3C context with a fresh span and sanitized request ID', async () => {
		const incomingTrace = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
		const raw = new Request('https://service.invalid', {
			headers: {
				traceparent: incomingTrace,
				tracestate: 'vendor=value',
				'x-request-id': 'request_123',
			},
		});
		const first = await request.correlation(raw);
		const second = await request.correlation(raw);
		expect(second).toBe(first);
		expect(first).toMatchObject({
			requestId: 'request_123',
			traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
			parentSpanId: '00f067aa0ba902b7',
			traceFlags: '01',
			traceState: 'vendor=value',
			source: 'continued',
		});
		expect(first.spanId).toMatch(/^[0-9a-f]{16}$/);
		expect(request.propagationHeaders(first).get('traceparent')).toBe(first.traceparent);
	});

	it('projects redaction-safe structured correlation fields', async () => {
		const value = await request.correlation(new Request('https://service.invalid'));
		const fields = request.correlationFields(value, {
			service: 'imports',
			operationId: 'imports.list',
			routeId: 'GET /imports',
		});
		expect(fields).toMatchObject({
			request_id: value.requestId,
			trace_id: value.traceId,
			span_id: value.spanId,
			service: 'imports',
			operation_id: 'imports.list',
			route_id: 'GET /imports',
		});
		expect(JSON.stringify(fields)).not.toContain('authorization');
		expect(JSON.stringify(fields)).not.toContain('cookie');
	});

	it('replaces malformed parent context rather than forwarding it', async () => {
		const value = await request.correlation(new Request('https://service.invalid', {
			headers: { traceparent: '00-not-a-trace', 'x-request-id': 'bad\trequest' },
		}));
		expect(value.source).toBe('replaced-invalid-parent');
		expect(value.traceId).toMatch(/^[0-9a-f]{32}$/);
		expect(value.requestId).not.toBe('bad\trequest');
		expect(value.parentSpanId).toBeUndefined();
	});

	it('snapshots correlation options before memoized work can observe caller mutation', async () => {
		const options = { sampled: true };
		const pending = request.correlation(new Request('https://service.invalid'), options);
		options.sampled = false;
		const value = await pending;
		expect(value.traceFlags).toBe('01');
	});

	it('snapshots memo rejection policy before an in-flight loader settles', async () => {
		const owner = {};
		const options = { cacheRejected: false };
		let reject!: (reason: Error) => void;
		const pending = request.memoize(owner, 'mutable-policy', () => new Promise<never>((_, fail) => { reject = fail; }), options);
		await Promise.resolve();
		options.cacheRejected = true;
		reject(new Error('first failure'));
		await expect(pending).rejects.toThrow('first failure');

		const recovered = await request.memoize(owner, 'mutable-policy', () => 'fresh');
		expect(recovered).toBe('fresh');
	});

	it('shares pending work, retries rejected loads, and disposes request-owned values', async () => {
		const owner = {};
		const key = {};
		let calls = 0;
		const load = async () => { calls += 1; await Promise.resolve(); return { value: calls }; };
		const [left, right] = await Promise.all([
			request.memoize(owner, key, load),
			request.memoize(owner, key, load),
		]);
		expect(left).toBe(right);
		expect(calls).toBe(1);

		let failures = 0;
		await expect(request.memoize(owner, 'failure', () => { failures += 1; throw new Error('failed'); })).rejects.toThrow('failed');
		await expect(request.memoize(owner, 'failure', () => { failures += 1; throw new Error('failed again'); })).rejects.toThrow('failed again');
		expect(failures).toBe(2);

		let disposed = false;
		await request.memoize(owner, 'disposable', () => ({ [Symbol.dispose]() { disposed = true; } }));
		await request.disposeMemo(owner);
		expect(disposed).toBe(true);
	});
});

describe('forwardHeaders', () => {
	it('removes caller-owned trust metadata and reconstructs the public origin', () => {
		const headers = request.forwardHeaders(new Request('https://app.example.test/path', {
			headers: {
				authorization: 'Bearer keep-me',
				cookie: 'session=keep-me',
				'x-forwarded-for': '198.51.100.10',
				'x-real-ip': '198.51.100.11',
				'x-request-id': 'caller-id',
				'x-owned-value': 'spoofed',
			},
		}), {
			requestCookies: 'preserve',
			requestAuthorization: 'preserve',
			removePrefixes: ['x-owned-'],
		});

		expect(headers.get('authorization')).toBe('Bearer keep-me');
		expect(headers.get('cookie')).toBe('session=keep-me');
		expect(headers.get('x-forwarded-for')).toBeNull();
		expect(headers.get('x-real-ip')).toBeNull();
		expect(headers.get('x-request-id')).toBeNull();
		expect(headers.get('x-owned-value')).toBeNull();
		expect(headers.get('x-forwarded-host')).toBe('app.example.test');
		expect(headers.get('x-forwarded-proto')).toBe('https');
	});

	it('strips credentials unless forwarding is explicitly selected', () => {
		const headers = request.forwardHeaders(new Request('http://localhost:8780/', {
			headers: { authorization: 'Bearer secret', cookie: 'session=secret' },
		}));
		expect(headers.get('authorization')).toBeNull();
		expect(headers.get('cookie')).toBeNull();
	});
});
