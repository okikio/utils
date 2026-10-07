/** Compare a real Hono response with and without the portable middleware seam. */
import { deepStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { Hono } from 'hono';
import * as adapter from '@okikio/hono';
import * as http from '@okikio/server/http';
import { run } from '../../bench/run.ts';
const app = new Hono();
app.get('/health', (ctx) => ctx.json({ status: 'ok' }));
const wrapped = adapter.fetch(app, [http.securityHeaders()]);
/** Consuming the body is part of the operation, so no stream escapes a trial. */
async function request(handler: http.Handler): Promise<unknown> {
	const response = await handler(new Request('https://bench.invalid/health'));
	strictEqual(response.status, 200);
	return await response.json();
}
deepStrictEqual(await request(wrapped), { status: 'ok' });
deepStrictEqual(await request((request) => app.fetch(request)), { status: 'ok' });
const initial = await wrapped(new Request('https://bench.invalid/health'));
strictEqual(initial.headers.get('x-content-type-options'), 'nosniff');
await initial.body?.cancel();
group('Hono middleware composition', () => {
	bench('Hono + utility security headers + JSON consumption', async () => do_not_optimize(await request(wrapped)));
	bench(
		'Hono direct + JSON consumption (no security middleware)',
		async () => do_not_optimize(await request((request) => app.fetch(request))),
	);
});
await run();
