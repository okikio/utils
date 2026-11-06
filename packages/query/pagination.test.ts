import { deepStrictEqual as equal, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Temporal } from '@okikio/duration/temporal';
import { days, ns } from '@okikio/duration/units';
import { cursor, encode, offset, pagination, parse, safeParse } from './page.ts';

describe('standalone pagination', () => {
	it('accepts fixed duration settings without requiring global Temporal installation', () => {
		equal(cursor({ ttl: days(1) }).ttl?.toString(), 'P1D');
		equal(cursor({ ttl: 'PT2S' }).ttl, 'PT2S');
		equal(cursor({ ttl: ns(1n) }).ttl?.toString(), 'PT0.000000001S');
		throws(() => cursor({ ttl: Temporal.Duration.from({ months: 1 }) }), /years or months/);
		throws(() => cursor({ ttl: { years: 1 } }), /years or months/);
		throws(() => cursor({ ttl: { seconds: 0 } }), /positive/);
		throws(() => cursor({ ttl: { seconds: -1 } }), /positive/);
	});
	it('reads page-number controls and writes a next-page link', () => {
		const policy = offset({ defaultLimit: 20, maximumLimit: 100 });
		const page = parse(policy, new URL('https://example.test/?page=2&per_page=20'));
		if (page.kind !== 'offset') throw new Error('Expected offset page');
		equal(page.offset, 20);
		const next = encode(policy, { ...page, page: 3, offset: 40 });
		equal(next.toString(), 'page=3&per_page=20');
		equal(parse(policy, next).limit, 20);
	});
	it('honors custom parameter names and preserves opaque cursors', () => {
		const policy = cursor({ parameters: { cursor: 'after', limit: 'count' } });
		const page = parse(policy, new URLSearchParams('after=a%2Fb%2Bc&count=5&view=compact'));
		equal(page, { kind: 'cursor', cursor: 'a/b+c', limit: 5 });
		equal(parse(policy, encode(policy, page)), page);
	});
	it('returns actionable bounds and conflicting-mode errors', () => {
		const policy = pagination({ cursor: cursor(), offset: offset() });
		equal(safeParse(policy, new URLSearchParams('cursor=x&offset=2')).success, false);
		equal(safeParse(policy, new URLSearchParams('limit=201')).success, false);
		equal(safeParse(policy, new URLSearchParams('a=1&a=2&a=3'), { maximumParameters: 2 }).success, false);
		throws(() => encode(offset(), { kind: 'offset', limit: 20, offset: 21, source: 'page', page: 2 }), /same window/);
	});
});
