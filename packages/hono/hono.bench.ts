/** Compare equal Hono response work with an empty adapter; middleware composition is a root workflow. @module */
import { deepStrictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import { Hono } from 'hono';
import { fetch } from './mod.ts';
const app = new Hono();
app.get('/items/:id', (ctx) => ctx.text(ctx.req.param('id')));
const wrapped = fetch(app);
for (const path of ['/items/42', '/missing']) {
	/** Include request creation and full body consumption in both candidates. */
	const request = async function (adapted: boolean): Promise<readonly [number, string]> {
		const input = new Request('https://bench.invalid' + path);
		const response = await (adapted ? wrapped(input) : app.fetch(input));
		return [response.status, await response.text()];
	};

	const direct = await request(false);
	deepStrictEqual(direct, path === '/missing' ? [404, '404 Not Found'] : [200, '42']);
	deepStrictEqual(await request(true), direct);
	group(`Hono ${path}, response body consumed`, () => {
		bench('adapter with no middleware', async () => do_not_optimize(await request(true)));
		bench('direct Hono with same request/body ownership', async () => do_not_optimize(await request(false)));
	});
}
await run();
