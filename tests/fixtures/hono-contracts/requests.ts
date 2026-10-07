/** Adapted upstream literal observations. See README.md and HONO-LICENSE. @module */
import type { RequestCaseType } from './types.ts';

export const requestCases: readonly RequestCaseType[] = [
	{
		'id': 'request.query',
		'source': {
			'path': 'src/request.test.ts',
			'line': 10,
			'title': 'req.query() and req.queries()',
		},
		'operation': 'query',
		'expected': {
			'page': '2',
			'q': null,
			'tag': [
				'A',
				'B',
			],
			'q2': null,
		},
		'url': 'http://localhost?page=2&tag=A&tag=B',
		'keys': [
			'page',
			'q',
			'tag',
			'q2',
		],
	},
	{
		'id': 'request.query-special',
		'source': {
			'path': 'src/request.test.ts',
			'line': 29,
			'title': 'decode special chars',
		},
		'operation': 'query',
		'expected': {
			'mail': 'framework@hono.dev',
			'tag': [
				'@1',
				'@2',
			],
		},
		'url': 'http://localhost?mail=framework%40hono.dev&tag=%401&tag=%402',
		'keys': [
			'mail',
			'tag',
		],
	},
	{
		'id': 'request.empty-header',
		'source': {
			'path': 'src/request.test.ts',
			'line': 227,
			'title': 'empty string is a valid header value',
		},
		'operation': 'headers',
		'expected': {
			'foo': '',
		},
		'headers': {
			'foo': '',
		},
		'keys': [
			'foo',
		],
	},
	{
		'id': 'request.header-casing',
		'source': {
			'path': 'src/request.test.ts',
			'line': 233,
			'title': 'Keys of the arguments for req.header() are not case-sensitive',
		},
		'operation': 'headers',
		'expected': {
			'Content-Type': 'application/json',
			'content-type': 'application/json',
			'ApiKey': 'abc',
			'apikey': 'abc',
		},
		'headers': {
			'Content-Type': 'application/json',
			'ApiKey': 'abc',
		},
		'keys': [
			'Content-Type',
			'content-type',
			'ApiKey',
			'apikey',
		],
	},
	{
		'id': 'request.cache-text',
		'source': {
			'path': 'src/request.test.ts',
			'line': 259,
			'title': 'req.text()',
		},
		'operation': 'body-cache',
		'expected': [
			'{"foo":"bar"}',
			{
				'foo': 'bar',
			},
			[
				123,
				34,
				102,
				111,
				111,
				34,
				58,
				34,
				98,
				97,
				114,
				34,
				125,
			],
			[
				123,
				34,
				102,
				111,
				111,
				34,
				58,
				34,
				98,
				97,
				114,
				34,
				125,
			],
			{
				'text': '{"foo":"bar"}',
				'type': 'text/plain;charset=utf-8',
			},
		],
		'body': '{"foo":"bar"}',
		'bodyKind': 'text',
		'order': [
			'text',
			'json',
			'arrayBuffer',
			'bytes',
			'blob',
		],
		'adaptation':
			'Utils explicitly memoizes bounded raw bytes, then decodes each view. Hono automatically caches body methods; this is composed cache behavior, not equivalent default APIs.',
	},
	{
		'id': 'request.cache-json',
		'source': {
			'path': 'src/request.test.ts',
			'line': 277,
			'title': 'req.json()',
		},
		'operation': 'body-cache',
		'expected': [
			{
				'foo': 'bar',
			},
			'{"foo":"bar"}',
			[
				123,
				34,
				102,
				111,
				111,
				34,
				58,
				34,
				98,
				97,
				114,
				34,
				125,
			],
			[
				123,
				34,
				102,
				111,
				111,
				34,
				58,
				34,
				98,
				97,
				114,
				34,
				125,
			],
			{
				'text': '{"foo":"bar"}',
				'type': 'text/plain;charset=utf-8',
			},
		],
		'body': '{"foo":"bar"}',
		'bodyKind': 'text',
		'order': [
			'json',
			'text',
			'arrayBuffer',
			'bytes',
			'blob',
		],
		'adaptation':
			'Utils explicitly memoizes bounded raw bytes, then decodes each view. Hono automatically caches body methods; this is composed cache behavior, not equivalent default APIs.',
	},
	{
		'id': 'request.cache-array-buffer',
		'source': {
			'path': 'src/request.test.ts',
			'line': 307,
			'title': 'req.arrayBuffer()',
		},
		'operation': 'body-cache',
		'expected': [
			[
				123,
				34,
				102,
				111,
				111,
				34,
				58,
				34,
				98,
				97,
				114,
				34,
				125,
			],
			'{"foo":"bar"}',
			{
				'foo': 'bar',
			},
			[
				123,
				34,
				102,
				111,
				111,
				34,
				58,
				34,
				98,
				97,
				114,
				34,
				125,
			],
			{
				'text': '{"foo":"bar"}',
				'type': '',
			},
		],
		'body': '{"foo":"bar"}',
		'bodyKind': 'bytes',
		'order': [
			'arrayBuffer',
			'text',
			'json',
			'bytes',
			'blob',
		],
		'adaptation':
			'Utils explicitly memoizes bounded raw bytes, then decodes each view. Hono automatically caches body methods; this is composed cache behavior, not equivalent default APIs.',
	},
	{
		'id': 'request.cache-bytes',
		'source': {
			'path': 'src/request.test.ts',
			'line': 326,
			'title': 'req.bytes()',
		},
		'operation': 'body-cache',
		'expected': [
			[
				123,
				34,
				102,
				111,
				111,
				34,
				58,
				34,
				98,
				97,
				114,
				34,
				125,
			],
			'{"foo":"bar"}',
			{
				'foo': 'bar',
			},
			[
				123,
				34,
				102,
				111,
				111,
				34,
				58,
				34,
				98,
				97,
				114,
				34,
				125,
			],
			{
				'text': '{"foo":"bar"}',
				'type': '',
			},
		],
		'body': '{"foo":"bar"}',
		'bodyKind': 'bytes',
		'order': [
			'bytes',
			'text',
			'json',
			'arrayBuffer',
			'blob',
		],
		'adaptation':
			'Utils explicitly memoizes bounded raw bytes, then decodes each view. Hono automatically caches body methods; this is composed cache behavior, not equivalent default APIs.',
	},
	{
		'id': 'request.cache-blob',
		'source': {
			'path': 'src/request.test.ts',
			'line': 347,
			'title': 'req.blob()',
		},
		'operation': 'body-cache',
		'expected': [
			{
				'text': '{"foo":"bar"}',
				'type': 'application/json',
			},
			'{"foo":"bar"}',
			{
				'foo': 'bar',
			},
			[
				123,
				34,
				102,
				111,
				111,
				34,
				58,
				34,
				98,
				97,
				114,
				34,
				125,
			],
			[
				123,
				34,
				102,
				111,
				111,
				34,
				58,
				34,
				98,
				97,
				114,
				34,
				125,
			],
		],
		'body': '{"foo":"bar"}',
		'bodyKind': 'blob',
		'order': [
			'blob',
			'text',
			'json',
			'arrayBuffer',
			'bytes',
		],
		'adaptation':
			'Utils explicitly memoizes bounded raw bytes, then decodes each view. Hono automatically caches body methods; this is composed cache behavior, not equivalent default APIs.',
	},
	{
		'id': 'request.cache-json-whitespace',
		'source': {
			'path': 'src/request.test.ts',
			'line': 295,
			'title': 'req.json() should keep the content as is',
		},
		'operation': 'body-cache',
		'expected': [
			{
				'foo': 'bar',
			},
			'{ "foo" : "bar" }',
		],
		'body': '{ "foo" : "bar" }',
		'order': [
			'json',
			'text',
		],
		'adaptation': 'Explicit Utils memoize(readBody) preserves original bytes instead of reserializing JSON.',
	},
	{
		'id': 'request.form-data',
		'source': {
			'path': 'src/request.test.ts',
			'line': 364,
			'title': 'req.formData()',
		},
		'operation': 'form',
		'expected': {
			'foo': 'bar',
		},
		'keys': [
			'foo',
		],
		'adaptation':
			'Hono req.formData() versus bounded Utils parseForm(); compare parsed fields, not multipart boundary text.',
	},
	{
		'id': 'request.parse-form',
		'source': {
			'path': 'src/request.test.ts',
			'line': 381,
			'title': 'should parse form data',
		},
		'operation': 'form',
		'expected': {
			'foo': 'bar',
		},
		'keys': [
			'foo',
		],
	},
	{
		'id': 'request.parse-form-file',
		'source': {
			'path': 'src/request.test.ts',
			'line': 397,
			'title': 'should parse form data even if formData() is called before parseBody()',
		},
		'operation': 'form',
		'expected': {
			'foo': 'bar',
			'file': {
				'name': 't.txt',
				'type': 'text/plain',
				'text': 'hello',
			},
		},
		'keys': [
			'foo',
			'file',
		],
		'adaptation':
			'Compare parseBody field/file results. Hono preceding formData() cache call is not ported; Utils has one bounded parseForm owner.',
	},
	{
		'id': 'request.nonform-text',
		'source': {
			'path': 'src/request.test.ts',
			'line': 423,
			'title': 'text()',
		},
		'operation': 'non-form',
		'expected': {
			'parsed': {},
			'view': '{"event":"push"}',
		},
		'body': '{"event":"push"}',
		'headers': {
			'Content-Type': 'application/json',
		},
		'order': [
			'text',
		],
		'utilsExpected': {
			'code': 'unsupported-content-type',
			'view': '{"event":"push"}',
		},
		'difference':
			'Hono parseBody() returns an empty object for JSON; Utils parseForm rejects non-form media types before reading the body. The remaining byte view stays readable.',
	},
	{
		'id': 'request.nonform-json',
		'source': {
			'path': 'src/request.test.ts',
			'line': 429,
			'title': 'json()',
		},
		'operation': 'non-form',
		'expected': {
			'parsed': {},
			'view': {
				'event': 'push',
			},
		},
		'body': '{"event":"push"}',
		'headers': {
			'Content-Type': 'application/json',
		},
		'order': [
			'json',
		],
		'utilsExpected': {
			'code': 'unsupported-content-type',
			'view': {
				'event': 'push',
			},
		},
		'difference':
			'Hono parseBody() returns an empty object for JSON; Utils parseForm rejects non-form media types before reading the body. The remaining byte view stays readable.',
	},
	{
		'id': 'request.nonform-arrayBuffer',
		'source': {
			'path': 'src/request.test.ts',
			'line': 435,
			'title': 'arrayBuffer()',
		},
		'operation': 'non-form',
		'expected': {
			'parsed': {},
			'view': [
				123,
				34,
				101,
				118,
				101,
				110,
				116,
				34,
				58,
				34,
				112,
				117,
				115,
				104,
				34,
				125,
			],
		},
		'body': '{"event":"push"}',
		'headers': {
			'Content-Type': 'application/json',
		},
		'order': [
			'arrayBuffer',
		],
		'utilsExpected': {
			'code': 'unsupported-content-type',
			'view': [
				123,
				34,
				101,
				118,
				101,
				110,
				116,
				34,
				58,
				34,
				112,
				117,
				115,
				104,
				34,
				125,
			],
		},
		'difference':
			'Hono parseBody() returns an empty object for JSON; Utils parseForm rejects non-form media types before reading the body. The remaining byte view stays readable.',
	},
	{
		'id': 'request.nonform-bytes',
		'source': {
			'path': 'src/request.test.ts',
			'line': 441,
			'title': 'bytes()',
		},
		'operation': 'non-form',
		'expected': {
			'parsed': {},
			'view': [
				123,
				34,
				101,
				118,
				101,
				110,
				116,
				34,
				58,
				34,
				112,
				117,
				115,
				104,
				34,
				125,
			],
		},
		'body': '{"event":"push"}',
		'headers': {
			'Content-Type': 'application/json',
		},
		'order': [
			'bytes',
		],
		'utilsExpected': {
			'code': 'unsupported-content-type',
			'view': [
				123,
				34,
				101,
				118,
				101,
				110,
				116,
				34,
				58,
				34,
				112,
				117,
				115,
				104,
				34,
				125,
			],
		},
		'difference':
			'Hono parseBody() returns an empty object for JSON; Utils parseForm rejects non-form media types before reading the body. The remaining byte view stays readable.',
	},
	{
		'id': 'request.nonform-blob',
		'source': {
			'path': 'src/request.test.ts',
			'line': 447,
			'title': 'blob()',
		},
		'operation': 'non-form',
		'expected': {
			'parsed': {},
			'view': {
				'text': '{"event":"push"}',
				'type': 'application/json',
			},
		},
		'body': '{"event":"push"}',
		'headers': {
			'Content-Type': 'application/json',
		},
		'order': [
			'blob',
		],
		'utilsExpected': {
			'code': 'unsupported-content-type',
			'view': {
				'text': '{"event":"push"}',
				'type': 'application/json',
			},
		},
		'difference':
			'Hono parseBody() returns an empty object for JSON; Utils parseForm rejects non-form media types before reading the body. The remaining byte view stays readable.',
	},
	{
		'id': 'request.clone-unconsumed',
		'source': {
			'path': 'src/request.test.ts',
			'line': 509,
			'title': 'clones unconsumed request object',
		},
		'operation': 'clone',
		'expected': {
			'method': 'POST',
			'url': 'http://localhost/',
			'text': '{"foo":"bar"}',
			'headers': {
				'content-type': 'application/json',
				'x-custom-header': 'custom-value',
			},
			'cache': 'no-cache',
			'credentials': 'include',
			'integrity': 'sha256-test',
			'mode': 'cors',
			'redirect': 'follow',
			'referrer': 'http://example.com/',
			'referrerPolicy': 'origin',
			'different': true,
		},
		'body': '{"foo":"bar"}',
		'adaptation': 'Utils retains the native Request.clone operation; no Utils cloning wrapper is claimed.',
	},
	{
		'id': 'request.clone-consumed',
		'source': {
			'path': 'src/request.test.ts',
			'line': 546,
			'title': 'clones consumed request object',
		},
		'operation': 'consumed-clone',
		'expected': {
			'text': '{"foo":"bar"}',
			'authorization': 'Bearer token123',
		},
		'body': '{"foo":"bar"}',
		'utilsExpected': {
			'rejected': true,
		},
		'difference':
			'Hono reconstructs consumed requests from its automatic body cache; Utils bounded readBody leaves the native Request consumed and native clone rejects.',
	},
	{
		'id': 'request.header-prototype',
		'source': {
			'path': 'src/request.test.ts',
			'line': 247,
			'title': 'req.header() is not affected by a `__proto__` header name',
		},
		'operation': 'headers-prototype',
		'expected': {
			'prototypeNull': true,
		},
		'adaptation':
			'Preserve the upstream prototype observation. Its object-literal __proto__ syntax does not create an own header field; the following additional vector supplies an actual header.',
	},
	{
		'id': 'request.header-prototype-injected',
		'source': {
			'path': 'src/request.test.ts',
			'line': 247,
			'title': 'req.header() is not affected by a `__proto__` header name',
		},
		'operation': 'headers-prototype-injected',
		'expected': {
			'prototypeNull': true,
			'value': 'evil',
		},
		'adaptation':
			'Stronger additional input: use an actual __proto__ header tuple instead of the upstream non-own object-literal property. This extends the input and is not a literal-input port.',
	},
	{
		'id': 'request.nonform-formData',
		'source': {
			'path': 'src/request.test.ts',
			'line': 453,
			'title': 'formData()',
		},
		'operation': 'nonform-invalid',
		'expected': {
			'parsed': {},
			'rejected': true,
		},
		'body': '{"event":"push"}',
		'headers': {
			'Content-Type': 'application/json',
		},
		'utilsExpected': {
			'code': 'unsupported-content-type',
			'rejected': true,
		},
		'difference':
			'Hono parseBody returns {}; Utils parseForm rejects JSON. Both native formData decoders reject the subsequent incompatible media type.',
	},
	{
		'id': 'request.multipart-clone',
		'source': {
			'path': 'src/request.test.ts',
			'line': 572,
			'title': 'clones consumed multipart request with a matching boundary',
		},
		'operation': 'multipart-clone',
		'expected': {
			'boundaryMatches': true,
			'foo': 'bar',
			'file': {
				'name': 't.txt',
				'type': 'text/plain',
				'text': 'hello',
			},
		},
		'utilsExpected': {
			'rejected': true,
		},
		'difference':
			'Hono rebuilds consumed multipart bodies and aligns the generated boundary with its reconstructed header. Utils has no automatic consumed-request reconstruction.',
	},
	{
		'id': 'request.multipart-stale-clone',
		'source': {
			'path': 'src/request.test.ts',
			'line': 596,
			'title': 'drops stale content length when cloning consumed multipart request',
		},
		'operation': 'multipart-stale-clone',
		'expected': {
			'hasContentLength': false,
			'foo': 'bar',
		},
		'utilsExpected': {
			'rejected': true,
		},
		'difference':
			'Hono drops stale Content-Length while reconstructing a consumed multipart request. Utils requires a deliberate new body owner and rejects native clone after its bounded form read.',
	},
	{
		'id': 'request.external-cache-clone',
		'source': {
			'path': 'src/request.test.ts',
			'line': 624,
			'title': 'clones request when external code populated bodyCache.json',
		},
		'operation': 'external-cache-clone',
		'expected': {
			'foo': 'bar',
		},
		'utilsExpected': {
			'rejected': true,
		},
		'difference':
			'Hono bodyCache.json is a framework-specific reconstruction authority. Utils request memoization does not retrofit native Request.clone().',
	},
	{
		'id': 'request.clone-get',
		'source': {
			'path': 'src/request.test.ts',
			'line': 642,
			'title': 'clones GET request without body',
		},
		'operation': 'clone-get',
		'expected': {
			'method': 'GET',
			'url': 'http://localhost/',
			'agent': 'test-agent',
			'cache': 'default',
			'redirect': 'manual',
			'referrerPolicy': 'no-referrer',
			'different': true,
		},
		'adaptation': 'Utils retains native Request.clone; no Utils cloning wrapper is claimed.',
	},
	{
		'id': 'request.raw-consumed-clone',
		'source': {
			'path': 'src/request.test.ts',
			'line': 667,
			'title': 'clones request when raw body was consumed directly without HonoRequest methods',
		},
		'operation': 'raw-consumed-clone',
		'expected': {
			'rejected': true,
			'status': 500,
		},
		'utilsExpected': {
			'rejected': true,
			'kind': 'TypeError',
		},
		'difference':
			'Hono reports a public HTTPException status for an uncached consumed body; native Request.clone rejects with TypeError. Diagnostic wording is not part of this assertion.',
	},
];
