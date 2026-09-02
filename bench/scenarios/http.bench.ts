import { bench, do_not_optimize, group, run } from 'mitata';

import * as server from '@okikio/server/http';

const app = server.create({
	routes: [server.route('GET', '/accounts/:id', (request) => Response.json({ path: new URL(request.url).pathname }))],
	middleware: [server.requestId({ generate: () => 'bench-request' }), server.securityHeaders()],
});

group('HTTP composition', () => {
	bench('100 routed requests through request-id and security middleware', async () => {
		let status = 0;
		for (let index = 0; index < 100; index += 1) {
			const response = await app.fetch(new Request(`https://service.invalid/accounts/${index}`));
			status += response.status;
			await response.body?.cancel();
		}
		do_not_optimize(status);
	}).gc('once');
});

await run();
