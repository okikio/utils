/** Adapted upstream literal observations. See README.md and HONO-LICENSE. @module */
import type { RouterCaseType } from './types.ts';

export const routerCases: readonly RouterCaseType[] = [
	{
		'id': 'router.basic-GET',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 67,
			'title': 'GET, post hello',
		},
		'routes': [
			[
				'GET',
				'/hello',
				'get hello',
			],
			[
				'POST',
				'/hello',
				'post hello',
			],
			[
				'PURGE',
				'/hello',
				'purge hello',
			],
		],
		'method': 'GET',
		'path': '/hello',
		'expected': [
			{
				'handler': 'get hello',
				'params': {},
			},
		],
	},
	{
		'id': 'router.basic-POST',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 67,
			'title': 'GET, post hello',
		},
		'routes': [
			[
				'GET',
				'/hello',
				'get hello',
			],
			[
				'POST',
				'/hello',
				'post hello',
			],
			[
				'PURGE',
				'/hello',
				'purge hello',
			],
		],
		'method': 'POST',
		'path': '/hello',
		'expected': [
			{
				'handler': 'post hello',
				'params': {},
			},
		],
	},
	{
		'id': 'router.basic-PURGE',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 67,
			'title': 'GET, post hello',
		},
		'routes': [
			[
				'GET',
				'/hello',
				'get hello',
			],
			[
				'POST',
				'/hello',
				'post hello',
			],
			[
				'PURGE',
				'/hello',
				'purge hello',
			],
		],
		'method': 'PURGE',
		'path': '/hello',
		'expected': [
			{
				'handler': 'purge hello',
				'params': {},
			},
		],
	},
	{
		'id': 'router.basic-PUT',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 67,
			'title': 'GET, post hello',
		},
		'routes': [
			[
				'GET',
				'/hello',
				'get hello',
			],
			[
				'POST',
				'/hello',
				'post hello',
			],
			[
				'PURGE',
				'/hello',
				'purge hello',
			],
		],
		'method': 'PUT',
		'path': '/hello',
		'expected': [],
	},
	{
		'id': 'router.basic-miss',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 67,
			'title': 'GET, post hello',
		},
		'routes': [
			[
				'GET',
				'/hello',
				'get hello',
			],
			[
				'POST',
				'/hello',
				'post hello',
			],
			[
				'PURGE',
				'/hello',
				'purge hello',
			],
		],
		'method': 'GET',
		'path': '/',
		'expected': [],
	},
	{
		'id': 'router.reserved',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 85,
			'title': 'Reserved words and named parameter',
		},
		'routes': [
			[
				'GET',
				'/entry/:constructor',
				'get entry',
			],
		],
		'method': 'GET',
		'path': '/entry/123',
		'expected': [
			{
				'handler': 'get entry',
				'params': {
					'constructor': '123',
				},
			},
		],
	},
	{
		'id': 'router.reserved-wildcard',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 93,
			'title': 'Reserved words and wildcard',
		},
		'routes': [
			[
				'GET',
				'/wild/*/card',
				'get wildcard',
			],
		],
		'method': 'GET',
		'path': '/wild/constructor/card',
		'expected': [
			{
				'handler': 'get wildcard',
				'params': {},
			},
		],
		'utilsExpected': [],
		'difference': 'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal.',
	},
	{
		'id': 'router.reserved-optional',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 100,
			'title': 'Reserved words and optional named parameter',
		},
		'routes': [
			[
				'GET',
				'/api/animals/:constructor?',
				'animals',
			],
		],
		'method': 'GET',
		'path': '/api/animals',
		'expected': [
			{
				'handler': 'animals',
				'params': {},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.named',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 110,
			'title': 'Named Param',
		},
		'routes': [
			[
				'GET',
				'/entry/:id',
				'get entry',
			],
		],
		'method': 'GET',
		'path': '/entry/123',
		'expected': [
			{
				'handler': 'get entry',
				'params': {
					'id': '123',
				},
			},
		],
	},
	{
		'id': 'router.named-miss',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 110,
			'title': 'Named Param',
		},
		'routes': [
			[
				'GET',
				'/entry/:id',
				'get entry',
			],
		],
		'method': 'GET',
		'path': '/entry-123',
		'expected': [],
	},
	{
		'id': 'router.wildcard',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 122,
			'title': 'Wildcard',
		},
		'routes': [
			[
				'GET',
				'/wild/*/card',
				'get wildcard',
			],
		],
		'method': 'GET',
		'path': '/wild/xxx/card',
		'expected': [
			{
				'handler': 'get wildcard',
				'params': {},
			},
		],
		'utilsExpected': [],
		'difference': 'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal.',
	},
	{
		'id': 'router.fallback-abc',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 129,
			'title': 'Default',
		},
		'routes': [
			[
				'GET',
				'/api/abc',
				'get api',
			],
			[
				'GET',
				'/api/*',
				'fallback',
			],
		],
		'method': 'GET',
		'path': '/api/abc',
		'expected': [
			{
				'handler': 'get api',
				'params': {},
			},
			{
				'handler': 'fallback',
				'params': {},
			},
		],
		'utilsExpected': [
			{
				'handler': 'get api',
				'params': {},
			},
		],
		'difference':
			'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal. Utils selects one route owner; Hono collects matching handlers in registration order.',
	},
	{
		'id': 'router.fallback-def',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 129,
			'title': 'Default',
		},
		'routes': [
			[
				'GET',
				'/api/abc',
				'get api',
			],
			[
				'GET',
				'/api/*',
				'fallback',
			],
		],
		'method': 'GET',
		'path': '/api/def',
		'expected': [
			{
				'handler': 'fallback',
				'params': {},
			},
		],
		'utilsExpected': [],
		'difference':
			'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal. Utils selects one route owner; Hono collects matching handlers in registration order.',
	},
	{
		'id': 'router.regex-match',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 141,
			'title': 'Regexp',
		},
		'routes': [
			[
				'GET',
				'/post/:date{[0-9]+}/:title{[a-z]+}',
				'get post',
			],
		],
		'method': 'GET',
		'path': '/post/20210101/hello',
		'expected': [
			{
				'handler': 'get post',
				'params': {
					'date': '20210101',
					'title': 'hello',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.regex-short',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 141,
			'title': 'Regexp',
		},
		'routes': [
			[
				'GET',
				'/post/:date{[0-9]+}/:title{[a-z]+}',
				'get post',
			],
		],
		'method': 'GET',
		'path': '/post/onetwothree',
		'expected': [],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.regex-invalid',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 141,
			'title': 'Regexp',
		},
		'routes': [
			[
				'GET',
				'/post/:date{[0-9]+}/:title{[a-z]+}',
				'get post',
			],
		],
		'method': 'GET',
		'path': '/post/123/123',
		'expected': [],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.catchall-missing',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 154,
			'title': 'Parameter with {.*} regexp',
		},
		'routes': [
			[
				'GET',
				'/files/:name{.*}',
				'file',
			],
		],
		'method': 'GET',
		'path': '/files',
		'expected': [],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.catchall-one',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 154,
			'title': 'Parameter with {.*} regexp',
		},
		'routes': [
			[
				'GET',
				'/files/:name{.*}',
				'file',
			],
		],
		'method': 'GET',
		'path': '/files/a',
		'expected': [
			{
				'handler': 'file',
				'params': {
					'name': 'a',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.catchall-many',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 154,
			'title': 'Parameter with {.*} regexp',
		},
		'routes': [
			[
				'GET',
				'/files/:name{.*}',
				'file',
			],
		],
		'method': 'GET',
		'path': '/files/a/b',
		'expected': [
			{
				'handler': 'file',
				'params': {
					'name': 'a/b',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.duplicate-wildcard-top',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 174,
			'title': '/*',
		},
		'routes': [
			[
				'GET',
				'/api/*',
				'auth middleware',
			],
			[
				'GET',
				'/api',
				'top',
			],
			[
				'GET',
				'/api/posts',
				'posts',
			],
			[
				'GET',
				'/api/*',
				'fallback',
			],
		],
		'method': 'GET',
		'path': '/api',
		'expected': [
			{
				'handler': 'auth middleware',
				'params': {},
			},
			{
				'handler': 'top',
				'params': {},
			},
			{
				'handler': 'fallback',
				'params': {},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects duplicate route shapes instead of chaining matching route handlers.',
	},
	{
		'id': 'router.duplicate-wildcard-posts',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 174,
			'title': '/*',
		},
		'routes': [
			[
				'GET',
				'/api/*',
				'auth middleware',
			],
			[
				'GET',
				'/api',
				'top',
			],
			[
				'GET',
				'/api/posts',
				'posts',
			],
			[
				'GET',
				'/api/*',
				'fallback',
			],
		],
		'method': 'GET',
		'path': '/api/posts',
		'expected': [
			{
				'handler': 'auth middleware',
				'params': {},
			},
			{
				'handler': 'posts',
				'params': {},
			},
			{
				'handler': 'fallback',
				'params': {},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects duplicate route shapes instead of chaining matching route handlers.',
	},
	{
		'id': 'router.order-before',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 194,
			'title': 'middleware -> handler',
		},
		'routes': [
			[
				'GET',
				'*',
				'bar',
			],
			[
				'GET',
				'/:type/:action',
				'foo',
			],
		],
		'method': 'GET',
		'path': '/posts/123',
		'expected': [
			{
				'handler': 'bar',
				'params': {},
			},
			{
				'handler': 'foo',
				'params': {
					'type': 'posts',
					'action': '123',
				},
			},
		],
		'utilsExpected': [
			{
				'handler': 'foo',
				'params': {
					'type': 'posts',
					'action': '123',
				},
			},
		],
		'difference':
			'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal. Utils selects one route owner; Hono collects matching handlers in registration order.',
	},
	{
		'id': 'router.order-after',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 203,
			'title': 'handler -> fallback',
		},
		'routes': [
			[
				'GET',
				'/:type/:action',
				'foo',
			],
			[
				'GET',
				'*',
				'fallback',
			],
		],
		'method': 'GET',
		'path': '/posts/123',
		'expected': [
			{
				'handler': 'foo',
				'params': {
					'type': 'posts',
					'action': '123',
				},
			},
			{
				'handler': 'fallback',
				'params': {},
			},
		],
		'utilsExpected': [
			{
				'handler': 'foo',
				'params': {
					'type': 'posts',
					'action': '123',
				},
			},
		],
		'difference':
			'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal. Utils selects one route owner; Hono collects matching handlers in registration order.',
	},
	{
		'id': 'router.blog-root',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 225,
			'title': 'GET /',
		},
		'routes': [
			[
				'ALL',
				'*',
				'middleware a',
			],
			[
				'GET',
				'*',
				'middleware b',
			],
			[
				'GET',
				'/entry',
				'get entries',
			],
			[
				'POST',
				'/entry/*',
				'middleware c',
			],
			[
				'POST',
				'/entry',
				'post entry',
			],
			[
				'GET',
				'/entry/:id',
				'get entry',
			],
			[
				'GET',
				'/entry/:id/comment/:comment_id',
				'get comment',
			],
		],
		'method': 'GET',
		'path': '/',
		'expected': [
			{
				'handler': 'middleware a',
				'params': {},
			},
			{
				'handler': 'middleware b',
				'params': {},
			},
		],
		'utilsExpected': [],
		'difference':
			'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal. ALL is a Hono wildcard method, not a Utils method alias. Utils selects one route owner; Hono collects matching handlers in registration order.',
	},
	{
		'id': 'router.blog-entry',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 231,
			'title': 'GET /entry/123',
		},
		'routes': [
			[
				'ALL',
				'*',
				'middleware a',
			],
			[
				'GET',
				'*',
				'middleware b',
			],
			[
				'GET',
				'/entry',
				'get entries',
			],
			[
				'POST',
				'/entry/*',
				'middleware c',
			],
			[
				'POST',
				'/entry',
				'post entry',
			],
			[
				'GET',
				'/entry/:id',
				'get entry',
			],
			[
				'GET',
				'/entry/:id/comment/:comment_id',
				'get comment',
			],
		],
		'method': 'GET',
		'path': '/entry/123',
		'expected': [
			{
				'handler': 'middleware a',
				'params': {},
			},
			{
				'handler': 'middleware b',
				'params': {},
			},
			{
				'handler': 'get entry',
				'params': {
					'id': '123',
				},
			},
		],
		'utilsExpected': [
			{
				'handler': 'get entry',
				'params': {
					'id': '123',
				},
			},
		],
		'difference':
			'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal. ALL is a Hono wildcard method, not a Utils method alias. Utils selects one route owner; Hono collects matching handlers in registration order.',
	},
	{
		'id': 'router.blog-comment',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 241,
			'title': 'GET /entry/123/comment/456',
		},
		'routes': [
			[
				'ALL',
				'*',
				'middleware a',
			],
			[
				'GET',
				'*',
				'middleware b',
			],
			[
				'GET',
				'/entry',
				'get entries',
			],
			[
				'POST',
				'/entry/*',
				'middleware c',
			],
			[
				'POST',
				'/entry',
				'post entry',
			],
			[
				'GET',
				'/entry/:id',
				'get entry',
			],
			[
				'GET',
				'/entry/:id/comment/:comment_id',
				'get comment',
			],
		],
		'method': 'GET',
		'path': '/entry/123/comment/456',
		'expected': [
			{
				'handler': 'middleware a',
				'params': {},
			},
			{
				'handler': 'middleware b',
				'params': {},
			},
			{
				'handler': 'get comment',
				'params': {
					'id': '123',
					'comment_id': '456',
				},
			},
		],
		'utilsExpected': [
			{
				'handler': 'get comment',
				'params': {
					'id': '123',
					'comment_id': '456',
				},
			},
		],
		'difference':
			'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal. ALL is a Hono wildcard method, not a Utils method alias. Utils selects one route owner; Hono collects matching handlers in registration order.',
	},
	{
		'id': 'router.blog-post',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 254,
			'title': 'POST /entry',
		},
		'routes': [
			[
				'ALL',
				'*',
				'middleware a',
			],
			[
				'GET',
				'*',
				'middleware b',
			],
			[
				'GET',
				'/entry',
				'get entries',
			],
			[
				'POST',
				'/entry/*',
				'middleware c',
			],
			[
				'POST',
				'/entry',
				'post entry',
			],
			[
				'GET',
				'/entry/:id',
				'get entry',
			],
			[
				'GET',
				'/entry/:id/comment/:comment_id',
				'get comment',
			],
		],
		'method': 'POST',
		'path': '/entry',
		'expected': [
			{
				'handler': 'middleware a',
				'params': {},
			},
			{
				'handler': 'middleware c',
				'params': {},
			},
			{
				'handler': 'post entry',
				'params': {},
			},
		],
		'utilsExpected': [
			{
				'handler': 'post entry',
				'params': {},
			},
		],
		'difference':
			'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal. ALL is a Hono wildcard method, not a Utils method alias. Utils selects one route owner; Hono collects matching handlers in registration order.',
	},
	{
		'id': 'router.blog-delete',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 261,
			'title': 'DELETE /entry',
		},
		'routes': [
			[
				'ALL',
				'*',
				'middleware a',
			],
			[
				'GET',
				'*',
				'middleware b',
			],
			[
				'GET',
				'/entry',
				'get entries',
			],
			[
				'POST',
				'/entry/*',
				'middleware c',
			],
			[
				'POST',
				'/entry',
				'post entry',
			],
			[
				'GET',
				'/entry/:id',
				'get entry',
			],
			[
				'GET',
				'/entry/:id/comment/:comment_id',
				'get comment',
			],
		],
		'method': 'DELETE',
		'path': '/entry',
		'expected': [
			{
				'handler': 'middleware a',
				'params': {},
			},
		],
		'utilsExpected': [],
		'difference':
			'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal. ALL is a Hono wildcard method, not a Utils method alias. Utils selects one route owner; Hono collects matching handlers in registration order.',
	},
	{
		'id': 'router.scoped-params',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 275,
			'title': 'GET /entry/123/show',
		},
		'routes': [
			[
				'ALL',
				'*',
				'middleware a',
			],
			[
				'GET',
				'/entry/:id/*',
				'middleware b',
			],
			[
				'GET',
				'/entry/:id/:action',
				'action',
			],
		],
		'method': 'GET',
		'path': '/entry/123/show',
		'expected': [
			{
				'handler': 'middleware a',
				'params': {},
			},
			{
				'handler': 'middleware b',
				'params': {
					'id': '123',
				},
			},
			{
				'handler': 'action',
				'params': {
					'id': '123',
					'action': 'show',
				},
			},
		],
		'utilsExpected': [
			{
				'handler': 'action',
				'params': {
					'id': '123',
					'action': 'show',
				},
			},
		],
		'difference':
			'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal. Utils selects one route owner; Hono collects matching handlers in registration order.',
	},
	{
		'id': 'router.hierarchy',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 290,
			'title': 'hierarchy',
		},
		'routes': [
			[
				'GET',
				'/posts/:id/comments/:comment_id',
				'foo',
			],
			[
				'GET',
				'/posts/:id',
				'bar',
			],
		],
		'method': 'GET',
		'path': '/',
		'expected': [],
	},
	{
		'id': 'router.duplicate-param-self',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 300,
			'title': 'self',
		},
		'routes': [
			[
				'GET',
				'/:id/:id',
				'foo',
			],
		],
		'method': 'GET',
		'path': '/123/456',
		'expected': [
			{
				'handler': 'foo',
				'params': {
					'id': '123',
				},
			},
		],
		'utilsExpected': [
			{
				'handler': 'foo',
				'params': {
					'id': '456',
				},
			},
		],
		'difference': 'Hono keeps the first duplicate parameter; Utils parseParameters retains the last occurrence.',
	},
	{
		'id': 'router.duplicate-param-parent',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 308,
			'title': 'parent',
		},
		'routes': [
			[
				'GET',
				'/:id/:action',
				'foo',
			],
			[
				'GET',
				'/posts/:id',
				'bar',
			],
		],
		'method': 'GET',
		'path': '/posts/get',
		'expected': [
			{
				'handler': 'foo',
				'params': {
					'id': 'posts',
					'action': 'get',
				},
			},
			{
				'handler': 'bar',
				'params': {
					'id': 'get',
				},
			},
		],
		'utilsExpected': [
			{
				'handler': 'bar',
				'params': {
					'id': 'get',
				},
			},
		],
		'difference':
			'Utils selects one route owner; Hono collects matching handlers in registration order. Utils chooses the more specific literal prefix.',
	},
	{
		'id': 'router.duplicate-param-child',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 320,
			'title': 'child',
		},
		'routes': [
			[
				'GET',
				'/posts/:id',
				'foo',
			],
			[
				'GET',
				'/:id/:action',
				'bar',
			],
		],
		'method': 'GET',
		'path': '/posts/get',
		'expected': [
			{
				'handler': 'foo',
				'params': {
					'id': 'get',
				},
			},
			{
				'handler': 'bar',
				'params': {
					'id': 'posts',
					'action': 'get',
				},
			},
		],
		'utilsExpected': [
			{
				'handler': 'foo',
				'params': {
					'id': 'get',
				},
			},
		],
		'difference': 'Utils selects one route owner; Hono collects matching handlers in registration order.',
	},
	{
		'id': 'router.page',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 334,
			'title': 'GET /page',
		},
		'routes': [
			[
				'GET',
				'/page',
				'page',
			],
			[
				'ALL',
				'*',
				'fallback',
			],
		],
		'method': 'GET',
		'path': '/page',
		'expected': [
			{
				'handler': 'page',
				'params': {},
			},
			{
				'handler': 'fallback',
				'params': {},
			},
		],
		'utilsExpected': [
			{
				'handler': 'page',
				'params': {},
			},
		],
		'difference':
			'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal. ALL is a Hono wildcard method, not a Utils method alias.',
	},
	{
		'id': 'router.star-root',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 355,
			'title': 'top',
		},
		'routes': [
			[
				'GET',
				'/',
				'/',
			],
			[
				'GET',
				'/*',
				'/*',
			],
			[
				'GET',
				'*',
				'*',
			],
			[
				'GET',
				'/x',
				'/x',
			],
			[
				'GET',
				'/x/*',
				'/x/*',
			],
		],
		'method': 'GET',
		'path': '/',
		'expected': [
			{
				'handler': '/',
				'params': {},
			},
			{
				'handler': '/*',
				'params': {},
			},
			{
				'handler': '*',
				'params': {},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils normalizes * and /* to the same literal route and rejects duplicate ownership.',
	},
	{
		'id': 'router.star-child',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 363,
			'title': 'Under a certain path',
		},
		'routes': [
			[
				'GET',
				'/',
				'/',
			],
			[
				'GET',
				'/*',
				'/*',
			],
			[
				'GET',
				'*',
				'*',
			],
			[
				'GET',
				'/x',
				'/x',
			],
			[
				'GET',
				'/x/*',
				'/x/*',
			],
		],
		'method': 'GET',
		'path': '/x',
		'expected': [
			{
				'handler': '/*',
				'params': {},
			},
			{
				'handler': '*',
				'params': {},
			},
			{
				'handler': '/x',
				'params': {},
			},
			{
				'handler': '/x/*',
				'params': {},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils normalizes * and /* to the same literal route and rejects duplicate ownership.',
	},
	{
		'id': 'router.suffix-378',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 378,
			'title': 'GET /assets',
		},
		'routes': [
			[
				'GET',
				'/assets*',
				'assets',
			],
		],
		'method': 'GET',
		'path': '/assets',
		'expected': [
			{
				'handler': 'assets',
				'params': {},
			},
		],
		'utilsExpected': [],
		'difference': 'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal.',
	},
	{
		'id': 'router.suffix-384',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 384,
			'title': 'GET /assets-v2',
		},
		'routes': [
			[
				'GET',
				'/assets*',
				'assets',
			],
		],
		'method': 'GET',
		'path': '/assets-v2',
		'expected': [
			{
				'handler': 'assets',
				'params': {},
			},
		],
		'utilsExpected': [],
		'difference': 'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal.',
	},
	{
		'id': 'router.suffix-390',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 390,
			'title': 'GET /assets/app.js',
		},
		'routes': [
			[
				'GET',
				'/assets*',
				'assets',
			],
		],
		'method': 'GET',
		'path': '/assets/app.js',
		'expected': [
			{
				'handler': 'assets',
				'params': {},
			},
		],
		'utilsExpected': [],
		'difference': 'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal.',
	},
	{
		'id': 'router.suffix-396',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 396,
			'title': 'GET /asset',
		},
		'routes': [
			[
				'GET',
				'/assets*',
				'assets',
			],
		],
		'method': 'GET',
		'path': '/asset',
		'expected': [],
		'utilsExpected': [],
		'difference': 'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal.',
	},
	{
		'id': 'router.trailing-star-417',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 417,
			'title': 'GET /path',
		},
		'routes': [
			[
				'GET',
				'/path/*',
				'path',
			],
		],
		'method': 'GET',
		'path': '/path',
		'expected': [
			{
				'handler': 'path',
				'params': {},
			},
		],
		'utilsExpected': [],
		'difference': 'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal.',
	},
	{
		'id': 'router.trailing-star-423',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 423,
			'title': 'GET /path/to/file',
		},
		'routes': [
			[
				'GET',
				'/path/*',
				'path',
			],
		],
		'method': 'GET',
		'path': '/path/to/file',
		'expected': [
			{
				'handler': 'path',
				'params': {},
			},
		],
		'utilsExpected': [],
		'difference': 'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal.',
	},
	{
		'id': 'router.trailing-star-429',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 429,
			'title': 'GET /pathfoo',
		},
		'routes': [
			[
				'GET',
				'/path/*',
				'path',
			],
		],
		'method': 'GET',
		'path': '/pathfoo',
		'expected': [],
		'utilsExpected': [],
		'difference': 'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal.',
	},
	{
		'id': 'router.label-star-441',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 441,
			'title': 'GET /abc',
		},
		'routes': [
			[
				'GET',
				'/:name/*',
				'middleware',
			],
			[
				'GET',
				'/:id',
				'handler',
			],
		],
		'method': 'GET',
		'path': '/abc',
		'expected': [
			{
				'handler': 'middleware',
				'params': {
					'name': 'abc',
				},
			},
			{
				'handler': 'handler',
				'params': {
					'id': 'abc',
				},
			},
		],
		'utilsExpected': [
			{
				'handler': 'handler',
				'params': {
					'id': 'abc',
				},
			},
		],
		'difference':
			'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal. Utils selects one route owner; Hono collects matching handlers in registration order.',
	},
	{
		'id': 'router.label-star-448',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 448,
			'title': 'GET /abc/sub',
		},
		'routes': [
			[
				'GET',
				'/:name/*',
				'middleware',
			],
			[
				'GET',
				'/:id',
				'handler',
			],
		],
		'method': 'GET',
		'path': '/abc/sub',
		'expected': [
			{
				'handler': 'middleware',
				'params': {
					'name': 'abc',
				},
			},
		],
		'utilsExpected': [],
		'difference':
			'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal. Utils selects one route owner; Hono collects matching handlers in registration order.',
	},
	{
		'id': 'router.pattern-star-460',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 460,
			'title': 'GET /abc',
		},
		'routes': [
			[
				'GET',
				'/:name{[a-z]+}/*',
				'middleware',
			],
			[
				'GET',
				'/:id{[a-z]+}',
				'handler',
			],
		],
		'method': 'GET',
		'path': '/abc',
		'expected': [
			{
				'handler': 'middleware',
				'params': {
					'name': 'abc',
				},
			},
			{
				'handler': 'handler',
				'params': {
					'id': 'abc',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.pattern-star-467',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 467,
			'title': 'GET /reverse/abc in reverse registration order',
		},
		'routes': [
			[
				'GET',
				'/reverse/:id{[a-z]+}',
				'handler',
			],
			[
				'GET',
				'/reverse/:name{[a-z]+}/*',
				'middleware',
			],
		],
		'method': 'GET',
		'path': '/reverse/abc',
		'expected': [
			{
				'handler': 'handler',
				'params': {
					'id': 'abc',
				},
			},
			{
				'handler': 'middleware',
				'params': {
					'name': 'abc',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.pattern-star-475',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 475,
			'title': 'POST /all/abc with ALL middleware',
		},
		'routes': [
			[
				'ALL',
				'/all/:name{[a-z]+}/*',
				'middleware',
			],
			[
				'POST',
				'/all/:id{[a-z]+}',
				'handler',
			],
		],
		'method': 'POST',
		'path': '/all/abc',
		'expected': [
			{
				'handler': 'middleware',
				'params': {
					'name': 'abc',
				},
			},
			{
				'handler': 'handler',
				'params': {
					'id': 'abc',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.pattern-star-483',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 483,
			'title': 'GET /posts/2024/comments with nested braces',
		},
		'routes': [
			[
				'GET',
				'/posts/:year{[0-9]{4}}/*',
				'middleware',
			],
			[
				'GET',
				'/posts/:yr{[0-9]{4}}/comments',
				'handler',
			],
		],
		'method': 'GET',
		'path': '/posts/2024/comments',
		'expected': [
			{
				'handler': 'middleware',
				'params': {
					'year': '2024',
				},
			},
			{
				'handler': 'handler',
				'params': {
					'yr': '2024',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.pattern-star-494',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 494,
			'title': 'GET /files/foo/detail with regexp meta characters',
		},
		'routes': [
			[
				'GET',
				'/files/:kind{(?:foo|bar)}/*',
				'middleware',
			],
			[
				'GET',
				'/files/:type{(?:foo|bar)}/detail',
				'handler',
			],
		],
		'method': 'GET',
		'path': '/files/foo/detail',
		'expected': [
			{
				'handler': 'middleware',
				'params': {
					'kind': 'foo',
				},
			},
			{
				'handler': 'handler',
				'params': {
					'type': 'foo',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.pattern-star-505',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 505,
			'title': 'GET /user/123/profile with the default pattern',
		},
		'routes': [
			[
				'GET',
				'/user/:userId{[^/]+}/*',
				'middleware',
			],
			[
				'GET',
				'/user/:id/profile',
				'handler',
			],
		],
		'method': 'GET',
		'path': '/user/123/profile',
		'expected': [
			{
				'handler': 'middleware',
				'params': {
					'userId': '123',
				},
			},
			{
				'handler': 'handler',
				'params': {
					'id': '123',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.pattern-star-516',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 516,
			'title': 'GET /user/123/profile with the default pattern in reverse registration order',
		},
		'routes': [
			[
				'GET',
				'/user/:id/profile',
				'handler',
			],
			[
				'GET',
				'/user/:userId{[^/]+}/*',
				'middleware',
			],
		],
		'method': 'GET',
		'path': '/user/123/profile',
		'expected': [
			{
				'handler': 'handler',
				'params': {
					'id': '123',
				},
			},
			{
				'handler': 'middleware',
				'params': {
					'userId': '123',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.middle-star-533',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 533,
			'title': 'GET /a/x/b',
		},
		'routes': [
			[
				'GET',
				'/a/*/b/*',
				'b',
			],
		],
		'method': 'GET',
		'path': '/a/x/b',
		'expected': [
			{
				'handler': 'b',
				'params': {},
			},
		],
		'utilsExpected': [],
		'difference': 'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal.',
	},
	{
		'id': 'router.middle-star-539',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 539,
			'title': 'GET /a/x/b/c',
		},
		'routes': [
			[
				'GET',
				'/a/*/b/*',
				'b',
			],
		],
		'method': 'GET',
		'path': '/a/x/b/c',
		'expected': [
			{
				'handler': 'b',
				'params': {},
			},
		],
		'utilsExpected': [],
		'difference': 'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal.',
	},
	{
		'id': 'router.middle-star-545',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 545,
			'title': 'GET /a/x/bz',
		},
		'routes': [
			[
				'GET',
				'/a/*/b/*',
				'b',
			],
		],
		'method': 'GET',
		'path': '/a/x/bz',
		'expected': [],
		'utilsExpected': [],
		'difference': 'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal.',
	},
	{
		'id': 'router.optional-557',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 557,
			'title': 'GET /api/animals/dog',
		},
		'routes': [
			[
				'GET',
				'/api/animals/:type?',
				'animals',
			],
			[
				'GET',
				'/v1/:version?/:platform?',
				'result',
			],
		],
		'method': 'GET',
		'path': '/api/animals/dog',
		'expected': [
			{
				'handler': 'animals',
				'params': {
					'type': 'dog',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.optional-563',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 563,
			'title': 'GET /api/animals',
		},
		'routes': [
			[
				'GET',
				'/api/animals/:type?',
				'animals',
			],
			[
				'GET',
				'/v1/:version?/:platform?',
				'result',
			],
		],
		'method': 'GET',
		'path': '/api/animals',
		'expected': [
			{
				'handler': 'animals',
				'params': {},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.optional-569',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 569,
			'title': 'GET /v1/123/abc',
		},
		'routes': [
			[
				'GET',
				'/api/animals/:type?',
				'animals',
			],
			[
				'GET',
				'/v1/:version?/:platform?',
				'result',
			],
		],
		'method': 'GET',
		'path': '/v1/123/abc',
		'expected': [
			{
				'handler': 'result',
				'params': {
					'version': '123',
					'platform': 'abc',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.optional-576',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 576,
			'title': 'GET /v1/123',
		},
		'routes': [
			[
				'GET',
				'/api/animals/:type?',
				'animals',
			],
			[
				'GET',
				'/v1/:version?/:platform?',
				'result',
			],
		],
		'method': 'GET',
		'path': '/v1/123',
		'expected': [
			{
				'handler': 'result',
				'params': {
					'version': '123',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.optional-583',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 583,
			'title': 'GET /v1',
		},
		'routes': [
			[
				'GET',
				'/api/animals/:type?',
				'animals',
			],
			[
				'GET',
				'/v1/:version?/:platform?',
				'result',
			],
		],
		'method': 'GET',
		'path': '/v1',
		'expected': [
			{
				'handler': 'result',
				'params': {},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.all',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 598,
			'title': 'GET, all hello',
		},
		'routes': [
			[
				'GET',
				'/hello',
				'get hello',
			],
			[
				'ALL',
				'/all',
				'get all',
			],
		],
		'method': 'GET',
		'path': '/all',
		'expected': [
			{
				'handler': 'get all',
				'params': {},
			},
		],
		'utilsExpected': [],
		'difference': 'ALL is a Hono wildcard method, not a Utils method alias.',
	},
	{
		'id': 'router.prefix-613',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 613,
			'title': 'GET /',
		},
		'routes': [
			[
				'GET',
				'/long/prefix/*',
				'long-prefix',
			],
			[
				'GET',
				'/long/*',
				'long',
			],
			[
				'GET',
				'*',
				'star1',
			],
			[
				'GET',
				'*',
				'star2',
			],
		],
		'method': 'GET',
		'path': '/',
		'expected': [
			{
				'handler': 'star1',
				'params': {},
			},
			{
				'handler': 'star2',
				'params': {},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Repeated terminal route shapes are rejected by Utils; Hono retains each handler.',
	},
	{
		'id': 'router.prefix-620',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 620,
			'title': 'GET /long/prefix',
		},
		'routes': [
			[
				'GET',
				'/long/prefix/*',
				'long-prefix',
			],
			[
				'GET',
				'/long/*',
				'long',
			],
			[
				'GET',
				'*',
				'star1',
			],
			[
				'GET',
				'*',
				'star2',
			],
		],
		'method': 'GET',
		'path': '/long/prefix',
		'expected': [
			{
				'handler': 'long-prefix',
				'params': {},
			},
			{
				'handler': 'long',
				'params': {},
			},
			{
				'handler': 'star1',
				'params': {},
			},
			{
				'handler': 'star2',
				'params': {},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Repeated terminal route shapes are rejected by Utils; Hono retains each handler.',
	},
	{
		'id': 'router.prefix-629',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 629,
			'title': 'GET /long/prefix/test',
		},
		'routes': [
			[
				'GET',
				'/long/prefix/*',
				'long-prefix',
			],
			[
				'GET',
				'/long/*',
				'long',
			],
			[
				'GET',
				'*',
				'star1',
			],
			[
				'GET',
				'*',
				'star2',
			],
		],
		'method': 'GET',
		'path': '/long/prefix/test',
		'expected': [
			{
				'handler': 'long-prefix',
				'params': {},
			},
			{
				'handler': 'long',
				'params': {},
			},
			{
				'handler': 'star1',
				'params': {},
			},
			{
				'handler': 'star2',
				'params': {},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Repeated terminal route shapes are rejected by Utils; Hono retains each handler.',
	},
	{
		'id': 'router.prefix-647',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 647,
			'title': 'GET /',
		},
		'routes': [
			[
				'ALL',
				'/long/prefix/*',
				'long-prefix',
			],
			[
				'ALL',
				'/long/*',
				'long',
			],
			[
				'GET',
				'*',
				'star1',
			],
			[
				'GET',
				'*',
				'star2',
			],
		],
		'method': 'GET',
		'path': '/',
		'expected': [
			{
				'handler': 'star1',
				'params': {},
			},
			{
				'handler': 'star2',
				'params': {},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Repeated terminal route shapes are rejected by Utils; Hono retains each handler.',
	},
	{
		'id': 'router.prefix-654',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 654,
			'title': 'GET /long/prefix',
		},
		'routes': [
			[
				'ALL',
				'/long/prefix/*',
				'long-prefix',
			],
			[
				'ALL',
				'/long/*',
				'long',
			],
			[
				'GET',
				'*',
				'star1',
			],
			[
				'GET',
				'*',
				'star2',
			],
		],
		'method': 'GET',
		'path': '/long/prefix',
		'expected': [
			{
				'handler': 'long-prefix',
				'params': {},
			},
			{
				'handler': 'long',
				'params': {},
			},
			{
				'handler': 'star1',
				'params': {},
			},
			{
				'handler': 'star2',
				'params': {},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Repeated terminal route shapes are rejected by Utils; Hono retains each handler.',
	},
	{
		'id': 'router.prefix-663',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 663,
			'title': 'GET /long/prefix/test',
		},
		'routes': [
			[
				'ALL',
				'/long/prefix/*',
				'long-prefix',
			],
			[
				'ALL',
				'/long/*',
				'long',
			],
			[
				'GET',
				'*',
				'star1',
			],
			[
				'GET',
				'*',
				'star2',
			],
		],
		'method': 'GET',
		'path': '/long/prefix/test',
		'expected': [
			{
				'handler': 'long-prefix',
				'params': {},
			},
			{
				'handler': 'long',
				'params': {},
			},
			{
				'handler': 'star1',
				'params': {},
			},
			{
				'handler': 'star2',
				'params': {},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Repeated terminal route shapes are rejected by Utils; Hono retains each handler.',
	},
	{
		'id': 'router.slash-capture-679',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 679,
			'title': 'GET /js/main.js',
		},
		'routes': [
			[
				'GET',
				'/js/:filename{[a-z0-9/]+.js}',
				'any file',
			],
			[
				'GET',
				'/js/main.js',
				'main.js',
			],
		],
		'method': 'GET',
		'path': '/js/main.js',
		'expected': [
			{
				'handler': 'any file',
				'params': {
					'filename': 'main.js',
				},
			},
			{
				'handler': 'main.js',
				'params': {},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.slash-capture-690',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 690,
			'title': 'GET /js/chunk/123.js',
		},
		'routes': [
			[
				'GET',
				'/js/:filename{[a-z0-9/]+.js}',
				'any file',
			],
		],
		'method': 'GET',
		'path': '/js/chunk/123.js',
		'expected': [
			{
				'handler': 'any file',
				'params': {
					'filename': 'chunk/123.js',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.slash-capture-697',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 697,
			'title': 'GET /js/chunk/nest/123.js',
		},
		'routes': [
			[
				'GET',
				'/js/:filename{[a-z0-9/]+.js}',
				'any file',
			],
		],
		'method': 'GET',
		'path': '/js/chunk/nest/123.js',
		'expected': [
			{
				'handler': 'any file',
				'params': {
					'filename': 'chunk/nest/123.js',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.directories-710',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 710,
			'title': 'GET /foo/bar/file.html',
		},
		'routes': [
			[
				'GET',
				'/:dirs{.+}/file.html',
				'file.html',
			],
		],
		'method': 'GET',
		'path': '/foo/bar/file.html',
		'expected': [
			{
				'handler': 'file.html',
				'params': {
					'dirs': 'foo/bar',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.directories-717',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 717,
			'title': 'GET /foo/bar/baz/file.html',
		},
		'routes': [
			[
				'GET',
				'/:dirs{.+}/file.html',
				'file.html',
			],
		],
		'method': 'GET',
		'path': '/foo/bar/baz/file.html',
		'expected': [
			{
				'handler': 'file.html',
				'params': {
					'dirs': 'foo/bar/baz',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.directories-724',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 724,
			'title': 'GET /a/b/c/d/file.html',
		},
		'routes': [
			[
				'GET',
				'/:dirs{.+}/file.html',
				'file.html',
			],
		],
		'method': 'GET',
		'path': '/a/b/c/d/file.html',
		'expected': [
			{
				'handler': 'file.html',
				'params': {
					'dirs': 'a/b/c/d',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.regex-middle-star',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 737,
			'title': 'GET /foo/bar/file.html',
		},
		'routes': [
			[
				'GET',
				'/:dir{[a-z]+}/*/file.html',
				'file.html',
			],
		],
		'method': 'GET',
		'path': '/foo/bar/file.html',
		'expected': [
			{
				'handler': 'file.html',
				'params': {
					'dir': 'foo',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.regex-empty-remainder',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 750,
			'title': 'GET /123',
		},
		'routes': [
			[
				'GET',
				'/:id{[0-9]+}/*',
				'regexp',
			],
		],
		'method': 'GET',
		'path': '/123',
		'expected': [
			{
				'handler': 'regexp',
				'params': {
					'id': '123',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.regex-sibling',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 764,
			'title': 'GET /regex-abc/123/ghi',
		},
		'routes': [
			[
				'GET',
				'/regex-abc/:id{[0-9]+}/*',
				'middleware',
			],
			[
				'GET',
				'/regex-abc/:id{[0-9]+}/def',
				'regexp',
			],
		],
		'method': 'GET',
		'path': '/regex-abc/123/ghi',
		'expected': [
			{
				'handler': 'middleware',
				'params': {
					'id': '123',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.complex-directory-779',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 779,
			'title': 'GET /part1/middle-b/latest',
		},
		'routes': [
			[
				'GET',
				'/:first{.+}/middle-a/:reference?',
				'1',
			],
			[
				'GET',
				'/:first{.+}/middle-b/end-c/:uuid',
				'2',
			],
			[
				'GET',
				'/:first{.+}/middle-b/:digest',
				'3',
			],
		],
		'method': 'GET',
		'path': '/part1/middle-b/latest',
		'expected': [
			{
				'handler': '3',
				'params': {
					'first': 'part1',
					'digest': 'latest',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.complex-directory-787',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 787,
			'title': 'GET /part1/middle-b/end-c/latest',
		},
		'routes': [
			[
				'GET',
				'/:first{.+}/middle-a/:reference?',
				'1',
			],
			[
				'GET',
				'/:first{.+}/middle-b/end-c/:uuid',
				'2',
			],
			[
				'GET',
				'/:first{.+}/middle-b/:digest',
				'3',
			],
		],
		'method': 'GET',
		'path': '/part1/middle-b/end-c/latest',
		'expected': [
			{
				'handler': '2',
				'params': {
					'first': 'part1',
					'uuid': 'latest',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.directory-optional-801',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 801,
			'title': 'GET /foo/bar/contents',
		},
		'routes': [
			[
				'GET',
				'/:prefix{.+}/contents/:id?',
				'contents',
			],
		],
		'method': 'GET',
		'path': '/foo/bar/contents',
		'expected': [
			{
				'handler': 'contents',
				'params': {
					'prefix': 'foo/bar',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.directory-optional-809',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 809,
			'title': 'GET /foo/bar/contents/123',
		},
		'routes': [
			[
				'GET',
				'/:prefix{.+}/contents/:id?',
				'contents',
			],
		],
		'method': 'GET',
		'path': '/foo/bar/contents/123',
		'expected': [
			{
				'handler': 'contents',
				'params': {
					'prefix': 'foo/bar',
					'id': '123',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.punctuation-826',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 826,
			'title': 'GET /$/hono',
		},
		'routes': [
			[
				'ALL',
				'/$/*',
				'middleware $',
			],
			[
				'GET',
				'/$/:name',
				'get $ name',
			],
			[
				'ALL',
				'/()/*',
				'middleware ()',
			],
			[
				'GET',
				'/()/:name',
				'get () name',
			],
		],
		'method': 'GET',
		'path': '/$/hono',
		'expected': [
			{
				'handler': 'middleware $',
				'params': {},
			},
			{
				'handler': 'get $ name',
				'params': {
					'name': 'hono',
				},
			},
		],
		'utilsExpected': [
			{
				'handler': 'get $ name',
				'params': {
					'name': 'hono',
				},
			},
		],
		'difference':
			'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal. ALL is a Hono wildcard method, not a Utils method alias.',
	},
	{
		'id': 'router.punctuation-835',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 835,
			'title': 'GET /()/hono',
		},
		'routes': [
			[
				'ALL',
				'/$/*',
				'middleware $',
			],
			[
				'GET',
				'/$/:name',
				'get $ name',
			],
			[
				'ALL',
				'/()/*',
				'middleware ()',
			],
			[
				'GET',
				'/()/:name',
				'get () name',
			],
		],
		'method': 'GET',
		'path': '/()/hono',
		'expected': [
			{
				'handler': 'middleware ()',
				'params': {},
			},
			{
				'handler': 'get () name',
				'params': {
					'name': 'hono',
				},
			},
		],
		'utilsExpected': [
			{
				'handler': 'get () name',
				'params': {
					'name': 'hono',
				},
			},
		],
		'difference':
			'Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal. ALL is a Hono wildcard method, not a Utils method alias.',
	},
	{
		'id': 'router.rest-851',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 851,
			'title': 'GET /users/hono',
		},
		'routes': [
			[
				'GET',
				'/users/:username{[a-z]+}',
				'profile',
			],
			[
				'GET',
				'/users/:username{[a-z]+}/posts',
				'posts',
			],
		],
		'method': 'GET',
		'path': '/users/hono',
		'expected': [
			{
				'handler': 'profile',
				'params': {
					'username': 'hono',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.rest-857',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 857,
			'title': 'GET /users/hono/posts',
		},
		'routes': [
			[
				'GET',
				'/users/:username{[a-z]+}',
				'profile',
			],
			[
				'GET',
				'/users/:username{[a-z]+}/posts',
				'posts',
			],
		],
		'method': 'GET',
		'path': '/users/hono/posts',
		'expected': [
			{
				'handler': 'posts',
				'params': {
					'username': 'hono',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.slash-870',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 870,
			'title': 'GET /book',
		},
		'routes': [
			[
				'GET',
				'/book',
				'GET /book',
			],
			[
				'GET',
				'/book/:id',
				'GET /book/:id',
			],
		],
		'method': 'GET',
		'path': '/book',
		'expected': [
			{
				'handler': 'GET /book',
				'params': {},
			},
		],
	},
	{
		'id': 'router.slash-875',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 875,
			'title': 'GET /book/',
		},
		'routes': [
			[
				'GET',
				'/book',
				'GET /book',
			],
			[
				'GET',
				'/book/:id',
				'GET /book/:id',
			],
		],
		'method': 'GET',
		'path': '/book/',
		'expected': [],
	},
	{
		'id': 'router.same-path',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 887,
			'title': 'GET /hey',
		},
		'routes': [
			[
				'GET',
				'/hey',
				'Middleware A',
			],
			[
				'GET',
				'/hey',
				'Middleware B',
			],
		],
		'method': 'GET',
		'path': '/hey',
		'expected': [
			{
				'handler': 'Middleware A',
				'params': {},
			},
			{
				'handler': 'Middleware B',
				'params': {},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Duplicate Utils route ownership is rejected; use explicit middleware composition.',
	},
	{
		'id': 'router.hostname-900',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 900,
			'title': 'GET www1.example.com/hello',
		},
		'routes': [
			[
				'GET',
				'www1.example.com/hello',
				'www1',
			],
			[
				'GET',
				'www2.example.com/hello',
				'www2',
			],
		],
		'method': 'GET',
		'path': 'www1.example.com/hello',
		'expected': [
			{
				'handler': 'www1',
				'params': {},
			},
		],
		'utilsExpected': [],
		'difference': 'Hono raw routers can match hostname-prefixed keys; Utils expects pathname keys.',
	},
	{
		'id': 'router.hostname-905',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 905,
			'title': 'GET www2.example.com/hello',
		},
		'routes': [
			[
				'GET',
				'www1.example.com/hello',
				'www1',
			],
			[
				'GET',
				'www2.example.com/hello',
				'www2',
			],
		],
		'method': 'GET',
		'path': 'www2.example.com/hello',
		'expected': [
			{
				'handler': 'www2',
				'params': {},
			},
		],
		'utilsExpected': [],
		'difference': 'Hono raw routers can match hostname-prefixed keys; Utils expects pathname keys.',
	},
	{
		'id': 'router.hostname-910',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 910,
			'title': 'GET /hello',
		},
		'routes': [
			[
				'GET',
				'www1.example.com/hello',
				'www1',
			],
			[
				'GET',
				'www2.example.com/hello',
				'www2',
			],
		],
		'method': 'GET',
		'path': '/hello',
		'expected': [],
		'utilsExpected': [],
		'difference': 'Hono raw routers can match hostname-prefixed keys; Utils expects pathname keys.',
	},
	{
		'id': 'router.all-static',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 922,
			'title': 'get /foo',
		},
		'routes': [
			[
				'ALL',
				'/foo',
				'foo',
			],
			[
				'GET',
				'/bar',
				'bar',
			],
		],
		'method': 'GET',
		'path': '/foo',
		'expected': [
			{
				'handler': 'foo',
				'params': {},
			},
		],
		'utilsExpected': [],
		'difference': 'ALL is a Hono wildcard method, not a Utils method alias.',
	},
	{
		'id': 'router.all-star',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 934,
			'title': 'Should return /x and star',
		},
		'routes': [
			[
				'ALL',
				'/x',
				'/x',
			],
			[
				'GET',
				'*',
				'star',
			],
		],
		'method': 'GET',
		'path': '/x',
		'expected': [
			{
				'handler': '/x',
				'params': {},
			},
			{
				'handler': 'star',
				'params': {},
			},
		],
		'utilsExpected': [],
		'difference':
			'ALL is a Hono wildcard method, not a Utils method alias. Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal.',
	},
	{
		'id': 'router.many-star',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 950,
			'title': 'Should return /x and star',
		},
		'routes': [
			[
				'GET',
				'*',
				'star1',
			],
			[
				'ALL',
				'/x',
				'/x',
			],
			[
				'GET',
				'*',
				'star2',
			],
			[
				'GET',
				'*',
				'star3',
			],
		],
		'method': 'GET',
		'path': '/x',
		'expected': [
			{
				'handler': 'star1',
				'params': {},
			},
			{
				'handler': '/x',
				'params': {},
			},
			{
				'handler': 'star2',
				'params': {},
			},
			{
				'handler': 'star3',
				'params': {},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference':
			'Utils selects one route owner; Hono collects matching handlers in registration order. Duplicate Utils route ownership is rejected.',
	},
	{
		'id': 'router.mixed-star',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 969,
			'title': 'Should return star1, star2, and bar',
		},
		'routes': [
			[
				'GET',
				'/y/*',
				'star1',
			],
			[
				'GET',
				'/y/a',
				'a',
			],
			[
				'ALL',
				'/y/b/*',
				'star2',
			],
			[
				'GET',
				'/y/b/bar',
				'bar',
			],
		],
		'method': 'GET',
		'path': '/y/b/bar',
		'expected': [
			{
				'handler': 'star1',
				'params': {},
			},
			{
				'handler': 'star2',
				'params': {},
			},
			{
				'handler': 'bar',
				'params': {},
			},
		],
		'utilsExpected': [
			{
				'handler': 'bar',
				'params': {},
			},
		],
		'difference':
			'Utils selects one route owner; Hono collects matching handlers in registration order. Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal.',
	},
	{
		'id': 'router.all-many-star',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 987,
			'title': 'Should return wildcard, star2 and bar',
		},
		'routes': [
			[
				'ALL',
				'*',
				'wildcard',
			],
			[
				'ALL',
				'/a/*',
				'star1',
			],
			[
				'GET',
				'/a/foo',
				'foo',
			],
			[
				'ALL',
				'/b/*',
				'star2',
			],
			[
				'GET',
				'/b/bar',
				'bar',
			],
		],
		'method': 'GET',
		'path': '/b/bar',
		'expected': [
			{
				'handler': 'wildcard',
				'params': {},
			},
			{
				'handler': 'star2',
				'params': {},
			},
			{
				'handler': 'bar',
				'params': {},
			},
		],
		'utilsExpected': [
			{
				'handler': 'bar',
				'params': {},
			},
		],
		'difference':
			'Utils selects one route owner; Hono collects matching handlers in registration order. Hono wildcard grammar is not implemented by Utils; a star in a Utils route is literal. ALL is a Hono wildcard method, not a Utils method alias.',
	},
	{
		'id': 'router.capture-1002',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 1002,
			'title': 'GET /foo/bar',
		},
		'routes': [
			[
				'get',
				'/foo/:capture{(bar|baz)}',
				'ok',
			],
		],
		'method': 'get',
		'path': '/foo/bar',
		'expected': [
			{
				'handler': 'ok',
				'params': {
					'capture': 'bar',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.capture-1009',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 1009,
			'title': 'GET /foo/baz',
		},
		'routes': [
			[
				'get',
				'/foo/:capture{(bar|baz)}',
				'ok',
			],
		],
		'method': 'get',
		'path': '/foo/baz',
		'expected': [
			{
				'handler': 'ok',
				'params': {
					'capture': 'baz',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.capture-1016',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 1016,
			'title': 'GET /foo/qux',
		},
		'routes': [
			[
				'get',
				'/foo/:capture{(bar|baz)}',
				'ok',
			],
		],
		'method': 'get',
		'path': '/foo/qux',
		'expected': [],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.capture-1027',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 1027,
			'title': 'GET /foo/bar',
		},
		'routes': [
			[
				'get',
				'/foo/:capture{(?:bar|baz)}',
				'ok',
			],
		],
		'method': 'get',
		'path': '/foo/bar',
		'expected': [
			{
				'handler': 'ok',
				'params': {
					'capture': 'bar',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.capture-1034',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 1034,
			'title': 'GET /foo/baz',
		},
		'routes': [
			[
				'get',
				'/foo/:capture{(?:bar|baz)}',
				'ok',
			],
		],
		'method': 'get',
		'path': '/foo/baz',
		'expected': [
			{
				'handler': 'ok',
				'params': {
					'capture': 'baz',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.capture-1041',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 1041,
			'title': 'GET /foo/qux',
		},
		'routes': [
			[
				'get',
				'/foo/:capture{(?:bar|baz)}',
				'ok',
			],
		],
		'method': 'get',
		'path': '/foo/qux',
		'expected': [],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.capture-1052',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 1052,
			'title': 'GET /foo/bar',
		},
		'routes': [
			[
				'get',
				'/foo/:capture{ba(?:r|z)}',
				'ok',
			],
		],
		'method': 'get',
		'path': '/foo/bar',
		'expected': [
			{
				'handler': 'ok',
				'params': {
					'capture': 'bar',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.capture-1059',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 1059,
			'title': 'GET /foo/baz',
		},
		'routes': [
			[
				'get',
				'/foo/:capture{ba(?:r|z)}',
				'ok',
			],
		],
		'method': 'get',
		'path': '/foo/baz',
		'expected': [
			{
				'handler': 'ok',
				'params': {
					'capture': 'baz',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.capture-1066',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 1066,
			'title': 'GET /foo/qux',
		},
		'routes': [
			[
				'get',
				'/foo/:capture{ba(?:r|z)}',
				'ok',
			],
		],
		'method': 'get',
		'path': '/foo/qux',
		'expected': [],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.complex-capture',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 1073,
			'title': 'GET request',
		},
		'routes': [
			[
				'get',
				'/foo/:capture{ba(r|z)}',
				'ok',
			],
		],
		'method': 'get',
		'path': '/foo/bar',
		'expected': [
			{
				'handler': 'ok',
				'params': {
					'capture': 'bar',
				},
			},
		],
		'utilsExpected': 'registration-rejected',
		'difference': 'Utils rejects regular-expression or optional parameter syntax during route preparation.',
	},
	{
		'id': 'router.unknown-1089',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 1089,
			'title': 'UNKNOWN_METHOD /',
		},
		'routes': [
			[
				'GET',
				'/',
				'index',
			],
			[
				'ALL',
				'/all',
				'all',
			],
		],
		'method': 'UNKNOWN_METHOD',
		'path': '/',
		'expected': [],
		'utilsExpected': [],
		'difference': 'ALL is a Hono wildcard method, not a Utils method alias.',
	},
	{
		'id': 'router.unknown-1094',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 1094,
			'title': 'UNKNOWN_METHOD /all',
		},
		'routes': [
			[
				'GET',
				'/',
				'index',
			],
			[
				'ALL',
				'/all',
				'all',
			],
		],
		'method': 'UNKNOWN_METHOD',
		'path': '/all',
		'expected': [
			{
				'handler': 'all',
				'params': {},
			},
		],
		'utilsExpected': [],
		'difference': 'ALL is a Hono wildcard method, not a Utils method alias.',
	},
	{
		'id': 'router.suffix-order-0',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 401,
			'title': 'associates %s before %s',
		},
		'routes': [
			[
				'POST',
				'/assets*',
				'/assets*',
			],
			[
				'POST',
				'/assets/app.js',
				'/assets/app.js',
			],
		],
		'method': 'POST',
		'path': '/assets/app.js',
		'expected': [
			{
				'handler': '/assets*',
				'params': {},
			},
			{
				'handler': '/assets/app.js',
				'params': {},
			},
		],
		'utilsExpected': [
			{
				'handler': '/assets/app.js',
				'params': {},
			},
		],
		'difference':
			'Hono collects both wildcard and static matches in registration order. Utils selects the static owner and treats star as a literal.',
	},
	{
		'id': 'router.suffix-order-1',
		'source': {
			'path': 'src/router/common.case.test.ts',
			'line': 401,
			'title': 'associates %s before %s',
		},
		'routes': [
			[
				'POST',
				'/assets/app.js',
				'/assets/app.js',
			],
			[
				'POST',
				'/assets*',
				'/assets*',
			],
		],
		'method': 'POST',
		'path': '/assets/app.js',
		'expected': [
			{
				'handler': '/assets/app.js',
				'params': {},
			},
			{
				'handler': '/assets*',
				'params': {},
			},
		],
		'utilsExpected': [
			{
				'handler': '/assets/app.js',
				'params': {},
			},
		],
		'difference':
			'Hono collects both wildcard and static matches in registration order. Utils selects the static owner and treats star as a literal.',
	},
];
