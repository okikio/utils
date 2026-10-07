/** Owned mock transport adapted from the pinned Hono beforeEach provider. No globals, sockets or network. @module */
export interface OwnedUpstream {
	readonly requests: Request[];
	readonly fetch: (request: Request) => Promise<Response>;
}

/** The original literal URL branches, decoded bodies and headers are preserved. */
export function createUpstream(): OwnedUpstream {
	const requests: Request[] = [];
	return {
		requests,
		async fetch(request) {
			requests.push(request);
			switch (request.url) {
				case 'https://example.com/ok':
					return new Response('ok');
				case 'https://example.com/compressed':
					return new Response('ok', {
						headers: {
							'Content-Encoding': 'gzip',
							'Content-Length': '1',
							'Content-Range': 'bytes 0-2/1024',
							'X-Response-Id': '456',
						},
					});
				case 'https://example.com/uncompressed':
					return new Response('ok', {
						headers: { 'Content-Length': '2', 'Content-Range': 'bytes 0-2/1024', 'X-Response-Id': '456' },
					});
				case 'https://example.com/post':
					return request.method === 'POST'
						? new Response(`request body: ${await request.text()}`)
						: new Response('not found', { status: 404 });
				case 'https://example.com/hop-by-hop':
					return new Response('ok', { headers: { 'Transfer-Encoding': 'chunked' } });
				case 'https://example.com/connection-listed':
					return new Response('ok', {
						headers: {
							Connection: 'x-connection-scoped, bad name',
							'X-Connection-Scoped': 'should not be forwarded',
							'X-Normal': 'kept',
						},
					});
				case 'https://example.com/set-cookie':
					return new Response('ok', { headers: { 'Set-Cookie': 'test=123' } });
				case 'https://example.com/':
					return new Response(`custom fetch response. message:${await request.text()}`);
				default:
					return new Response('not found', { status: 404 });
			}
		},
	};
}
