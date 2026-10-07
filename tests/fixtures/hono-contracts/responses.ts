/** Adapted upstream literal observations. See README.md and HONO-LICENSE. @module */
import type { ResponseCaseType } from './types.ts';

export const responseCases: readonly ResponseCaseType[] = [
	{
		'id': 'response.text',
		'source': {
			'path': 'src/context.test.ts',
			'line': 48,
			'title': 'c.text()',
		},
		'operation': 'text',
		'expected': {
			'status': 201,
			'body': 'text in c',
			'mediaType': 'text/plain',
			'headers': {
				'X-Custom': 'Message',
			},
		},
		'body': 'text in c',
		'status': 201,
		'headers': {
			'X-Custom': 'Message',
		},
	},
	{
		'id': 'response.text-status',
		'source': {
			'path': 'src/context.test.ts',
			'line': 56,
			'title': 'c.text() with c.status()',
		},
		'operation': 'text',
		'expected': {
			'status': 404,
			'body': 'not found',
			'mediaType': 'text/plain',
		},
		'body': 'not found',
		'status': 404,
	},
	{
		'id': 'response.json',
		'source': {
			'path': 'src/context.test.ts',
			'line': 64,
			'title': 'c.json()',
		},
		'operation': 'json',
		'expected': {
			'status': 201,
			'body': '{"message":"Hello"}',
			'mediaType': 'application/json',
			'headers': {
				'X-Custom': 'Message',
			},
		},
		'body': {
			'message': 'Hello',
		},
		'status': 201,
		'headers': {
			'X-Custom': 'Message',
		},
	},
	{
		'id': 'response.html',
		'source': {
			'path': 'src/context.test.ts',
			'line': 73,
			'title': 'c.html()',
		},
		'operation': 'html',
		'expected': {
			'status': 201,
			'body': '<h1>Hello! Hono!</h1>',
			'mediaType': 'text/html',
			'headers': {
				'X-Custom': 'Message',
			},
		},
		'body': '<h1>Hello! Hono!</h1>',
		'status': 201,
		'headers': {
			'X-Custom': 'Message',
		},
		'adaptation':
			'Utils constructs native Responses with explicit header composition; async HTML awaits Promise.resolve instead of a timing-dependent timeout.',
	},
	{
		'id': 'response.async-html',
		'source': {
			'path': 'src/context.test.ts',
			'line': 81,
			'title': 'c.html() with async',
		},
		'operation': 'async-html',
		'expected': {
			'status': 201,
			'body': '<h1>Hello! Hono!</h1>',
			'mediaType': 'text/html',
			'headers': {
				'X-Custom': 'Message',
			},
		},
		'body': '<h1>Hello! Hono!</h1>',
		'status': 201,
		'headers': {
			'X-Custom': 'Message',
		},
		'adaptation':
			'Utils constructs native Responses with explicit header composition; async HTML awaits Promise.resolve instead of a timing-dependent timeout.',
	},
	{
		'id': 'response.redirect-relative',
		'source': {
			'path': 'src/context.test.ts',
			'line': 96,
			'title': 'c.redirect()',
		},
		'operation': 'redirect',
		'expected': {
			'status': 302,
			'headers': {
				'Location': '/destination',
			},
		},
		'location': '/destination',
		'adaptation':
			'Relative redirects require an explicit Location response; native Response.redirect only accepts absolute URLs. URL serialization preserves existing escapes.',
	},
	{
		'id': 'response.redirect-absolute',
		'source': {
			'path': 'src/context.test.ts',
			'line': 96,
			'title': 'c.redirect()',
		},
		'operation': 'redirect',
		'expected': {
			'status': 302,
			'headers': {
				'Location': 'https://example.com/destination',
			},
		},
		'location': 'https://example.com/destination',
		'adaptation':
			'Relative redirects require an explicit Location response; native Response.redirect only accepts absolute URLs. URL serialization preserves existing escapes.',
	},
	{
		'id': 'response.redirect-url',
		'source': {
			'path': 'src/context.test.ts',
			'line': 105,
			'title': 'c.redirect() w/ URL',
		},
		'operation': 'redirect',
		'expected': {
			'status': 302,
			'headers': {
				'Location': 'https://example.com/destination',
			},
		},
		'location': 'https://example.com/destination',
		'adaptation':
			'Relative redirects require an explicit Location response; native Response.redirect only accepts absolute URLs. URL serialization preserves existing escapes.',
	},
	{
		'id': 'response.redirect-multibyte',
		'source': {
			'path': 'src/context.test.ts',
			'line': 111,
			'title': 'c.redirect() w/ multibytes',
		},
		'operation': 'redirect',
		'expected': {
			'status': 302,
			'headers': {
				'Location': 'https://example.com/%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF',
			},
		},
		'location': 'https://example.com/こんにちは',
		'adaptation':
			'Relative redirects require an explicit Location response; native Response.redirect only accepts absolute URLs. URL serialization preserves existing escapes.',
	},
	{
		'id': 'response.redirect-unchanged-0',
		'source': {
			'path': 'src/context.test.ts',
			'line': 126,
			'title': 'c.redirect() w/ ${urlString}',
		},
		'operation': 'redirect',
		'location': 'https://example.com/%hello',
		'expected': {
			'headers': {
				'Location': 'https://example.com/%hello',
			},
		},
		'adaptation':
			'Expansion of the upstream unchangedURLString data table; native URL serialization for absolute redirects.',
	},
	{
		'id': 'response.redirect-unchanged-1',
		'source': {
			'path': 'src/context.test.ts',
			'line': 126,
			'title': 'c.redirect() w/ ${urlString}',
		},
		'operation': 'redirect',
		'location': 'https://example.com/%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF?abc',
		'expected': {
			'headers': {
				'Location': 'https://example.com/%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF?abc',
			},
		},
		'adaptation':
			'Expansion of the upstream unchangedURLString data table; native URL serialization for absolute redirects.',
	},
	{
		'id': 'response.redirect-unchanged-2',
		'source': {
			'path': 'src/context.test.ts',
			'line': 126,
			'title': 'c.redirect() w/ ${urlString}',
		},
		'operation': 'redirect',
		'location': 'https://localhost/api?redirect_uri=https%3A%2F%2Fexample.com',
		'expected': {
			'headers': {
				'Location': 'https://localhost/api?redirect_uri=https%3A%2F%2Fexample.com',
			},
		},
		'adaptation':
			'Expansion of the upstream unchangedURLString data table; native URL serialization for absolute redirects.',
	},
	{
		'id': 'response.redirect-unchanged-3',
		'source': {
			'path': 'src/context.test.ts',
			'line': 126,
			'title': 'c.redirect() w/ ${urlString}',
		},
		'operation': 'redirect',
		'location': 'https://localhost/api?redirect_uri=https%3A%2F%2Fexample.com&scope=email%20profile',
		'expected': {
			'headers': {
				'Location': 'https://localhost/api?redirect_uri=https%3A%2F%2Fexample.com&scope=email%20profile',
			},
		},
		'adaptation':
			'Expansion of the upstream unchangedURLString data table; native URL serialization for absolute redirects.',
	},
	{
		'id': 'response.header',
		'source': {
			'path': 'src/context.test.ts',
			'line': 132,
			'title': 'c.header()',
		},
		'operation': 'body',
		'expected': {
			'headers': {
				'X-Foo': 'Bar',
			},
		},
		'body': 'Hi',
		'before': [
			[
				'X-Foo',
				'Bar',
			],
		],
	},
	{
		'id': 'response.append',
		'source': {
			'path': 'src/context.test.ts',
			'line': 139,
			'title': 'c.header() - append',
		},
		'operation': 'body',
		'expected': {
			'headers': {
				'X-Foo': 'Bar, Buzz',
			},
		},
		'body': 'Hi',
		'before': [
			[
				'X-Foo',
				'Bar',
			],
			[
				'X-Foo',
				'Buzz',
				true,
			],
		],
	},
	{
		'id': 'response.before-and-init',
		'source': {
			'path': 'src/context.test.ts',
			'line': 166,
			'title': 'Should set headers if already this.#headers is created by `c.header()`',
		},
		'operation': 'body',
		'expected': {
			'headers': {
				'X-Foo': 'Bar, Buzz',
				'X-Message': 'Hi',
			},
		},
		'body': 'Hi',
		'before': [
			[
				'X-Foo',
				'Bar',
			],
			[
				'X-Foo',
				'Buzz',
				true,
			],
		],
		'headers': {
			'X-Message': 'Hi',
		},
	},
	{
		'id': 'response.append-html',
		'source': {
			'path': 'src/context.test.ts',
			'line': 178,
			'title': 'c.header() - append, c.html()',
		},
		'operation': 'html',
		'expected': {
			'mediaType': 'text/html',
		},
		'body': '<h1>This rendered fine</h1>',
		'before': [
			[
				'X-Foo',
				'Bar',
				true,
			],
		],
	},
	{
		'id': 'response.delete',
		'source': {
			'path': 'src/context.test.ts',
			'line': 184,
			'title': 'c.header() - clear the header',
		},
		'operation': 'body',
		'expected': {
			'headers': {
				'X-Foo': null,
			},
		},
		'body': 'Hi',
		'before': [
			[
				'X-Foo',
				'Bar',
			],
			[
				'X-Foo',
				null,
			],
			[
				'X-Foo2',
				'Bar',
			],
		],
	},
	{
		'id': 'response.delete-appended',
		'source': {
			'path': 'src/context.test.ts',
			'line': 195,
			'title': 'c.header() - clear the header when append is true',
		},
		'operation': 'body',
		'expected': {
			'headers': {
				'X-Foo': null,
			},
		},
		'body': 'Hi',
		'before': [
			[
				'X-Foo',
				'Bar',
				true,
			],
			[
				'X-Foo',
				null,
			],
		],
	},
	{
		'id': 'response.array',
		'source': {
			'path': 'src/context.test.ts',
			'line': 201,
			'title': 'c.body() - multiple header',
		},
		'operation': 'body',
		'expected': {
			'headers': {
				'X-Foo': 'Bar, Buzz',
			},
		},
		'body': 'Hi',
		'headers': {
			'X-Foo': [
				'Bar',
				'Buzz',
			],
		},
	},
	{
		'id': 'response.type-after-vary',
		'source': {
			'path': 'src/context.test.ts',
			'line': 209,
			'title': 'c.body() - content-type cannot be overridden by the default response when append headers',
		},
		'operation': 'body',
		'expected': {
			'mediaType': 'text/html',
		},
		'body': '<h1>Hi</h1>',
		'before': [
			[
				'Vary',
				'Accept-Encoding',
				true,
			],
			[
				'Content-Type',
				'text/html',
			],
		],
		'adaptation': 'Explicit response-header composition replaces Hono lazy c.res header initialization.',
	},
	{
		'id': 'response.type-last',
		'source': {
			'path': 'src/context.test.ts',
			'line': 224,
			'title': 'c.body() - Different header settings require ensuring order',
		},
		'operation': 'body',
		'expected': {
			'mediaType': 'text/html',
		},
		'body': '<h1>Hi</h1>',
		'before': [
			[
				'Vary',
				'Accept-Encoding',
				true,
			],
			[
				'Content-Type',
				'image/png',
			],
			[
				'Content-Type',
				'text/html',
			],
		],
		'adaptation': 'Explicit response-header composition replaces Hono lazy c.res header initialization.',
	},
	{
		'id': 'response.status',
		'source': {
			'path': 'src/context.test.ts',
			'line': 232,
			'title': 'c.status()',
		},
		'operation': 'body',
		'expected': {
			'status': 201,
		},
		'body': 'Hi',
		'status': 201,
	},
	{
		'id': 'response.status-json',
		'source': {
			'path': 'src/context.test.ts',
			'line': 238,
			'title': 'Complex pattern',
		},
		'operation': 'json',
		'expected': {
			'status': 404,
			'mediaType': 'application/json',
			'body': '{"hono":"great app"}',
		},
		'body': {
			'hono': 'great app',
		},
		'status': 404,
	},
	{
		'id': 'response.precedence',
		'source': {
			'path': 'src/context.test.ts',
			'line': 247,
			'title': 'Has headers and status',
		},
		'operation': 'body',
		'expected': {
			'status': 201,
			'body': 'this is body',
			'headers': {
				'x-custom1': 'Message1',
				'x-custom2': 'Message2-Override',
				'x-custom3': 'Message3',
			},
		},
		'body': 'this is body',
		'status': 201,
		'before': [
			[
				'x-custom1',
				'Message1',
			],
			[
				'x-custom2',
				'Message2',
			],
		],
		'headers': {
			'x-custom3': 'Message3',
			'x-custom2': 'Message2-Override',
		},
		'adaptation':
			'Port response assembly assertions; subsequent c.status(202) mutation is Hono context-only and is not asserted here.',
	},
	{
		'id': 'response.inherited-status',
		'source': {
			'path': 'src/context.test.ts',
			'line': 269,
			'title': 'Inherit current status if not specified',
		},
		'operation': 'body',
		'expected': {
			'status': 201,
			'body': 'this is body',
			'headers': {
				'x-custom2': 'Message2-Override',
				'x-custom3': 'Message3',
			},
		},
		'body': 'this is body',
		'status': 201,
		'headers': {
			'x-custom3': 'Message3',
			'x-custom2': 'Message2-Override',
		},
		'adaptation': 'Utils supplies explicit status; Hono context status inheritance is not a Utils API.',
	},
	{
		'id': 'response.replace-headers',
		'source': {
			'path': 'src/context.test.ts',
			'line': 283,
			'title': 'Should append the previous headers to new Response',
		},
		'operation': 'replace',
		'expected': {
			'headers': {
				'x-custom1': 'Message1',
				'Content-Type': 'application/json',
			},
		},
		'body': 'foo2',
		'before': [
			[
				'x-custom1',
				'Message1',
			],
		],
		'headers': {
			'Content-Type': 'application/json',
			'x-custom2': 'Message2',
		},
		'adaptation': 'Utils merges headers explicitly instead of Hono c.res automatic reassignment inheritance.',
	},
	{
		'id': 'response.default-status',
		'source': {
			'path': 'src/context.test.ts',
			'line': 296,
			'title': 'Should return 200 response',
		},
		'operation': 'text',
		'expected': {
			'status': 200,
		},
		'body': 'Text',
	},
	{
		'id': 'response.no-content',
		'source': {
			'path': 'src/context.test.ts',
			'line': 301,
			'title': 'Should return 204 response',
		},
		'operation': 'body',
		'expected': {
			'status': 204,
			'body': '',
		},
		'body': null,
		'status': 204,
	},
	{
		'id': 'response.html-overrides-type',
		'source': {
			'path': 'src/context.test.ts',
			'line': 391,
			'title': 'Should return only one content-type value',
		},
		'operation': 'html',
		'expected': {
			'headers': {
				'Content-Type': 'text/html; charset=UTF-8',
			},
		},
		'body': 'foo',
		'before': [
			[
				'Content-Type',
				'foo',
			],
		],
	},
	{
		'id': 'response.text-overrides-type',
		'source': {
			'path': 'src/context.test.ts',
			'line': 397,
			'title': 'Should rewrite header values correctly',
		},
		'operation': 'text',
		'expected': {
			'mediaType': 'text/plain',
		},
		'body': 'foo',
		'before': [
			[
				'Content-Type',
				'text/html; charset=UTF-8',
			],
		],
	},
	{
		'id': 'response.init-retains-before',
		'source': {
			'path': 'src/context.test.ts',
			'line': 403,
			'title': 'Should set header values if the #this.headers is set and the arg is ResponseInit',
		},
		'operation': 'body',
		'expected': {
			'headers': {
				'foo': 'bar',
			},
		},
		'body': 'foo',
		'before': [
			[
				'foo',
				'bar',
			],
		],
		'headers': {
			'Content-Type': 'text/plain',
		},
	},
	{
		'id': 'response.cookies-existing',
		'source': {
			'path': 'src/context.test.ts',
			'line': 439,
			'title': 'Should set set-cookie header values if c.res is already defined',
		},
		'operation': 'text',
		'expected': {
			'headers': {
				'set-cookie': 'a, b, c',
			},
			'cookies': [
				'a',
				'b',
				'c',
			],
		},
		'body': 'Hi',
		'before': [
			[
				'set-cookie',
				[
					'a',
					'b',
					'c',
				],
			],
		],
		'adaptation': 'Utils appendHeaders/toHeaders explicitly preserve repeated cookie occurrences.',
	},
	{
		'id': 'response.array-overrides',
		'source': {
			'path': 'src/context.test.ts',
			'line': 480,
			'title': 'Should handle headers with array values correctly',
		},
		'operation': 'json',
		'expected': {
			'headers': {
				'X-Array': 'new1, new2',
			},
		},
		'body': {
			'test': 'data',
		},
		'before': [
			[
				'X-Array',
				'value1',
			],
		],
		'headers': {
			'X-Array': [
				'new1',
				'new2',
			],
		},
	},
	{
		'id': 'response.array-empty',
		'source': {
			'path': 'src/context.test.ts',
			'line': 488,
			'title': 'Should remove existing header when new value is empty array',
		},
		'operation': 'json',
		'expected': {
			'headers': {
				'X-Test': null,
			},
		},
		'body': {
			'test': 'data',
		},
		'before': [
			[
				'X-Test',
				'existing',
			],
		],
		'headers': {
			'X-Test': [],
		},
		'adaptation':
			'Empty header-array removal is explicit in the Utils composition; mergeHeaders alone does not express deletion.',
	},
	{
		'id': 'response.problem-type',
		'source': {
			'path': 'src/context.test.ts',
			'line': 496,
			'title': 'Should override the default Content-Type even if the header name casing differs',
		},
		'operation': 'json',
		'expected': {
			'headers': {
				'Content-Type': 'application/problem+json',
			},
		},
		'body': {
			'type': 'urn:example:error',
		},
		'status': 400,
		'headers': {
			'content-type': 'application/problem+json',
		},
	},
	{
		'id': 'response.casing-last',
		'source': {
			'path': 'src/context.test.ts',
			'line': 503,
			'title': 'Should apply the last value when header names differ only in casing',
		},
		'operation': 'body',
		'expected': {
			'headers': {
				'X-Custom': 'second',
			},
		},
		'body': 'foo',
		'headers': {
			'X-Custom': 'first',
			'x-custom': 'second',
		},
	},
	{
		'id': 'response.response-init-json',
		'source': {
			'path': 'src/context.test.ts',
			'line': 519,
			'title': 'c.json()',
		},
		'operation': 'response-init',
		'expected': {
			'status': 401,
			'mediaType': 'application/json',
			'body': '{"message":"Unauthorized"}',
			'headers': {
				'x-custom': 'custom message',
			},
		},
		'body': {
			'message': 'Unauthorized',
		},
		'original': {
			'body': 'Unauthorized',
			'status': 401,
			'headers': {
				'content-type': 'text/plain',
				'x-custom': 'custom message',
			},
		},
		'adaptation':
			'Hono respond-method ResponseInit overload versus native Response status/headers and explicit Utils mergeHeaders; output only, not identical context APIs.',
	},
	{
		'id': 'response.response-init-body',
		'source': {
			'path': 'src/context.test.ts',
			'line': 541,
			'title': 'c.body()',
		},
		'operation': 'response-init',
		'expected': {
			'mediaType': 'text/html',
			'body': '<h2>Hello</h2>',
		},
		'body': '<h2>Hello</h2>',
		'original': {
			'body': '<h1>Hello</h1>',
			'status': 200,
			'headers': {
				'content-type': 'text/html',
			},
		},
		'adaptation':
			'Hono respond-method ResponseInit overload versus native Response status/headers and explicit Utils mergeHeaders; output only, not identical context APIs.',
	},
	{
		'id': 'response.response-init-text',
		'source': {
			'path': 'src/context.test.ts',
			'line': 568,
			'title': 'c.text()',
		},
		'operation': 'response-init',
		'expected': {
			'mediaType': 'text/plain',
			'body': 'foo',
		},
		'body': 'foo',
		'original': {
			'body': '{"foo":"bar"}',
			'status': 200,
			'headers': {},
		},
		'adaptation':
			'Hono respond-method ResponseInit overload versus native Response status/headers and explicit Utils mergeHeaders; output only, not identical context APIs.',
	},
	{
		'id': 'response.response-init-html',
		'source': {
			'path': 'src/context.test.ts',
			'line': 575,
			'title': 'c.html()',
		},
		'operation': 'response-init',
		'expected': {
			'mediaType': 'text/html',
			'body': '<h1>foo</h1>',
		},
		'body': '<h1>foo</h1>',
		'original': {
			'body': 'foo',
			'status': 200,
			'headers': {},
		},
		'adaptation':
			'Hono respond-method ResponseInit overload versus native Response status/headers and explicit Utils mergeHeaders; output only, not identical context APIs.',
	},
	{
		'id': 'response.reassign-cookies',
		'source': {
			'path': 'src/context.test.ts',
			'line': 413,
			'title': 'Should set cookie headers when re-assigning Response to `c.res`',
		},
		'operation': 'replace-cookie',
		'expected': {
			'cookies': [
				'foo=bar; Path=/',
				'foo2=bar2; Path=/',
			],
		},
		'adaptation':
			'Hono c.res reassignment inherits previous cookie fields over replacement cookies. Utils states that precedence explicitly with mergeHeaders(new, previous).',
	},
	{
		'id': 'response.previous-cookie',
		'source': {
			'path': 'src/context.test.ts',
			'line': 430,
			'title': 'Should keep previous cookies in response headers',
		},
		'operation': 'compose-cookie',
		'expected': {
			'cookieMembership': {
				'foo=bar; Path=/': true,
				'foo2=bar2; Path=/': true,
			},
		},
		'adaptation':
			'Hono setCookie plus existing response cookies versus explicit Utils appendHeaders; cookie formatting is authored literally, not a Utils cookie serializer claim.',
	},
	{
		'id': 'response.init-cookies',
		'source': {
			'path': 'src/context.test.ts',
			'line': 552,
			'title': 'c.body() should retain context cookies from context and original response',
		},
		'operation': 'init-cookie',
		'expected': {
			'cookieMembership': {
				'context=1; Path=/': true,
				'context=2; Path=/': true,
				'response=1; Path=/': true,
			},
		},
		'adaptation':
			'Compare retained cookie occurrences from Hono context and ResponseInit against explicit Utils appendHeaders. Compare membership as asserted upstream; do not freeze cookie ordering.',
	},
];
