/** Adapted upstream literal observations. See README.md and HONO-LICENSE. @module */
import type { ApplicationCaseType } from './types.ts';

export const applicationCases: readonly ApplicationCaseType[] = [
	{
		'id': 'application.encoded-unicode',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 811,
			'title': 'should decode path parameter',
		},
		'application': 'encoded-param',
		'path': '/users/%C3%A7awa%20y%C3%AE%3F',
		'expected': {
			'status': 200,
			'body': 'id is çawa yî?',
		},
	},
	{
		'id': 'application.encoded-slash',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 819,
			'title': 'should decode "/"',
		},
		'application': 'encoded-param',
		'path': '/users/hono%2Fposts',
		'expected': {
			'status': 200,
			'body': 'id is hono/posts',
		},
	},
	{
		'id': 'application.encoded-literal',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 827,
			'title': 'should decode alphabets',
		},
		'application': 'encoded-static',
		'path': '/users/%73tatic',
		'expected': {
			'status': 200,
			'body': 'static',
		},
		'utilsExpected': {
			'status': 404,
		},
		'difference': 'Hono decodes encoded literal path characters before matching; Utils matches the raw pathname.',
	},
	{
		'id': 'application.invalid-utf8',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 835,
			'title': 'should decode alphabets with invalid UTF-8 sequence',
		},
		'application': 'encoded-invalid',
		'path': '/%73tatic/%A4%A2',
		'expected': {
			'status': 200,
			'body': 'by c.req.param: %A4%A2',
		},
		'utilsExpected': {
			'status': 404,
		},
		'difference': 'The raw encoded static prefix does not match Utils; Hono preserves invalid parameter escapes.',
	},
	{
		'id': 'application.invalid-percent',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 845,
			'title': 'should decode alphabets with invalid percent encoding',
		},
		'application': 'encoded-invalid',
		'path': '/%73tatic/%a',
		'expected': {
			'status': 200,
			'body': 'by c.req.param: %a',
		},
		'utilsExpected': {
			'status': 404,
		},
		'difference': 'The raw encoded static prefix does not match Utils; Hono preserves invalid parameter escapes.',
	},
	{
		'id': 'application.double-encoded',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 855,
			'title': 'should not double decode',
		},
		'application': 'encoded-posts',
		'path': '/users/%2525',
		'expected': {
			'status': 200,
			'body': 'posts of %25',
		},
	},
	{
		'id': 'application.parameter',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 933,
			'title': 'param of /entry/:id is found',
		},
		'application': 'parameters',
		'path': '/entry/123',
		'expected': {
			'status': 200,
			'body': 'id is 123',
		},
	},
	{
		'id': 'application.parameter-key',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 939,
			'title': 'param of /entry/:id is found, even for Array object method names',
		},
		'application': 'parameters',
		'path': '/entry/key',
		'expected': {
			'status': 200,
			'body': 'id is key',
		},
	},
	{
		'id': 'application.parameter-unicode',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 945,
			'title': 'param of /entry/:id is decoded',
		},
		'application': 'parameters',
		'path': '/entry/%C3%A7awa%20y%C3%AE%3F',
		'expected': {
			'status': 200,
			'body': 'id is çawa yî?',
		},
	},
	{
		'id': 'application.query',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 957,
			'title': 'query of /search?name=sam is found',
		},
		'application': 'parameters',
		'path': '/search?name=sam',
		'expected': {
			'status': 200,
			'body': 'name is sam',
		},
	},
	{
		'id': 'application.query-first',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 963,
			'title': 'query of /search?name=sam&name=tom is found',
		},
		'application': 'parameters',
		'path': '/search?name=sam&name=tom',
		'expected': {
			'status': 200,
			'body': 'name is sam',
		},
	},
	{
		'id': 'application.query-many',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 969,
			'title': 'query of /multiple-values?q=foo&q=bar&limit=10 is found',
		},
		'application': 'parameters',
		'path': '/multiple-values?q=foo&q=bar&limit=10',
		'expected': {
			'status': 200,
			'body': 'q is foo and bar, limit is 10',
		},
	},
	{
		'id': 'application.request-header',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 975,
			'title': '/add-header header - X-Foo is Bar',
		},
		'application': 'parameters',
		'path': '/add-header',
		'expected': {
			'status': 200,
			'body': 'foo is Bar',
		},
		'headers': {
			'X-Foo': 'Bar',
		},
	},
	{
		'id': 'application.path-root',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 1003,
			'title': 'Should get the path `/` correctly',
		},
		'application': 'path',
		'path': '/',
		'expected': {
			'status': 200,
			'body': '/',
		},
	},
	{
		'id': 'application.path-query',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 1009,
			'title': 'Should get the path `/search` correctly with a query',
		},
		'application': 'path',
		'path': '/search?name=Hono',
		'expected': {
			'status': 200,
			'body': '/search',
		},
	},
	{
		'id': 'application.middleware-hello',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 1106,
			'title': 'logging and custom header',
		},
		'application': 'middleware',
		'path': '/hello',
		'expected': {
			'status': 200,
			'body': 'hello',
			'headers': {
				'x-custom': 'root',
				'x-message': 'custom-header',
				'x-message-2': 'custom-header-2',
			},
		},
		'adaptation':
			'Utils uses explicitly scoped middleware predicates; Hono wildcard use() route collection is a different API.',
	},
	{
		'id': 'application.middleware-param',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 1115,
			'title': 'logging and custom header with named param',
		},
		'application': 'middleware',
		'path': '/hello/message',
		'expected': {
			'status': 200,
			'body': 'message',
			'headers': {
				'x-custom': 'root',
				'x-message-2': 'custom-header-2',
			},
		},
	},
	{
		'id': 'application.middleware-json',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 1123,
			'title': 'should return correct the content-type header',
		},
		'application': 'middleware',
		'path': '/json',
		'expected': {
			'status': 200,
			'mediaType': 'application/json',
		},
	},
	{
		'id': 'application.middleware-missing',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 1129,
			'title': 'not found',
		},
		'application': 'middleware',
		'path': '/foo',
		'expected': {
			'status': 404,
			'body': 'Not Found Foo',
		},
	},
	{
		'id': 'application.chained',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 1159,
			'title': 'GET /chained/abc',
		},
		'application': 'chained',
		'path': '/chained/abc',
		'expected': {
			'status': 200,
			'body': 'GET chained',
			'headers': {
				'x-after': 'abc',
			},
		},
		'adaptation': 'Explicit Utils middleware composition replaces Hono use(...handlers).',
	},
	{
		'id': 'application.multiple',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 1187,
			'title': 'GET /multiple/abc',
		},
		'application': 'multiple',
		'path': '/multiple/abc',
		'expected': {
			'status': 200,
			'body': 'GET multiple',
			'headers': {
				'x-after': 'abc',
			},
		},
		'adaptation': 'Explicit Utils middleware composition replaces Hono use(...handlers).',
	},
	{
		'id': 'application.replacement-retains',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 1214,
			'title': 'Should have the custom header',
		},
		'application': 'replacement',
		'path': '/normal',
		'expected': {
			'headers': {
				'x-custom': 'foo',
			},
		},
		'adaptation':
			'Utils explicitly merges the prior response headers when replacing its body; Hono c.res inherits automatically.',
	},
	{
		'id': 'application.replacement-drops',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 1219,
			'title': 'Should not have the custom header',
		},
		'application': 'replacement',
		'path': '/overwrite',
		'expected': {
			'headers': {
				'x-custom': null,
			},
		},
		'adaptation': 'Return a new Utils response without copying headers; Hono clears c.res before replacement.',
	},
	{
		'id': 'application.custom-missing',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 1320,
			'title': 'Custom 404 Not Found',
		},
		'application': 'missing',
		'path': '/foo',
		'expected': {
			'status': 404,
			'body': 'Custom 404 Not Found',
		},
	},
	{
		'id': 'application.missing-one',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 1339,
			'title': 'Custom 404 Not Found',
		},
		'application': 'missing-one',
		'path': '/foo',
		'expected': {
			'status': 404,
			'body': '404 Not Found + Middleware',
		},
		'adaptation':
			'Utils configures the Hono default not-found text explicitly; each suffix middleware awaits and consumes its owned inner response.',
	},
	{
		'id': 'application.missing-two',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 1362,
			'title': 'Custom 404 Not Found',
		},
		'application': 'missing-two',
		'path': '/foo',
		'expected': {
			'status': 404,
			'body': '404 Not Found + Middleware 2 + Middleware 1',
		},
		'adaptation': 'Explicit not-found text and two onion middleware owners.',
	},
	{
		'id': 'application.error',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 1447,
			'title': 'Custom Error Message',
		},
		'application': 'error',
		'path': '/error',
		'expected': {
			'status': 500,
			'body': 'Custom Error Message',
			'headers': {
				'x-debug': 'This is Error',
			},
		},
		'adaptation':
			'Custom Hono onError versus Utils catchErrors map; Promise.resolve replaces the upstream scheduler delay.',
	},
	{
		'id': 'application.middleware-error',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 1447,
			'title': 'Custom Error Message',
		},
		'application': 'error',
		'path': '/error-middleware',
		'expected': {
			'status': 500,
			'body': 'Custom Error Message',
			'headers': {
				'x-debug': 'This is Middleware Error',
			},
		},
		'adaptation':
			'Custom Hono onError versus Utils catchErrors map; Promise.resolve replaces the upstream scheduler delay.',
	},
	{
		'id': 'application.async-error',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 1482,
			'title': 'Custom Error Message',
		},
		'application': 'async-error',
		'path': '/error',
		'expected': {
			'status': 500,
			'body': 'Custom Error Message with Promised',
			'headers': {
				'x-debug': 'This is Error',
			},
		},
		'adaptation':
			'Custom Hono onError versus Utils catchErrors map; Promise.resolve replaces the upstream scheduler delay.',
	},
	{
		'id': 'application.async-middleware-error',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 1482,
			'title': 'Custom Error Message',
		},
		'application': 'async-error',
		'path': '/error-middleware',
		'expected': {
			'status': 500,
			'body': 'Custom Error Message with Promised',
			'headers': {
				'x-debug': 'This is Middleware Error',
			},
		},
		'adaptation':
			'Custom Hono onError versus Utils catchErrors map; Promise.resolve replaces the upstream scheduler delay.',
	},
	{
		'id': 'application.error-in-missing',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 1649,
			'title': 'Should handle the error thrown in `notFound()``',
		},
		'application': 'missing-error',
		'path': '/',
		'expected': {
			'status': 400,
			'body': 'Error in Not Found',
		},
		'adaptation': 'Utils catchErrors surrounds the notFound handler; no undefined-returning middleware is ported.',
	},
	{
		'id': 'application.method-purge',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 2027,
			'title': 'Should handle PURGE method with RegExpRouter',
		},
		'application': 'methods',
		'path': '/hello',
		'expected': {
			'status': 200,
			'body': 'hello',
		},
		'method': 'PURGE',
	},
	{
		'id': 'application.method-put',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 2063,
			'title': 'Should return 200 with PUT',
		},
		'application': 'methods',
		'path': '/posts/123',
		'expected': {
			'status': 200,
			'body': '{"postId":"123","method":"PUT"}',
		},
		'method': 'PUT',
	},
	{
		'id': 'application.method-delete',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 2075,
			'title': 'Should return 200 with DELETE',
		},
		'application': 'methods',
		'path': '/posts/123',
		'expected': {
			'status': 200,
			'body': '{"postId":"123","method":"DELETE"}',
		},
		'method': 'DELETE',
	},
	{
		'id': 'application.method-post-miss',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 2087,
			'title': 'Should return 404 with POST',
		},
		'application': 'methods',
		'path': '/posts/123',
		'expected': {
			'status': 404,
		},
		'method': 'POST',
	},
	{
		'id': 'application.method-query',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 2097,
			'title': 'Should handle QUERY method with app.query()',
		},
		'application': 'methods',
		'path': '/query',
		'expected': {
			'status': 202,
			'body': 'Accepted',
		},
		'method': 'QUERY',
	},
	{
		'id': 'application.mount-root',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 2674,
			'title': 'Should return responses from Hono app',
		},
		'application': 'mount',
		'path': '/',
		'expected': {
			'status': 200,
			'body': 'Hono',
			'headers': {
				'x-message': 'Foo',
			},
		},
		'headers': {},
	},
	{
		'id': 'application.mount-base',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 2681,
			'title': 'Should return responses from AnotherApp',
		},
		'application': 'mount',
		'path': '/another-app',
		'expected': {
			'status': 200,
			'body': 'AnotherApp',
			'headers': {
				'x-message': 'Foo',
			},
		},
		'headers': {},
	},
	{
		'id': 'application.mount-hello',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 2681,
			'title': 'Should return responses from AnotherApp',
		},
		'application': 'mount',
		'path': '/another-app/hello',
		'expected': {
			'status': 200,
			'body': 'Hello from AnotherApp',
			'headers': {
				'x-message': 'Foo',
			},
		},
		'headers': {},
	},
	{
		'id': 'application.mount-header',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 2681,
			'title': 'Should return responses from AnotherApp',
		},
		'application': 'mount',
		'path': '/another-app/header',
		'expected': {
			'status': 200,
			'body': 'Message Foo!',
			'headers': {
				'x-message': 'Foo',
			},
		},
		'headers': {
			'x-message': 'Message Foo!',
		},
	},
	{
		'id': 'application.mount-missing',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 2681,
			'title': 'Should return responses from AnotherApp',
		},
		'application': 'mount',
		'path': '/another-app/not-found',
		'expected': {
			'status': 404,
			'body': 'Not Found from AnotherApp',
			'headers': {
				'x-message': 'Foo',
			},
		},
		'headers': {},
	},
	{
		'id': 'application.mount-query',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 2681,
			'title': 'Should return responses from AnotherApp',
		},
		'application': 'mount',
		'path': '/another-app/with-query?foo=bar&baz=qux',
		'expected': {
			'status': 200,
			'body': 'foo=bar&baz=qux',
			'headers': {
				'x-message': 'Foo',
			},
		},
		'headers': {},
	},
	{
		'id': 'application.mount-slash',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 2730,
			'title': 'Should return responses from AnotherApp - sub + slash',
		},
		'application': 'mount',
		'path': '/another-app2/sub-slash',
		'expected': {
			'status': 200,
			'body': 'AnotherApp',
			'headers': {
				'x-message': 'Foo',
			},
		},
		'headers': {},
	},
	{
		'id': 'application.mount-basepath',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 2736,
			'title': 'Should return responses from AnotherApp - with `basePath()`',
		},
		'application': 'mount-api',
		'path': '/api/another-app',
		'expected': {
			'status': 200,
			'body': 'AnotherApp',
		},
		'adaptation': 'Utils authors the full mount prefix; Hono authors it through basePath().',
	},
	{
		'id': 'application.mount-unicode',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 2746,
			'title': 'Should strip a decoded non-ASCII mount prefix',
		},
		'application': 'mount-unicode',
		'path': '/api/%C3%A9/hello',
		'expected': {
			'status': 200,
			'body': '/hello',
		},
		'utilsExpected': {
			'status': 404,
		},
		'difference': 'Hono matches a decoded non-ASCII mount prefix; Utils matches the raw encoded pathname prefix.',
	},
	{
		'id': 'application.mount-encoded-slash',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 2756,
			'title': 'Should preserve an encoded slash as a literal path segment after stripping the prefix',
		},
		'application': 'mount-slash',
		'path': '/api/v1/admin%2Fsecret',
		'expected': {
			'status': 200,
			'body': '/admin%2Fsecret',
		},
	},
	{
		'id': 'application.mount-encoded-percent',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 2766,
			'title': 'Should preserve encoded percent characters after stripping the prefix',
		},
		'application': 'mount-percent',
		'path': '/api/foo%252Fbar',
		'expected': {
			'status': 200,
			'body': '/foo%252Fbar',
		},
	},
	{
		'id': 'application.head-get',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 2917,
			'title': 'Should return 200 response with body - GET /page',
		},
		'application': 'head',
		'path': '/page',
		'expected': {
			'status': 200,
			'body': '/page',
			'headers': {
				'X-Message': 'Foo',
				'X-Method': 'GET',
			},
		},
	},
	{
		'id': 'application.head-bodyless',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 2925,
			'title': 'Should return 200 response without body - HEAD /page',
		},
		'application': 'head',
		'path': '/page',
		'expected': {
			'status': 200,
			'bodyMissing': true,
			'headers': {
				'X-Message': 'Foo',
				'X-Method': 'HEAD',
			},
		},
		'method': 'HEAD',
	},
	{
		'id': 'application.strict-no-slash',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 318,
			'title': '/hello/ is not found',
		},
		'application': 'strict',
		'path': '/hello',
		'expected': {
			'status': 200,
		},
		'adaptation': 'Strict path matching, no normalization middleware.',
	},
	{
		'id': 'application.strict-extra-slash',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 318,
			'title': '/hello/ is not found',
		},
		'application': 'strict',
		'path': '/hello/',
		'expected': {
			'status': 404,
		},
		'adaptation': 'Strict path matching, no normalization middleware.',
	},
	{
		'id': 'application.strict-with-slash',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 335,
			'title': '/hello is not found',
		},
		'application': 'strict-slash',
		'path': '/hello/',
		'expected': {
			'status': 200,
		},
		'adaptation': 'Strict path matching, no normalization middleware.',
	},
	{
		'id': 'application.strict-missing-slash',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 335,
			'title': '/hello is not found',
		},
		'application': 'strict-slash',
		'path': '/hello',
		'expected': {
			'status': 404,
		},
		'adaptation': 'Strict path matching, no normalization middleware.',
	},
	{
		'id': 'application.loose-no-slash',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 352,
			'title': '/hello and /hello/ are treated as the same',
		},
		'application': 'loose',
		'path': '/hello',
		'expected': {
			'status': 200,
		},
		'adaptation':
			'Utils registers both literal variants for the non-strict Hono application; trailingSlash() redirects and is not the same matching policy.',
	},
	{
		'id': 'application.loose-with-slash',
		'source': {
			'path': 'src/hono.test.ts',
			'line': 352,
			'title': '/hello and /hello/ are treated as the same',
		},
		'application': 'loose',
		'path': '/hello/',
		'expected': {
			'status': 200,
		},
		'adaptation':
			'Utils registers both literal variants for the non-strict Hono application; trailingSlash() redirects and is not the same matching policy.',
	},
];
