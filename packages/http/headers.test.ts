import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import { forward } from '@okikio/http/headers';
import { forwardHeaders } from '@okikio/http/request';

describe('HTTP forwarding headers', () => {
	it('ignores invalid Connection tokens while removing every valid named field', () => {
		const source = new Headers({
			connection: 'x-first, bad name, , x-last, bad:name',
			'x-first': 'private',
			'x-last': 'private',
			'content-type': 'text/plain',
		});
		const result = forward(source);
		expect([...result]).toEqual([['content-type', 'text/plain']]);
		expect(source.get('x-first')).toBe('private');
		expect(source.get('connection')).toBe('x-first, bad name, , x-last, bad:name');
	});

	it('removes Connection options and preserves separate cookies', () => {
		const source = new Headers({
			connection: 'keep-alive, X-Private-Hop, x-second-hop',
			'keep-alive': 'timeout=30',
			'proxy-connection': 'keep-alive',
			'x-private-hop': 'private',
			'x-second-hop': 'private',
			'content-type': 'application/json',
		});
		source.append('set-cookie', 'one=1; Path=/');
		source.append('set-cookie', 'two=2; Path=/');
		const forwarded = forward(source);
		for (const name of ['connection', 'keep-alive', 'proxy-connection', 'x-private-hop', 'x-second-hop']) {
			expect(forwarded.has(name)).toBe(false);
		}
		expect(forwarded.getSetCookie()).toEqual(['one=1; Path=/', 'two=2; Path=/']);
		expect(forwarded.get('content-type')).toBe('application/json');
		expect(source.get('x-private-hop')).toBe('private');
		const request = forwardHeaders(new Request('https://app.example/path', { headers: source }));
		expect(request.has('x-private-hop')).toBe(false);
		expect(request.has('x-second-hop')).toBe(false);
	});
});
