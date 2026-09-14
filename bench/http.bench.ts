import { bench, do_not_optimize, group } from 'mitata';

import * as server from '@okikio/server/http';

const app = server.create({
	routes: [server.route('GET', '/accounts/:id', (request) => Response.json({ path: new URL(request.url).pathname }))],
	middleware: [server.requestId({ generate: () => 'bench-request' }), server.securityHeaders()],
});

/** Exercise the named middleware stack once before timing and reject a changed public response contract. */
async function verify(): Promise<void> {
	const response = await app.fetch(new Request('https://service.invalid/accounts/42'));
	try {
		if (response.status !== 200) throw new Error('HTTP benchmark route did not return success.');
		if (response.headers.get('x-request-id') !== 'bench-request') throw new Error('HTTP benchmark did not apply request correlation.');
		if (response.headers.get('x-content-type-options') !== 'nosniff') throw new Error('HTTP benchmark did not apply security headers.');
		const body = await response.json() as { path?: unknown };
		if (body.path !== '/accounts/42') throw new Error('HTTP benchmark route did not preserve the requested path.');
	} finally {
		if (!response.bodyUsed) await response.body?.cancel();
	}
}

async function batch(): Promise<number> {
	let status = 0;
	for (let index = 0; index < 100; index += 1) {
		const response = await app.fetch(new Request(`https://service.invalid/accounts/${index}`));
		status += response.status;
		await response.body?.cancel();
	}
	return status;
}

await verify();

group('HTTP composition', () => {
	bench('100 routed requests through request-id and security middleware', async () => {
		do_not_optimize(await batch());
	}).gc('once');
});
