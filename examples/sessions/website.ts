/** A local teaching website, not an authentication service for deployment. */
import { createServer } from 'node:http';
import { AsyncDisposableStack } from '@okikio/dispose';

/** Serve a sign-in button and a cookie-protected account page on a free loopback port. */
export async function openWebsite() {
	await using startup = new AsyncDisposableStack();
	const server = startup.adopt(
		createServer((request, response) => {
			// The browser stores Set-Cookie and sends Cookie on later requests to this site.
			// This fixed token makes the example repeatable; it is not a secure login system.
			if (request.method === 'POST' && request.url === '/login') {
				response.writeHead(303, {
					'Location': '/account',
					'Set-Cookie': 'session=demo-ada; HttpOnly; SameSite=Lax; Path=/',
				});
				response.end();
				return;
			}
			if (request.method === 'GET' && request.url === '/account') {
				const signedIn = request.headers.cookie?.split(';').some((cookie) => cookie.trim() === 'session=demo-ada');
				response.writeHead(signedIn ? 200 : 401, { 'Content-Type': 'text/html; charset=utf-8' });
				response.end(signedIn ? '<h1>Ada</h1>' : '<h1>Sign in first</h1>');
				return;
			}
			if (request.method === 'GET' && request.url === '/login') {
				response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
				response.end('<form method="post" action="/login"><button>Sign in as Ada</button></form>');
				return;
			}
			response.writeHead(404);
			response.end();
		}),
		async (value) => {
			if (!value.listening) return;
			await new Promise<void>((resolve, reject) => value.close((error) => error ? reject(error) : resolve()));
		},
	);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.removeListener('error', reject);
			resolve();
		});
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('The example website needs a TCP port.');
	// Transfer successful startup to the caller; failed startup closes through the original stack.
	const lifetime = startup.move();
	return { url: `http://127.0.0.1:${address.port}`, [Symbol.asyncDispose]: () => lifetime.disposeAsync() };
}
