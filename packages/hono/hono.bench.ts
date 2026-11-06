import { strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
/** Compare equal Hono response work with an empty adapter; middleware composition is a root workflow. */
import { Hono } from 'hono';
import { fetch } from './mod.ts';
const app = new Hono();
app.get('/items/:id', (ctx) => ctx.text(ctx.req.param('id')));
const wrapped = fetch(app);
for (const path of ['/items/42', '/missing']) {
	const request = async function (adapted: boolean): Promise<string> {
		const input = new Request('https://bench.invalid' + path);
		const response = await (adapted ? wrapped(input) : app.fetch(input));
		strictEqual(response.status, path === '/missing' ? 404 : 200);
		return await response.text();
	};
	strictEqual(await request(true), await request(false));
	group(`Hono ${path}, response body consumed`, () => {
		bench('adapter with no middleware', async () => do_not_optimize(await request(true)));
		bench('direct Hono with same request/body ownership', async () => do_not_optimize(await request(false)));
	});
}
await run();
